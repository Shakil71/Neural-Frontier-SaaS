import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A scripted stand-in for the Microsoft identity platform + Microsoft Graph, speaking the
 * same wire format (token endpoint, delta queries with nextLink/deltaLink, @removed,
 * members@delta, 429 + Retry-After). Each phase is what the next delta query returns.
 */
export interface MockDirectory {
  url: string;
  clientId: string;
  clientSecret: string;
  directoryId: string;
  /** Requests seen, e.g. "GET /v1.0/users/delta". */
  log: string[];
  /** Make the next N Graph requests answer 429 with Retry-After: 1. */
  throttleNext(n: number): void;
  /** Make every delta-link request answer 410 Gone (expired change token). */
  expireDeltaTokens(on: boolean): void;
  close(): Promise<void>;
}

const U = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const G = (n: number) => `10000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
export const ids = { U, G };

const fullUsersPage1 = [
  {
    id: U(1),
    displayName: "Ada Lovelace",
    userPrincipalName: "ada@contoso.example",
    mail: "ada@contoso.example",
    accountEnabled: true,
    jobTitle: "Engineer",
    department: "R&D",
  },
  {
    id: U(2),
    displayName: "Grace Hopper",
    userPrincipalName: "grace@contoso.example",
    mail: "grace@contoso.example",
    accountEnabled: true,
    jobTitle: "Admiral",
    department: "Navy",
  },
];
const fullUsersPage2 = [
  {
    id: U(3),
    displayName: "Alan Turing",
    userPrincipalName: "alan@contoso.example",
    mail: null,
    accountEnabled: false,
    jobTitle: null,
    department: "R&D",
  },
];
const fullGroups = [
  {
    id: G(1),
    displayName: "Engineering",
    description: "All engineers",
    mail: "eng@contoso.example",
    mailEnabled: true,
    securityEnabled: true,
    groupTypes: ["Unified"],
    "members@delta": [
      { "@odata.type": "#microsoft.graph.user", id: U(1) },
      { "@odata.type": "#microsoft.graph.user", id: U(3) },
    ],
  },
];

// Second sync (delta): Grace renamed (only changed property sent), Alan deleted,
// Alan removed from Engineering, Grace added.
const deltaUsers = [
  { id: U(2), displayName: "Rear Admiral Grace Hopper" },
  { id: U(3), "@removed": { reason: "deleted" } },
];
const deltaGroups = [
  {
    id: G(1),
    "members@delta": [
      { "@odata.type": "#microsoft.graph.user", id: U(3), "@removed": { reason: "deleted" } },
      { "@odata.type": "#microsoft.graph.user", id: U(2) },
    ],
  },
];

export async function startMockDirectory(): Promise<MockDirectory> {
  const clientId = "11111111-2222-4333-8444-555555555555";
  const clientSecret = "mock-client-secret-value";
  const directoryId = "contoso.onmicrosoft.com";
  const log: string[] = [];
  let throttle = 0;
  let expireDelta = false;
  let base = "";

  const json = (
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c: Buffer) => (data += c.toString()));
      req.on("end", () => resolve(data));
    });

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", base);
      log.push(`${req.method} ${url.pathname}`);

      if (req.method === "POST" && url.pathname === `/${directoryId}/oauth2/v2.0/token`) {
        const form = new URLSearchParams(await readBody(req));
        if (form.get("client_id") !== clientId)
          return json(res, 400, {
            error: "unauthorized_client",
            error_description: "AADSTS700016: app not found",
          });
        if (form.get("client_secret") !== clientSecret)
          return json(res, 401, {
            error: "invalid_client",
            error_description: "AADSTS7000215: Invalid client secret",
          });
        return json(res, 200, {
          token_type: "Bearer",
          expires_in: 3599,
          access_token: "mock-graph-token",
        });
      }

      if (req.headers.authorization !== "Bearer mock-graph-token") {
        return json(res, 401, {
          error: { code: "InvalidAuthenticationToken", message: "no token" },
        });
      }
      if (throttle > 0) {
        throttle--;
        return json(
          res,
          429,
          { error: { code: "TooManyRequests", message: "slow down" } },
          { "Retry-After": "1" },
        );
      }

      const p = url.pathname;
      const token = url.searchParams.get("$deltatoken");
      const skip = url.searchParams.get("$skiptoken");
      if (token && expireDelta) {
        return json(res, 410, { error: { code: "syncStateNotFound", message: "expired" } });
      }
      if (p === "/v1.0/users" || p === "/v1.0/groups") return json(res, 200, { value: [] });
      if (p === "/v1.0/users/delta") {
        if (token === "users-1") {
          return json(res, 200, {
            value: deltaUsers,
            "@odata.deltaLink": `${base}/v1.0/users/delta?$deltatoken=users-2`,
          });
        }
        if (token === "users-2") {
          return json(res, 200, {
            value: [],
            "@odata.deltaLink": `${base}/v1.0/users/delta?$deltatoken=users-2`,
          });
        }
        if (skip === "page2") {
          return json(res, 200, {
            value: fullUsersPage2,
            "@odata.deltaLink": `${base}/v1.0/users/delta?$deltatoken=users-1`,
          });
        }
        return json(res, 200, {
          value: fullUsersPage1,
          "@odata.nextLink": `${base}/v1.0/users/delta?$skiptoken=page2`,
        });
      }
      if (p === "/v1.0/groups/delta") {
        if (token === "groups-1") {
          return json(res, 200, {
            value: deltaGroups,
            "@odata.deltaLink": `${base}/v1.0/groups/delta?$deltatoken=groups-2`,
          });
        }
        if (token === "groups-2") {
          return json(res, 200, {
            value: [],
            "@odata.deltaLink": `${base}/v1.0/groups/delta?$deltatoken=groups-2`,
          });
        }
        return json(res, 200, {
          value: fullGroups,
          "@odata.deltaLink": `${base}/v1.0/groups/delta?$deltatoken=groups-1`,
        });
      }
      return json(res, 404, { error: { code: "Request_ResourceNotFound", message: p } });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    clientId,
    clientSecret,
    directoryId,
    log,
    throttleNext: (n) => {
      throttle = n;
    },
    expireDeltaTokens: (on) => {
      expireDelta = on;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
