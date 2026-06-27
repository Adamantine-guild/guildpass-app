import { NextResponse } from "next/server";

export function apiResponse<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function apiError(
  message: string,
  status: number = 500
): NextResponse<{ error: string }> {
  return NextResponse.json({ error: message }, { status });
}

export async function handleApiError<T>(
  fn: () => Promise<T | NextResponse<T | { error: string }>>
): Promise<NextResponse<T | { error: string }>> {
  try {
    const data = await fn();
    if (data instanceof NextResponse) {
      return data;
    }
    return apiResponse(data);
  } catch (err) {
    console.error("API Error:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";
    return apiError(message, 500);
  }
}
