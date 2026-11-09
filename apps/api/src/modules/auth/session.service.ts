import { Inject, Injectable } from "@nestjs/common";
import type { ScopedTransaction } from "@nf/db";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuthorizationService } from "../authz/authorization.service.js";
import { hashToken, newSessionToken } from "./tokens.js";

/** Avoid a write on every request: refresh lastSeen/idle expiry at most once a minute. */
const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
  ) {}

  async create(tenantId: string, identityId: string, meta: RequestMeta) {
    const token = newSessionToken();
    const now = Date.now();
    const session = await this.database.db.session.create({
      data: {
        tenantId,
        identityId,
        tokenHash: hashToken(token),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        idleExpiresAt: new Date(now + this.config.session.idleMs),
        expiresAt: new Date(now + this.config.session.absoluteMs),
      },
    });
    return { token, session };
  }

  /**
   * Resolves a session token to a principal, or null if the token is unknown, revoked,
   * expired (idle or absolute), or the identity/tenant has been suspended.
   */
  async resolve(token: string): Promise<Principal | null> {
    if (!token || token.length > 128) return null;
    // Cross-tenant by definition: the token identifies the tenant.
    const session = await this.database.system.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { identity: true, tenant: true },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.idleExpiresAt <= now ||
      session.identity.status !== "active" ||
      session.tenant.status !== "active"
    ) {
      return null;
    }

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const idle = new Date(
        Math.min(now.getTime() + this.config.session.idleMs, session.expiresAt.getTime()),
      );
      await this.database.db.session.update({
        where: { id: session.id, tenantId: session.tenantId },
        data: { lastSeenAt: now, idleExpiresAt: idle },
      });
    }

    return {
      sessionId: session.id,
      identityId: session.identityId,
      tenantId: session.tenantId,
      email: session.identity.email,
      displayName: session.identity.displayName,
      permissions: await this.authz.permissionsFor(session.tenantId, session.identityId),
      sessionExpiresAt: session.expiresAt,
    };
  }

  async revoke(tenantId: string, sessionId: string) {
    await this.database.db.session.updateMany({
      where: { tenantId, id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Used when an identity is suspended: every active session ends immediately. */
  async revokeAllFor(
    tenantId: string,
    identityId: string,
    tx: Pick<ScopedTransaction, "session"> = this.database.db,
  ) {
    await tx.session.updateMany({
      where: { tenantId, identityId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
