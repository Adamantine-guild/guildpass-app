import { NextRequest } from "next/server";
import { verifySignature } from "@guildpass/webhook-utils";
import { getEnv } from "@/lib/env";
import { mapWebhookToActivity } from "@/lib/activity/mapper";
import { activityStorage } from "@/lib/activity/storage";
import { publishActivityEvent } from "@/lib/activity/stream";
import { apiError, apiResponse, apiValidationError } from "@/lib/api-helpers";
import { validateWebhookPayload } from "@/lib/activity/validation";
import {
  classifyVerificationError,
  getClientSource,
  getSharedWebhookRateLimiter,
  getWebhookAbuseLimits,
  logWebhookRejection,
} from "@/lib/webhooks/abuse-guard";

const ENDPOINT = "/api/webhooks";

export async function POST(req: NextRequest) {
  try {
    const { WEBHOOK_SECRET } = getEnv();

    if (!WEBHOOK_SECRET) {
      console.error("WEBHOOK_SECRET is not configured");
      return apiError("Webhook secret not configured", 500);
    }

    const source = getClientSource(req);
    const limits = getWebhookAbuseLimits();
    const rateLimiter = getSharedWebhookRateLimiter();

    // Size guard: reject oversized bodies before any verification work.
    const declaredLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > limits.maxBodyBytes) {
      logWebhookRejection({
        reason: "oversized_payload",
        source,
        endpoint: ENDPOINT,
        status: 413,
        contentLength: declaredLength,
      });
      return apiError("Payload too large", 413);
    }

    // Rate guard: sources that keep failing verification get cut off before
    // we spend CPU on another HMAC.
    if (rateLimiter.isLimited(source)) {
      logWebhookRejection({
        reason: "rate_limited",
        source,
        endpoint: ENDPOINT,
        status: 429,
      });
      return apiError("Too many failed webhook attempts", 429);
    }

    const signatureHeader = req.headers.get("x-guildpass-signature");
    if (!signatureHeader) {
      rateLimiter.recordFailure(source);
      logWebhookRejection({
        reason: "malformed_header",
        source,
        endpoint: ENDPOINT,
        status: 401,
      });
      return apiError("Missing signature header", 401);
    }

    const rawBody = await req.text();
    const actualLength = Buffer.byteLength(rawBody, "utf8");
    if (actualLength > limits.maxBodyBytes) {
      logWebhookRejection({
        reason: "oversized_payload",
        source,
        endpoint: ENDPOINT,
        status: 413,
        contentLength: actualLength,
      });
      return apiError("Payload too large", 413);
    }

    const verification = verifySignature({
      signatureHeader,
      secret: WEBHOOK_SECRET,
      payload: rawBody,
    });

    if (!verification.valid) {
      rateLimiter.recordFailure(source);
      logWebhookRejection({
        reason: classifyVerificationError(verification.error),
        source,
        endpoint: ENDPOINT,
        status: 401,
      });
      return apiError(verification.error || "Invalid signature", 401);
    }

    rateLimiter.recordSuccess(source);

    const validation = validateWebhookPayload(rawBody);
    if (!validation.valid) {
      return apiValidationError("Invalid webhook payload", [
        { field: validation.field ?? "payload", message: validation.error },
      ]);
    }

    const payload = validation.payload;

    // Map webhook event to dashboard activity
    const activity = mapWebhookToActivity(payload);

    if (activity) {
      const result = await activityStorage.recordActivityEvent(activity);
      if (result === "duplicate") {
        return apiResponse({ status: "ignored", reason: "duplicate" });
      }

      publishActivityEvent(activity);
      return apiResponse({ status: "success", id: activity.id });
    }

    return apiResponse({ status: "ignored", reason: "unsupported event type" });
  } catch (err) {
    console.error("Webhook processing failed:", err);
    return apiError("Internal server error", 500);
  }
}
