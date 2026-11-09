import { ApiErrorSchema, type ApiErrorCode } from "@nf/contracts";
import type { z } from "zod";

/** A failed API call, carrying the contract's stable error code and the request id for support. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | "network",
    message: string,
    readonly requestId?: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

let csrfToken: string | null = null;

/** Set from the session response; echoed on every state-changing request. */
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function signInUrl(returnTo?: string) {
  const target = returnTo ?? `${window.location.pathname}${window.location.search}`;
  return `/sign-in?returnTo=${encodeURIComponent(target)}`;
}

export async function toApiError(res: Response): Promise<ApiRequestError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    const e = parsed.data.error;
    return new ApiRequestError(res.status, e.code, e.message, e.requestId, e.details);
  }
  return new ApiRequestError(
    res.status,
    res.status >= 500 ? "internal" : "bad_request",
    `Request failed (${res.status})`,
  );
}

interface RequestOptions<T extends z.ZodType> {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Validate the response against the shared contract. */
  schema?: T;
  signal?: AbortSignal;
}

export async function api<T extends z.ZodType = z.ZodUnknown>(
  path: string,
  opts: RequestOptions<T> = {},
): Promise<z.infer<T>> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch {
    throw new ApiRequestError(0, "network", "Can't reach Neural Frontier. Check your connection.");
  }

  if (
    res.status === 401 &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/sign-in")
  ) {
    window.location.replace(new URL(signInUrl(), window.location.origin).href);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as z.infer<T>;
  const data: unknown = await res.json();
  return (opts.schema ? opts.schema.parse(data) : data) as z.infer<T>;
}
