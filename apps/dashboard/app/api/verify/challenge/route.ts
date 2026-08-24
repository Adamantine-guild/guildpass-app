/**
 * POST /api/verify/challenge
 *
 * Issues a single-use, expiring verification challenge for a
 * (discordUserId, wallet) pair (issue #173). The wallet signs the returned
 * message; POST /api/verify then requires { nonce, signature } and only
 * proceeds when the signature is valid for that exact challenge.
 *
 * Request body:  { discordUserId: string, wallet: string }
 * Response:      { nonce, message, expiresAt, expiresIn }
 */
import type { NextResponse } from "next/server";
import {
  apiResponse,
  apiValidationError,
  handleApiError,
} from "@/lib/api-helpers";
import { isValidChecksumAddress } from "@/lib/address";
import {
  CHALLENGE_TTL_MS,
  getVerificationChallengeStore,
} from "@/lib/verification-challenge";

// Challenges are per-request and must never be cached.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  return handleApiError(async () => {
    const body = await request.json();
    const { discordUserId, wallet } = body;

    if (!discordUserId || !wallet) {
      return apiValidationError("Missing verification fields", [
        ...(!discordUserId
          ? [{ field: "discordUserId", message: "discordUserId is required" }]
          : []),
        ...(!wallet ? [{ field: "wallet", message: "wallet is required" }] : []),
      ]);
    }

    if (!isValidChecksumAddress(wallet)) {
      return apiValidationError("Invalid wallet", [
        { field: "wallet", message: "wallet must be a checksummed Ethereum address" },
      ]);
    }

    const challenge = getVerificationChallengeStore().issue(discordUserId, wallet);

    return apiResponse(
      {
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: challenge.expiresAt,
        expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
