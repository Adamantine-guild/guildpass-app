export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SERVER_ERROR"
  | "UPSTREAM_ERROR";

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  page: number;
  nextCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ApiErrorResponse {
  ok: false;
  code: ApiErrorCode;
  error: string;
  errorId?: string;
}

export interface ApiValidationErrorResponse {
  ok: false;
  code: "VALIDATION_ERROR";
  error: string;
  fields: ApiFieldError[];
}

export interface ApiUnsupportedResponse {
  ok: false;
  code: "UNSUPPORTED";
  error: string;
  unsupported: {
    feature: string;
    mode: string;
  };
}

export type ApiResult<T> =
  | ApiSuccess<T>
  | ApiErrorResponse
  | ApiValidationErrorResponse
  | ApiUnsupportedResponse;
