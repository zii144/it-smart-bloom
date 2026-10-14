/**
 * Every JSON error this API returns carries a stable machine-readable `code`
 * next to the guest-facing Chinese `error` message. Clients branch on the code;
 * only humans read the message, so the wording can change without breaking a
 * caller. Codes are append-only — never repurpose one.
 */
export const ERROR_CODES = [
  // Request shape
  "IMAGE_REQUIRED",
  "IMAGE_INVALID",
  "IMAGE_TOO_LARGE",
  "IMAGE_TYPE_UNSUPPORTED",
  "IMAGE_OPTIONS_INVALID",
  "IMAGE_KIND_INVALID",
  // Guest identity
  "IDENTITY_REQUIRED",
  "IDENTITY_INVALID",
  "IDENTITY_TOO_LONG",
  "IDENTITY_LOCKED",
  "IDENTITY_ANSWER_WRONG",
  "IDENTITY_CHALLENGE_EXPIRED",
  "IDENTITY_TOKEN_INVALID",
  "IDENTITY_SERVICE_UNAVAILABLE",
  // Session lifecycle
  "SESSION_NOT_FOUND",
  "SOURCE_PHOTO_NOT_FOUND",
  "PORTRAIT_NOT_FOUND",
  "PORTRAIT_NOT_READY",
  // Server / dependencies
  "IDENTITY_KEY_UNAVAILABLE",
  "ARCHIVE_UNAVAILABLE",
  "ENVIRONMENT_MISCONFIGURED",
  "GENERATION_FAILED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Base for every error that maps onto an HTTP response. Carrying `status` and
 * `code` on the error itself means a route's catch block never has to guess
 * which status a failure deserves.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** A dependency or environment variable the server needs is not configured. */
export class ConfigError extends AppError {
  constructor(message: string, code: ErrorCode) {
    super(message, 503, code);
    this.name = "ConfigError";
  }
}

/** Error responses are never cacheable — they are specific to one request. */
export function errorJson(
  code: ErrorCode,
  message: string,
  status: number,
): Response {
  return Response.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Turns a thrown value into the response it deserves. Anything that is not an
 * AppError is an unexpected server fault: it is logged with `context` and
 * answered with a generic message, so internal detail never reaches a guest.
 */
export function errorResponse(
  error: unknown,
  context: string,
  fallback: { message: string; code?: ErrorCode; status?: number },
): Response {
  if (error instanceof AppError) {
    return errorJson(error.code, error.message, error.status);
  }

  console.error(`${context}:`, error);
  return errorJson(
    fallback.code ?? "INTERNAL_ERROR",
    fallback.message,
    fallback.status ?? 500,
  );
}
