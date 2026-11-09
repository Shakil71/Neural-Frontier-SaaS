import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.js";
import { assertTenantScoped } from "./tenant-guard.js";

export interface DatabaseOptions {
  /** mysql://user:password@host:port/database[?connectionLimit=10&allowPublicKeyRetrieval=true] */
  url: string;
}

function poolConfigFromUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
    throw new Error("DATABASE_URL must use the mysql:// scheme");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL must include a database name");
  const params = url.searchParams;
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: Number(params.get("connectionLimit") ?? 10),
    // MySQL 8 caching_sha2_password over a non-TLS loopback connection needs the server's
    // RSA key. Only enable this for 127.0.0.1/localhost connections.
    allowPublicKeyRetrieval: params.get("allowPublicKeyRetrieval") === "true",
    timezone: "Z",
  };
}

export function createPrismaClient(options: DatabaseOptions): PrismaClient {
  const adapter = new PrismaMariaDb(poolConfigFromUrl(options.url));
  return new PrismaClient({ adapter });
}

/**
 * The scoped client is what application code uses. Every query on a tenant-owned
 * model must carry `tenantId` or it throws before reaching the database.
 */
export function withTenantGuard(client: PrismaClient) {
  return client.$extends({
    name: "tenant-guard",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          assertTenantScoped(model, operation, args);
          return query(args);
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof withTenantGuard>;

export { poolConfigFromUrl as _poolConfigFromUrl };

/** The `tx` handed to `db.$transaction(async (tx) => …)` on the scoped client. Still tenant-guarded. */
export type ScopedTransaction = Omit<
  ScopedPrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
