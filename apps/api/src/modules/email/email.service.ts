import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type EmailDelivery,
  type EmailKind,
  type EmailSettings,
  type EmailTestResult,
  SMTP_PORTS,
  type UpsertEmailSettings,
} from "@nf/contracts";
import type { ScopedTransaction, TenantEmailSettings } from "@nf/db";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { hintOf, seal, unseal } from "../../common/sealed.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { type ClaimedJob, JobQueue, PermanentJobError } from "../jobs/job-queue.js";
import type { JobContext, JobHandler } from "../jobs/job-worker.js";
import { buildMessage } from "./mime.js";
import { isLoopback, sendMail, SmtpError, type SmtpOptions } from "./smtp.js";
import { type RenderedEmail, testEmail } from "./templates.js";

export const EMAIL_JOB = "email.send";
const passwordContext = (tenantId: string) => `smtp-password:${tenantId}`;
const bodyContext = (tenantId: string, id: string) => `email-body:${tenantId}:${id}`;

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private ca: string | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobQueue,
  ) {
    if (config.smtpCaFile) this.ca = readFileSync(config.smtpCaFile, "utf8");
  }

  private dataKey(): Buffer {
    if (!this.config.dataKey)
      throw Errors.unavailable("Email delivery needs NF_DATA_KEY to be configured.");
    return this.config.dataKey;
  }

  private toDto(row: TenantEmailSettings): EmailSettings {
    return {
      host: row.host,
      port: row.port,
      security: row.security as EmailSettings["security"],
      username: row.username,
      passwordHint: row.passwordSealed ? row.passwordHint : null,
      fromAddress: row.fromAddress,
      fromName: row.fromName,
      enabled: row.enabled,
      lastTest: row.lastTestAt
        ? { at: row.lastTestAt.toISOString(), ok: !!row.lastTestOk, message: row.lastTestMessage }
        : null,
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    };
  }

  async get(tenantId: string): Promise<EmailSettings | null> {
    const row = await this.database.db.tenantEmailSettings.findUnique({ where: { tenantId } });
    return row ? this.toDto(row) : null;
  }

  /** Email can be sent for this tenant right now. */
  async available(tenantId: string): Promise<boolean> {
    if (!this.config.dataKey) return false;
    const row = await this.database.db.tenantEmailSettings.findUnique({
      where: { tenantId },
      select: { enabled: true },
    });
    return !!row?.enabled;
  }

  /**
   * Which servers an organisation may point us at. The API connects to whatever is configured,
   * so ports are limited to mail ports (no scanning other internal services through us), and
   * link-local/metadata addresses are refused. A relay on this machine may use any port.
   */
  private assertSafeTarget(input: UpsertEmailSettings) {
    if (/^169\.254\.|^\[?fe80:/i.test(input.host) || input.host === "0.0.0.0") {
      throw Errors.badRequest("That address can't be used for a mail server.");
    }
    if (!isLoopback(input.host) && !(SMTP_PORTS as readonly number[]).includes(input.port)) {
      throw Errors.badRequest(
        `Use a mail port (${SMTP_PORTS.join(", ")}), or a relay on this server.`,
      );
    }
    if (input.security === "none" && !isLoopback(input.host)) {
      throw Errors.badRequest(
        "Unencrypted connections are only allowed to a relay on this server. Choose STARTTLS or TLS.",
      );
    }
  }

  async upsert(
    actor: Principal,
    input: UpsertEmailSettings,
    meta: RequestMeta,
  ): Promise<EmailSettings> {
    const tenantId = actor.tenantId;
    this.assertSafeTarget(input);
    const key = this.dataKey();
    const existing = await this.database.db.tenantEmailSettings.findUnique({ where: { tenantId } });
    if (existing && input.version !== existing.version) {
      throw Errors.conflict("The email settings were changed by someone else. Reload and retry.");
    }
    const password =
      input.password === undefined
        ? undefined
        : input.password === null || input.password === ""
          ? { passwordSealed: null, passwordHint: null }
          : {
              passwordSealed: seal(key, input.password, passwordContext(tenantId)),
              passwordHint: hintOf(input.password),
            };
    if (input.username && !password && !existing?.passwordSealed) {
      throw Errors.badRequest("Enter the password for that user name.");
    }
    const data = {
      host: input.host,
      port: input.port,
      security: input.security,
      username: input.username || null,
      fromAddress: input.fromAddress,
      fromName: input.fromName,
      enabled: input.enabled,
      ...(password ?? {}),
      // A changed server needs a new successful test.
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
    };
    await this.database.db.$transaction(async (tx) => {
      if (existing) {
        const res = await tx.tenantEmailSettings.updateMany({
          where: { tenantId, version: existing.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (res.count !== 1)
          throw Errors.conflict("The email settings were changed by someone else.");
      } else {
        await tx.tenantEmailSettings.create({ data: { tenantId, ...data } });
      }
      await this.audit.record(
        {
          tenantId,
          action: "tenant.email_configured",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          meta,
          metadata: {
            host: input.host,
            port: input.port,
            security: input.security,
            fromAddress: input.fromAddress,
            enabled: input.enabled,
            passwordChanged: password !== undefined,
          },
        },
        tx,
      );
    });
    return (await this.get(tenantId))!;
  }

  async remove(actor: Principal, meta: RequestMeta) {
    const tenantId = actor.tenantId;
    await this.database.db.$transaction(async (tx) => {
      const res = await tx.tenantEmailSettings.deleteMany({ where: { tenantId } });
      if (res.count === 0) throw Errors.notFound("Email settings");
      await this.audit.record(
        {
          tenantId,
          action: "tenant.email_removed",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          meta,
        },
        tx,
      );
    });
  }

  private smtpOptions(row: TenantEmailSettings): SmtpOptions {
    return {
      host: row.host,
      port: row.port,
      security: row.security as SmtpOptions["security"],
      username: row.username,
      password: row.passwordSealed
        ? unseal(this.dataKey(), new Uint8Array(row.passwordSealed), passwordContext(row.tenantId))
        : null,
      clientName: this.config.publicUrl.hostname || hostname(),
      ...(this.ca ? { ca: this.ca } : {}),
    };
  }

  private async deliver(
    row: TenantEmailSettings,
    to: string,
    mail: RenderedEmail,
  ): Promise<string> {
    const message = buildMessage({
      from: { address: row.fromAddress, name: row.fromName },
      to,
      ...mail,
    });
    return sendMail(this.smtpOptions(row), { from: row.fromAddress, to: [to] }, message);
  }

  /** Sends a test to the person asking, right away, and records the outcome on the settings. */
  async sendTest(actor: Principal): Promise<EmailTestResult> {
    const tenantId = actor.tenantId;
    const row = await this.database.db.tenantEmailSettings.findUnique({ where: { tenantId } });
    if (!row) throw Errors.conflict("Save the email settings first.");
    const tenant = await this.database.system.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    let ok = false;
    let message: string;
    try {
      const reply = await this.deliver(
        row,
        actor.email,
        testEmail({ tenantName: tenant.name, requestedBy: actor.displayName }),
      );
      ok = true;
      message = `Accepted by the mail server: ${reply}`;
    } catch (err) {
      message = err instanceof SmtpError ? err.message : "The message could not be sent.";
      if (!(err instanceof SmtpError)) this.logger.warn({ err: String(err) }, "test email failed");
    }
    message = message.slice(0, 500);
    await this.database.db.tenantEmailSettings.updateMany({
      where: { tenantId },
      data: { lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message },
    });
    // Keep the delivery log complete: tests appear under Recent messages too (no body stored).
    await this.database.db.emailMessage.create({
      data: {
        tenantId,
        kind: "test",
        toAddress: actor.email,
        subject: "Neural Frontier: email delivery works",
        status: ok ? "sent" : "failed",
        attempts: 1,
        lastError: ok ? null : message,
        sentAt: ok ? new Date() : null,
      },
    });
    return { ok, message, to: actor.email };
  }

  /**
   * Queues a message for the worker. The body is sealed (it may hold a one-time link) and
   * erased after sending. Returns null when this organisation has no email delivery.
   */
  async queue(
    tenantId: string,
    to: string,
    kind: EmailKind,
    mail: RenderedEmail,
    tx?: ScopedTransaction,
  ): Promise<string | null> {
    if (!(await this.available(tenantId))) return null;
    const key = this.dataKey();
    const run = async (t: ScopedTransaction) => {
      const created = await t.emailMessage.create({
        data: { tenantId, kind, toAddress: to, subject: mail.subject.slice(0, 255) },
      });
      await t.emailMessage.update({
        where: { id: created.id, tenantId },
        data: { bodySealed: seal(key, JSON.stringify(mail), bodyContext(tenantId, created.id)) },
      });
      await this.jobs.enqueue(
        { tenantId, type: EMAIL_JOB, payload: { messageId: created.id }, maxAttempts: 6 },
        t,
      );
      return created.id;
    };
    return tx ? run(tx) : this.database.db.$transaction(run);
  }

  async deliveries(tenantId: string): Promise<EmailDelivery[]> {
    const rows = await this.database.db.emailMessage.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as EmailKind,
      to: r.toAddress,
      subject: r.subject,
      status: r.status as EmailDelivery["status"],
      attempts: r.attempts,
      error: r.lastError,
      createdAt: r.createdAt.toISOString(),
      sentAt: iso(r.sentAt),
    }));
  }

  // ───────── used by the worker ─────────

  async sendQueued(tenantId: string, messageId: string, attempt: number): Promise<void> {
    const db = this.database.db;
    const msg = await db.emailMessage.findUnique({ where: { id: messageId, tenantId } });
    if (!msg || msg.status === "sent") return;
    if (!msg.bodySealed) throw new PermanentJobError("The message body is gone");
    const settings = await db.tenantEmailSettings.findUnique({ where: { tenantId } });
    if (!settings?.enabled)
      throw new PermanentJobError("Email delivery is not set up or is turned off");
    const mail = JSON.parse(
      unseal(this.dataKey(), new Uint8Array(msg.bodySealed), bodyContext(tenantId, messageId)),
    ) as RenderedEmail;
    await db.emailMessage.updateMany({
      where: { id: messageId, tenantId },
      data: { attempts: attempt },
    });
    try {
      await this.deliver(settings, msg.toAddress, mail);
    } catch (err) {
      if (err instanceof SmtpError && err.permanent) throw new PermanentJobError(err.message);
      throw err;
    }
    await db.emailMessage.updateMany({
      where: { id: messageId, tenantId },
      data: { status: "sent", sentAt: new Date(), bodySealed: null, lastError: null },
    });
  }

  async markRetry(tenantId: string, messageId: string, error: string) {
    await this.database.db.emailMessage.updateMany({
      where: { id: messageId, tenantId },
      data: { lastError: error.slice(0, 500) },
    });
  }

  async markFailed(tenantId: string, messageId: string, error: string) {
    await this.database.db.emailMessage.updateMany({
      where: { id: messageId, tenantId, status: { not: "sent" } },
      data: { status: "failed", bodySealed: null, lastError: error.slice(0, 500) },
    });
  }
}

function messageIdOf(job: ClaimedJob): string {
  const id = job.payload.messageId;
  if (typeof id !== "string") throw new PermanentJobError("Malformed email job");
  return id;
}

/** Worker handler for `email.send`: retried with backoff; given up after 6 attempts. */
@Injectable()
export class EmailSendHandler implements JobHandler {
  readonly type = EMAIL_JOB;
  constructor(private readonly email: EmailService) {}

  run({ job }: JobContext) {
    return this.email.sendQueued(job.tenantId, messageIdOf(job), job.attempts);
  }
  onRetry(job: ClaimedJob, error: string) {
    return this.email.markRetry(job.tenantId, messageIdOf(job), error);
  }
  onDead(job: ClaimedJob, error: string) {
    return this.email.markFailed(job.tenantId, messageIdOf(job), error);
  }
}
