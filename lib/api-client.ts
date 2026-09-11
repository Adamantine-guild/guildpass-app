import type {
  ApiErrorResponse,
  ApiResult,
  ApiUnsupportedResponse,
  ApiValidationErrorResponse,
} from "./api-contracts";

type ApiFailure =
  | ApiErrorResponse
  | ApiValidationErrorResponse
  | ApiUnsupportedResponse;

export class ApiClientError extends Error {
  status: number;
  code: ApiFailure["code"];
  fields?: ApiValidationErrorResponse["fields"];
  unsupported?: ApiUnsupportedResponse["unsupported"];

  constructor(response: Response, payload: ApiFailure) {
    super(payload.error);
    this.name = "ApiClientError";
    this.status = response.status;
    this.code = payload.code;

    if (payload.code === "VALIDATION_ERROR") {
      this.fields = payload.fields;
    }

    if (payload.code === "UNSUPPORTED") {
      this.unsupported = payload.unsupported;
    }
  }
}

export async function readApiResult<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!payload || typeof payload !== "object" || typeof payload.ok !== "boolean") {
    throw new Error(`Unexpected API response (${response.status})`);
  }

  if (payload.ok) {
    return payload.data;
  }

  throw new ApiClientError(response, payload);
}
