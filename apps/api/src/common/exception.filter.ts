import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { ApiError, ApiErrorCode } from "@nf/contracts";
import { Prisma } from "@nf/db";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "./errors.js";

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
  503: "unavailable",
};

/** Maps every thrown error to the ApiError contract. Never leaks internals to the client. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ApiExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = String(req.id ?? "");
    const { status, body } = this.toResponse(exception);

    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, "Unhandled error");
    }
    body.error.requestId = requestId;
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: {
          error: { code: exception.code, message: exception.message, details: exception.details },
        },
      };
    }
    if (exception instanceof ZodError) {
      return {
        status: 400,
        body: {
          error: {
            code: "validation_failed",
            message: "Request validation failed",
            details: exception.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        },
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002")
        return {
          status: 409,
          body: { error: { code: "conflict", message: "The resource already exists" } },
        };
      if (exception.code === "P2025")
        return {
          status: 404,
          body: { error: { code: "not_found", message: "Resource not found" } },
        };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_CODES[status] ?? (status >= 500 ? "internal" : "bad_request");
      const message = status === 429 ? "Too many requests, slow down" : exception.message;
      return { status, body: { error: { code, message } } };
    }
    // Anything else (including TenantScopeViolation, a programming error) is a logged 500.
    return {
      status: 500,
      body: { error: { code: "internal", message: "An unexpected error occurred" } },
    };
  }
}
