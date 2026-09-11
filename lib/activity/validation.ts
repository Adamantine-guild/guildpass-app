import { z } from "zod";
import type { WebhookPayload } from "./types";
import { SUPPORTED_WEBHOOK_EVENTS } from "./types";
import { isValidChecksumAddress, normaliseAddress } from "../address";

export type ValidationResult =
  | { valid: true; payload: WebhookPayload }
  | { valid: false; error: string; field?: string };

const webhookPayloadSchema = z.object({
  id: z.string().min(1, { message: "id is required" }),
  type: z.string().min(1, { message: "type is required" }),
  created: z.number().positive({ message: "created must be a positive number" }),
  data: z.record(z.string(), z.unknown()),
});

export const DataSchemas = {
  "membership.created": z.object({
    name: z.string().optional(),
    wallet: z.string().optional(),
    id: z.string().optional(),
  }),
  "membership.updated": z.object({
    name: z.string().optional(),
    wallet: z.string().optional(),
    id: z.string().optional(),
  }),
  "pass.created": z.object({
    name: z.string().optional(),
    id: z.string().optional(),
  }),
  "pass.updated": z.object({
    name: z.string().optional(),
    id: z.string().optional(),
  }),
  "guild.updated": z.object({
    name: z.string().optional(),
    id: z.string().optional(),
  }),
  "verification.completed": z.object({
    wallet: z.string().optional(),
    id: z.string().optional(),
  }),
} as const;


export function validateWebhookPayload(rawBody: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { valid: false, error: "Invalid JSON", field: "body" };
  }

  const envelopeResult = webhookPayloadSchema.safeParse(parsed);
  if (!envelopeResult.success) {
    const issue = envelopeResult.error.issues[0];
    const field = issue.path.join(".") || "body";
    return {
      valid: false,
      error: `${field}: ${issue.message}`,
      field,
    };
  }

  const payload = envelopeResult.data;

  if (SUPPORTED_WEBHOOK_EVENTS.includes(payload.type as typeof SUPPORTED_WEBHOOK_EVENTS[number])) {
    const schema = DataSchemas[payload.type as keyof typeof DataSchemas];
    const dataResult = schema.safeParse(payload.data);

    if (!dataResult.success) {
      const issue = dataResult.error.issues[0];
      const field = `data.${issue.path.join(".")}`.replace(/\.$/, "");
      return {
        valid: false,
        error: `${field}: ${issue.message}`,
        field,
      };
    }
    // Additional semantic validation: ensure wallets are checksummed and normalise them
    const parsedData = dataResult.data as Record<string, unknown>;
    const walletField = parsedData.wallet as string | undefined;
    if (walletField) {
      if (!isValidChecksumAddress(walletField)) {
        return { valid: false, error: `data.wallet: wallet must be a checksummed Ethereum address`, field: "data.wallet" };
      }
      // replace with normalised checksummed form
      parsedData.wallet = normaliseAddress(walletField);
      payload.data = parsedData as any;
    }
  }

  return { valid: true, payload };
}

export { webhookPayloadSchema };
