/**
 * Express Webhook Handler Example
 * 
 * This example demonstrates how to safely verify incoming webhooks
 * in an Express application.
 * 
 * IMPORTANT: Use express.raw() middleware to preserve the raw body.
 */

import express from "express";
import type { Request, Response } from "express";
import { verifySignature } from "@guildpass/webhook-utils";

const app = express();

/**
 * CRITICAL: Use raw body parser for webhook endpoint
 * This preserves the original bytes needed for signature verification
 */
app.post(
  "/api/webhooks/guildpass",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      // 1. Get signature from headers
      const signature = req.headers["x-guildpass-signature"] as string;

      if (!signature) {
        console.error("Missing signature header");
        return res.status(401).json({ error: "Missing signature" });
      }

      // 2. Get the webhook secret
      const secret = process.env.WEBHOOK_SECRET;

      if (!secret) {
        console.error("WEBHOOK_SECRET not configured");
        return res.status(500).json({ error: "Configuration error" });
      }

      // 3. Verify the signature
      // Note: req.body is a Buffer from express.raw()
      const result = verifySignature({
        signatureHeader: signature,
        secret,
        payload: req.body,
        tolerance: 300,
      });

      if (!result.valid) {
        console.error("Verification failed:", result.error);
        return res.status(401).json({ error: "Invalid signature" });
      }

      // 4. Parse the verified payload
      const event = JSON.parse(req.body.toString());

      console.log("Webhook verified:", {
        type: event.type,
        timestamp: result.timestamp,
      });

      // 5. Process the event
      await processWebhookEvent(event);

      // 6. Return success
      res.json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * Process webhook events
 */
async function processWebhookEvent(event: any) {
  switch (event.type) {
    case "member.joined":
      console.log("Member joined:", event.data);
      break;

    case "member.left":
      console.log("Member left:", event.data);
      break;

    case "pass.activated":
      console.log("Pass activated:", event.data);
      break;

    case "pass.expired":
      console.log("Pass expired:", event.data);
      break;

    default:
      console.log("Unknown event:", event.type);
  }
}

/**
 * Health check endpoint
 */
app.get("/api/webhooks/guildpass", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export default app;
