import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { exportJWK, generateKeyPair, importJWK, type JWK, type CryptoKey } from "jose";
import { Errors } from "../../common/errors.js";
import { seal, unseal } from "../../common/sealed.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { DatabaseService } from "../../infra/database.service.js";

export const SIGNING_ALG = "ES256";
const keyContext = (kid: string) => `oidc-signing-key:${kid}`;
/** Retired keys stay in the JWKS this long, so tokens signed just before a rotation still verify. */
const RETIRED_GRACE_MS = 24 * 3_600_000;

export interface ActiveKey {
  kid: string;
  privateKey: CryptoKey;
}

/**
 * Deployment-wide signing keys for ID and access tokens. Created on first use. The private
 * key is sealed with NF_DATA_KEY; the public half is published at the JWKS endpoint.
 */
@Injectable()
export class SigningKeys {
  private readonly logger = new Logger(SigningKeys.name);
  private active: Promise<ActiveKey> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

  private dataKey(): Buffer {
    if (!this.config.dataKey) {
      throw Errors.unavailable("Signing in to applications needs NF_DATA_KEY to be configured.");
    }
    return this.config.dataKey;
  }

  /** The key new tokens are signed with. */
  current(): Promise<ActiveKey> {
    this.active ??= this.loadOrCreate().catch((err: unknown) => {
      this.active = null;
      throw err;
    });
    return this.active;
  }

  private async loadOrCreate(): Promise<ActiveKey> {
    const key = this.dataKey();
    // Not tenant data: signing keys belong to the deployment.
    let row = await this.database.system.oidcSigningKey.findFirst({
      where: { retiredAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!row) {
      const { publicKey, privateKey } = await generateKeyPair(SIGNING_ALG, { extractable: true });
      const kid = randomBytes(12).toString("base64url");
      const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: SIGNING_ALG, use: "sig" };
      const privateJwk = JSON.stringify(await exportJWK(privateKey));
      await this.database.system.oidcSigningKey.create({
        data: {
          kid,
          alg: SIGNING_ALG,
          publicJwk,
          privateKeySealed: seal(key, privateJwk, keyContext(kid)),
        },
      });
      // Two processes may race to create one: everyone settles on the newest.
      row = await this.database.system.oidcSigningKey.findFirstOrThrow({
        where: { retiredAt: null },
        orderBy: { createdAt: "desc" },
      });
    }
    let jwk: JWK;
    try {
      jwk = JSON.parse(
        unseal(key, new Uint8Array(row.privateKeySealed), keyContext(row.kid)),
      ) as JWK;
    } catch {
      // Sealed with a different NF_DATA_KEY (the key was replaced): unusable for signing. Retire
      // it (its public half stays published for a day) and start a new one.
      this.logger.warn(
        { kid: row.kid },
        "signing key cannot be decrypted with NF_DATA_KEY; rotating",
      );
      await this.database.system.oidcSigningKey.updateMany({
        where: { kid: row.kid, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      return this.loadOrCreate();
    }
    return { kid: row.kid, privateKey: (await importJWK(jwk, SIGNING_ALG)) as CryptoKey };
  }

  /** Public keys for the JWKS endpoint: the active ones and recently retired ones. */
  async publicKeys(): Promise<JWK[]> {
    await this.current();
    const rows = await this.database.system.oidcSigningKey.findMany({
      where: {
        OR: [{ retiredAt: null }, { retiredAt: { gt: new Date(Date.now() - RETIRED_GRACE_MS) } }],
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => r.publicJwk as JWK);
  }

  /** Starts signing with a new key; the old one stays published for a day. */
  async rotate(): Promise<string> {
    await this.database.system.oidcSigningKey.updateMany({
      where: { retiredAt: null },
      data: { retiredAt: new Date() },
    });
    this.active = null;
    return (await this.current()).kid;
  }
}
