/**
 * Minimal Microsoft Graph client for read-only directory sync (application permissions:
 * User.Read.All, GroupMember.Read.All). No SDK: the surface we need is small, and owning it
 * lets us enforce the safety rules below.
 *
 * - Client credentials token from the Microsoft identity platform, cached until near expiry.
 * - Follows @odata.nextLink / @odata.deltaLink only if they stay on the configured Graph
 *   origin (a tampered or unexpected link can't make us send the token elsewhere).
 * - Honours 429/503/504 with Retry-After (bounded), and reports an expired delta token
 *   (410 Gone / syncStateNotFound) as DeltaExpiredError so the caller can resync in full.
 */

export interface GraphEndpoints {
  authorityUrl: string;
  apiUrl: string;
}

export interface GraphCredentials {
  directoryId: string;
  clientId: string;
  clientSecret: string;
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when retrying later may succeed (throttling, outages, network). */
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export class DeltaExpiredError extends Error {
  constructor() {
    super("The directory's change-tracking token expired; a full sync is required");
    this.name = "DeltaExpiredError";
  }
}

export interface GraphPage<T> {
  items: T[];
  /** Present on the last page of a delta query. */
  deltaLink: string | null;
}

type Fetch = typeof fetch;
const MAX_RETRIES = 5;
const MAX_RETRY_AFTER_S = 120;
const REQUEST_TIMEOUT_MS = 60_000;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function graphErrorText(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { error?: unknown; error_description?: unknown };
    if (typeof body.error === "object" && body.error !== null) {
      const e = body.error as { code?: unknown; message?: unknown };
      return { code: String(e.code ?? ""), message: String(e.message ?? "") };
    }
    // Token endpoint errors (RFC 6749).
    return {
      code: String(body.error ?? ""),
      message: String(body.error_description ?? "").split("\r\n")[0] ?? "",
    };
  } catch {
    return { code: "", message: "" };
  }
}

export class GraphClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly graphOrigin: string;

  constructor(
    private readonly endpoints: GraphEndpoints,
    private readonly creds: GraphCredentials,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.graphOrigin = new URL(endpoints.apiUrl).origin;
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const url = `${this.endpoints.authorityUrl}/${encodeURIComponent(this.creds.directoryId)}/oauth2/v2.0/token`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
          scope: `${this.graphOrigin}/.default`,
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new GraphError("Couldn't reach the Microsoft identity platform", 0, true);
    }
    if (!res.ok) {
      const { code, message } = await graphErrorText(res);
      const transient = res.status >= 500 || res.status === 429;
      const hint =
        code === "invalid_client"
          ? "The client secret is wrong or expired"
          : code === "unauthorized_client"
            ? "The application ID isn't registered in this directory"
            : code === "invalid_request" && /tenant/i.test(message)
              ? "The directory (tenant) ID wasn't found"
              : message || `Token request failed (${res.status})`;
      throw new GraphError(hint, res.status, transient);
    }
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string") {
      throw new GraphError("The token response had no access token", res.status, false);
    }
    const ttl = typeof body.expires_in === "number" ? body.expires_in : 3599;
    this.token = { value: body.access_token, expiresAt: Date.now() + ttl * 1000 };
    return body.access_token;
  }

  /** Only follow links on the configured Graph origin (SSRF / token-leak guard). */
  private checkLink(link: string): string {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new GraphError("Graph returned an invalid paging link", 0, false);
    }
    if (url.origin !== this.graphOrigin) {
      throw new GraphError(`Graph returned a paging link to another host (${url.host})`, 0, false);
    }
    return url.toString();
  }

  async get<T>(pathOrUrl: string, signal?: AbortSignal): Promise<T> {
    const url = pathOrUrl.startsWith("http")
      ? this.checkLink(pathOrUrl)
      : `${this.endpoints.apiUrl}${pathOrUrl}`;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(signal);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt, signal);
          continue;
        }
        throw new GraphError("Couldn't reach Microsoft Graph", 0, true);
      }
      if (res.ok) return (await res.json()) as T;

      if (res.status === 401 && attempt === 0) {
        this.token = null; // token revoked or rotated: fetch a fresh one once
        continue;
      }
      if (
        (res.status === 429 || res.status === 503 || res.status === 504) &&
        attempt < MAX_RETRIES
      ) {
        const header = Number(res.headers.get("retry-after"));
        const waitS =
          Number.isFinite(header) && header > 0
            ? Math.min(header, MAX_RETRY_AFTER_S)
            : 2 ** attempt;
        await sleep(waitS * 1000, signal);
        continue;
      }
      const { code, message } = await graphErrorText(res);
      if (res.status === 410 || /syncStateNotFound|resyncRequired/i.test(code)) {
        throw new DeltaExpiredError();
      }
      const hint =
        res.status === 403
          ? "Access denied — grant the application User.Read.All and GroupMember.Read.All (application permissions) with admin consent"
          : message || `Graph request failed (${res.status})`;
      throw new GraphError(hint, res.status, res.status >= 500 || res.status === 429);
    }
  }

  /** Iterates the pages of a (delta) collection, ending with the delta link if there is one. */
  async *pages<T>(start: string, signal?: AbortSignal): AsyncGenerator<GraphPage<T>> {
    let next: string | null = start;
    while (next) {
      const page: {
        value?: T[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      } = await this.get(next, signal);
      const deltaLink = page["@odata.deltaLink"] ? this.checkLink(page["@odata.deltaLink"]) : null;
      next = page["@odata.nextLink"] ? this.checkLink(page["@odata.nextLink"]) : null;
      yield { items: Array.isArray(page.value) ? page.value : [], deltaLink };
    }
  }
}
