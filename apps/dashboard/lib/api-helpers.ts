import { NextResponse } from "next/server";
import type {
ApiErrorCode,
ApiErrorResponse,
ApiFieldError,
ApiResult,
ApiSuccess,
ApiUnsupportedResponse,
ApiValidationErrorResponse,
} from "./api-contracts";
import { isPublicApiError, ValidationError } from "@/lib/api-errors";
import { httpRequestsTotal, httpRequestDuration } from "@guildpass/metrics";

export type UnsupportedResponse = {
error: string;
code: "UNSUPPORTED_IN_LIVE_MODE";
};

export function apiResponse<T>(
data: T,
init?: ResponseInit
): NextResponse<ApiSuccess<T>> {
return NextResponse.json({ ok: true, data }, init);
}

export function apiError(
  message: string,
  status: number = 500,
  code: ApiErrorCode = inferErrorCode(status),
  errorId?: string
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    { ok: false, code, error: message, ...(errorId ? { errorId } : {}) },
    { status }
  );
}

export function apiValidationError(
  message: string,
  fields: ApiFieldError[],
  status: number = 400
): NextResponse<ApiValidationErrorResponse> {
  return NextResponse.json(
    { ok: false, code: "VALIDATION_ERROR", error: message, fields },
    { status }
  );
}

export function apiUnsupported(
  feature: string,
  mode: string,
  message: string
): NextResponse<ApiUnsupportedResponse> {
  return NextResponse.json(
    {
      ok: false,
      code: "UNSUPPORTED",
      error: message,
      unsupported: { feature, mode },
    },
    { status: 501 }
  );
}

function newErrorId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `err_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  );
}

export function apiUnsupportedLegacy(
  message: string
): NextResponse<UnsupportedResponse> {
  return NextResponse.json(
    { error: message, code: "UNSUPPORTED_IN_LIVE_MODE" },
    { status: 501 }
  );
}

export async function handleApiError<T>(
  fn: () => Promise<T | NextResponse>,
  route: string = "unknown"
): Promise<NextResponse<ApiResult<T>>> {
  const start = performance.now();
  try {
    const data = await fn();
    const duration = (performance.now() - start) / 1000;

    // Record Success
    httpRequestDuration.observe({ method: 'GET', route }, duration);
    httpRequestsTotal.inc({ method: 'GET', route, status_code: '200' });

    if (data instanceof Response) {
      return data as NextResponse<ApiResult<T>>;
    }
    return apiResponse(data);
  } catch (err) {
    const duration = (performance.now() - start) / 1000;
    httpRequestDuration.observe({ method: 'GET', route }, duration);

    if (isPublicApiError(err)) {
      httpRequestsTotal.inc({ method: 'GET', route, status_code: err.statusCode.toString() });
      if (err instanceof ValidationError && err.fields) {
        return apiValidationError(err.message, err.fields, err.statusCode);
      }
      return apiError(err.message, err.statusCode);
    }

    const errorId = newErrorId();
    console.error(`API Error [${errorId}]:`, err);
    httpRequestsTotal.inc({ method: 'GET', route, status_code: '500' });
    return apiError("An unexpected error occurred", 500, "SERVER_ERROR", errorId);
  }
}

function inferErrorCode(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 502) return "UPSTREAM_ERROR";
  if (status >= 500) return "SERVER_ERROR";
  return "BAD_REQUEST";
}