import type { ApiErrorCode } from "@nf/contracts";

/** Domain error with a stable machine-readable code. Thrown by services, mapped by the filter. */
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  badRequest: (message: string) => new AppError("bad_request", 400, message),
  unauthenticated: (message = "Sign in required") => new AppError("unauthenticated", 401, message),
  forbidden: (message = "You do not have permission to do this") =>
    new AppError("forbidden", 403, message),
  notFound: (what: string) => new AppError("not_found", 404, `${what} not found`),
  conflict: (message: string) => new AppError("conflict", 409, message),
  unavailable: (message: string) => new AppError("unavailable", 503, message),
};
