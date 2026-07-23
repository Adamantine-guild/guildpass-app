import { NextResponse } from "next/server";
import { getApiMode, getStorageMode, getStorageConfig } from "@/lib/env";

/**
 * GET /api/health — Readiness probe for orchestrators (Kubernetes, Docker, etc.)
 *
 * Returns the application's health status along with key configuration metadata.
 * Used by Docker HEALTHCHECK, Kubernetes liveness/readiness probes, and
 * monitoring systems.
 *
 * Response (200):
 * ```json
 * {
 *   "status": "healthy",
 *   "timestamp": "2026-07-23T12:00:00.000Z",
 *   "version": "0.1.0",
 *   "mode": { "api": "live", "storage": "durable" },
 *   "checks": { "env": "passed" }
 * }
 * ```
 *
 * Response (503):
 * ```json
 * { "status": "unhealthy", "timestamp": "...", "error": "..." }
 * ```
 */
export async function GET(): Promise<NextResponse> {
  const start = performance.now();

  try {
    // ── Verify environment configuration is consistent ──────────────
    const apiMode = getApiMode();
    const storageMode = getStorageMode();

    // Validate storage config when in durable mode
    if (storageMode === "durable") {
      getStorageConfig(); // throws if DATABASE_URL is missing
    }

    // ── Build health response ───────────────────────────────────────
    const responseTimeMs = Math.round(performance.now() - start);

    const payload = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      mode: {
        api: apiMode,
        storage: storageMode,
      },
      checks: {
        env: "passed",
      },
      responseTimeMs,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown health check failure";

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: message,
        responseTimeMs: Math.round(performance.now() - start),
      },
      { status: 503 },
    );
  }
}