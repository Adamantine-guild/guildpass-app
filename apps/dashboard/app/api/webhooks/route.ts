import { NextRequest } from "next/server";
import { verifySignature } from "@guildpass/webhook-utils";
import { getEnv } from "@/lib/env";
import { mapWebhookToActivity } from "@/lib/activity/mapper";
import { activityStorage } from "@/lib/activity/storage";
import { publishActivityEvent } from "@/lib/activity/stream";
import { apiError, apiResponse, apiValidationError } from "@/lib/api-helpers";
import { validateWebhookPayload } from "@/lib/activity/validation";

export async function POST(req: NextRequest) {
  try {
    const { WEBHOOK_SECRET } = getEnv();

    if (!WEBHOOK_SECRET) {
      console.error("WEBHOOK_SECRET is not configured");
      return apiError("Webhook secret not configured", 500);
    }

    const signatureHeader = req.headers.get("x-guildpass-signature");
    if (!signatureHeader) {
      return apiError("Missing signature header", 401);
    }

    const rawBody = await req.text();

    const verification = verifySignature({
      signatureHeader,
      secret: WEBHOOK_SECRET,
      payload: rawBody,
    });

    if (!verification.valid) {
      return apiError(verification.error || "Invalid signature", 401);
    }

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
