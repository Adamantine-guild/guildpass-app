import { NextRequest, NextResponse } from "next/server";
import { verifySignature } from "@guildpass/webhook-utils";
import { getEnv } from "@/lib/env";
import { activityStorage } from "@/lib/activity/storage";
import { ActivityEvent, WebhookPayload } from "@/lib/activity/types";

export async function POST(req: NextRequest) {
  try {
    const { WEBHOOK_SECRET } = getEnv();
    
    if (!WEBHOOK_SECRET) {
      console.error("WEBHOOK_SECRET is not configured");
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 }
      );
    }

    const signatureHeader = req.headers.get("x-guildpass-signature");
    if (!signatureHeader) {
      return NextResponse.json(
        { error: "Missing signature header" },
        { status: 401 }
      );
    }

    const rawBody = await req.text();
    
    const verification = verifySignature({
      signatureHeader,
      secret: WEBHOOK_SECRET,
      payload: rawBody,
    });

    if (!verification.valid) {
      return NextResponse.json(
        { error: verification.error || "Invalid signature" },
        { status: 401 }
      );
    }

    const payload = JSON.parse(rawBody) as WebhookPayload;

    // Idempotency check
    if (await activityStorage.isDuplicate(payload.id)) {
      return NextResponse.json({ status: "ignored", reason: "duplicate" });
    }

    // Map webhook event to dashboard activity
    const activity = mapWebhookToActivity(payload);
    
    if (activity) {
      await activityStorage.addEvent(activity);
      return NextResponse.json({ status: "success", id: activity.id });
    }

    return NextResponse.json({ status: "ignored", reason: "unsupported event type" });
  } catch (err) {
    console.error("Webhook processing failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function mapWebhookToActivity(payload: WebhookPayload): ActivityEvent | null {
  const { type, data, id, created } = payload;
  const timestamp = new Date(created * 1000).toISOString();

  switch (type) {
    case "membership.created":
      return {
        id,
        type: "member.joined",
        source: "webhook",
        severity: "info",
        actor: {
          name: data.name,
          wallet: data.wallet,
        },
        description: `New member joined: ${data.name || data.wallet}`,
        timestamp,
        entity: {
          type: "member",
          id: data.id,
          name: data.name,
        },
        metadata: data,
      };
    case "membership.updated":
      return {
        id,
        type: "member.left",
        source: "webhook",
        severity: "info",
        actor: {
          name: data.name,
          wallet: data.wallet,
        },
        description: `Member ${data.name || data.wallet} updated`,
        timestamp,
        entity: {
          type: "member",
          id: data.id,
          name: data.name,
        },
        metadata: data,
      };
    case "pass.created":
      return {
        id,
        type: "pass.created",
        source: "webhook",
        severity: "info",
        actor: {
          name: "Admin",
        },
        description: `New pass created: ${data.name}`,
        timestamp,
        entity: {
          type: "pass",
          id: data.id,
          name: data.name,
        },
        metadata: data,
      };
    case "pass.updated":
      return {
        id,
        type: "pass.updated",
        source: "webhook",
        severity: "info",
        actor: {
          name: "Admin",
        },
        description: `Pass updated: ${data.name}`,
        timestamp,
        entity: {
          type: "pass",
          id: data.id,
          name: data.name,
        },
        metadata: data,
      };
    case "guild.updated":
      return {
        id,
        type: "guild.updated",
        source: "webhook",
        severity: "info",
        actor: {
          name: "Admin",
        },
        description: `Guild settings updated: ${data.name}`,
        timestamp,
        entity: {
          type: "guild",
          id: data.id,
          name: data.name,
        },
        metadata: data,
      };
    case "verification.completed":
      return {
        id,
        type: "verification.completed",
        source: "webhook",
        severity: "info",
        actor: {
          wallet: data.wallet,
        },
        description: `Verification completed for ${data.wallet}`,
        timestamp,
        entity: {
          type: "verification",
          id: data.wallet,
        },
        metadata: data,
      };
    default:
      return null;
  }
}
