/**
 * GET /api/auth/nonce
 *
 * Issues a single-use, expiring nonce for the SIWE sign-in flow (issue #142).
 * The client embeds this nonce in the SIWE message the wallet signs; the verify
 * endpoint (POST /api/auth/siwe) consumes it exactly once. Single-use + expiry
 * prevent replay of a captured signature.
 *
 * Response: { ok: true, data: { nonce: string, expiresIn: number } }
 *   expiresIn is the nonce lifetime in seconds.
 */
import type { NextResponse } from "next/server";
import { apiResponse } from "@/lib/api-helpers";
import { getNonceStore, NONCE_TTL_MS } from "@/lib/auth/nonce-store";

// Nonces are per-request and must never be cached.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const nonce = getNonceStore().issue();
  return apiResponse(
    { nonce, expiresIn: Math.floor(NONCE_TTL_MS / 1000) },
    { headers: { "Cache-Control": "no-store" } },
  );
}