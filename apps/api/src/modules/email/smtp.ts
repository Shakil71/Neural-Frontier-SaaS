import { isIP, type Socket, connect as tcpConnect } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

/**
 * A small SMTP client (RFC 5321) on node:net / node:tls: EHLO, STARTTLS (RFC 3207),
 * AUTH PLAIN / LOGIN (RFC 4954), MAIL, RCPT, DATA, QUIT. Certificates are always verified.
 * Written in-house so Neural Frontier needs no mail library or external mail service.
 */
export interface SmtpOptions {
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  username?: string | null;
  password?: string | null;
  /** Name announced in EHLO. */
  clientName: string;
  timeoutMs?: number;
  /** Extra trusted CA certificates (PEM), e.g. an internal relay's own CA. Never disables checks. */
  ca?: string;
}

export class SmtpError extends Error {
  constructor(
    message: string,
    /** The server's reply code, when the server answered. */
    readonly code: number | null = null,
    /** 4xx and connection problems are worth retrying; 5xx are not. */
    readonly permanent = false,
  ) {
    super(message);
    this.name = "SmtpError";
  }
}

interface Reply {
  code: number;
  lines: string[];
}

export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || (isIP(h) === 4 && h.startsWith("127."));
}

/** Reads CRLF-terminated replies; a reply ends at a line whose 4th character is a space. */
class Connection {
  private buffer = "";
  private waiting: ((r: Reply | Error) => void) | null = null;
  private pending: Reply[] = [];
  private current: string[] = [];
  private failure: Error | null = null;

  constructor(
    public socket: Socket | TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.attach(socket);
  }

  attach(socket: Socket | TLSSocket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.setTimeout(this.timeoutMs);
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("timeout", () => this.fail(new SmtpError("The mail server stopped responding")));
    socket.on("error", (err) => this.fail(new SmtpError(friendlyNetError(err))));
    socket.on("close", () => this.fail(new SmtpError("The mail server closed the connection")));
  }

  /** Before STARTTLS: stop reading the plain socket (the TLS socket takes over). */
  detach() {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("timeout");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 64 * 1024) return this.fail(new SmtpError("Reply too long"));
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      const m = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!m)
        return this.fail(
          new SmtpError(`Unexpected reply from the mail server: ${line.slice(0, 120)}`),
        );
      this.current.push(m[3]!);
      if (m[2] === " ") {
        const reply = { code: Number(m[1]), lines: this.current };
        this.current = [];
        if (this.waiting) {
          const w = this.waiting;
          this.waiting = null;
          w(reply);
        } else this.pending.push(reply);
      }
    }
  }

  private fail(err: Error) {
    this.failure ??= err;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w(err);
    }
  }

  read(): Promise<Reply> {
    const next = this.pending.shift();
    if (next) return Promise.resolve(next);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = (r) => (r instanceof Error ? reject(r) : resolve(r));
    });
  }

  async command(line: string | null, expect: number[], what: string): Promise<Reply> {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (!expect.includes(reply.code)) {
      const text = reply.lines.join(" ").slice(0, 300);
      throw new SmtpError(`${what} refused (${reply.code} ${text})`, reply.code, reply.code >= 500);
    }
    return reply;
  }
}

function friendlyNetError(err: NodeJS.ErrnoException): string {
  switch (err.code) {
    case "ECONNREFUSED":
      return "Connection refused: nothing is listening on that host and port";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "The mail server's host name could not be resolved";
    case "ETIMEDOUT":
      return "Timed out connecting to the mail server";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "CERT_HAS_EXPIRED":
      return `The mail server's certificate is not trusted (${err.code})`;
    default:
      return err.message;
  }
}

function open(opts: SmtpOptions, timeoutMs: number): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const host = opts.host.replace(/^\[|\]$/g, "");
    const socket =
      opts.security === "tls"
        ? tlsConnect({
            host,
            port: opts.port,
            servername: isIP(host) ? undefined : host,
            timeout: timeoutMs,
            ...(opts.ca ? { ca: opts.ca } : {}),
          })
        : tcpConnect({ host, port: opts.port, timeout: timeoutMs });
    const ready = opts.security === "tls" ? "secureConnect" : "connect";
    const onError = (err: NodeJS.ErrnoException) => reject(new SmtpError(friendlyNetError(err)));
    socket.once("error", onError);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new SmtpError("Timed out connecting to the mail server"));
    });
    socket.once(ready, () => {
      socket.off("error", onError);
      socket.removeAllListeners("timeout");
      resolve(socket);
    });
  });
}

function upgrade(socket: Socket, host: string, timeoutMs: number, ca?: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const bare = host.replace(/^\[|\]$/g, "");
    const tls = tlsConnect({
      socket,
      servername: isIP(bare) ? undefined : bare,
      ...(ca ? { ca } : {}),
    });
    const timer = setTimeout(() => reject(new SmtpError("TLS handshake timed out")), timeoutMs);
    tls.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(tls);
    });
    tls.once("error", (err) => {
      clearTimeout(timer);
      reject(new SmtpError(friendlyNetError(err)));
    });
  });
}

/** Dot-stuffing and CRLF line endings for DATA (RFC 5321 §4.5.2). */
export function encodeData(message: string): string {
  const normal = message.replace(/\r?\n/g, "\r\n");
  const stuffed = normal.replace(/^\./gm, "..");
  return `${stuffed}${stuffed.endsWith("\r\n") ? "" : "\r\n"}.\r\n`;
}

function extensions(reply: Reply): Set<string> {
  return new Set(reply.lines.slice(1).map((l) => l.toUpperCase()));
}

/** Sends one message. Resolves with the server's acceptance reply. */
export async function sendMail(
  opts: SmtpOptions,
  envelope: { from: string; to: string[] },
  message: string,
): Promise<string> {
  for (const addr of [envelope.from, ...envelope.to]) {
    if (/[\r\n<>]/.test(addr)) throw new SmtpError("Invalid address", null, true);
  }
  if (opts.security === "none" && opts.username && !isLoopback(opts.host)) {
    throw new SmtpError(
      "Refusing to send a password without encryption to a remote server",
      null,
      true,
    );
  }
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const conn = new Connection(await open(opts, timeoutMs), timeoutMs);
  try {
    await conn.command(null, [220], "Greeting");
    let ehlo = await conn.command(`EHLO ${opts.clientName}`, [250], "EHLO");
    if (opts.security === "starttls") {
      if (!extensions(ehlo).has("STARTTLS")) {
        throw new SmtpError(
          "The mail server doesn't offer STARTTLS. Choose TLS or check the port.",
          null,
          true,
        );
      }
      await conn.command("STARTTLS", [220], "STARTTLS");
      conn.detach();
      conn.attach(await upgrade(conn.socket as Socket, opts.host, timeoutMs, opts.ca));
      ehlo = await conn.command(`EHLO ${opts.clientName}`, [250], "EHLO after STARTTLS");
    }
    if (opts.username) {
      const auth = [...extensions(ehlo)].find((e) => e.startsWith("AUTH"))?.split(/[ =]/) ?? [];
      const password = opts.password ?? "";
      if (auth.includes("PLAIN") || !auth.includes("LOGIN")) {
        const token = Buffer.from(`\0${opts.username}\0${password}`, "utf8").toString("base64");
        await conn.command(`AUTH PLAIN ${token}`, [235], "Sign-in (AUTH PLAIN)");
      } else {
        await conn.command("AUTH LOGIN", [334], "Sign-in (AUTH LOGIN)");
        await conn.command(
          Buffer.from(opts.username).toString("base64"),
          [334],
          "Sign-in (user name)",
        );
        await conn.command(Buffer.from(password).toString("base64"), [235], "Sign-in (password)");
      }
    }
    await conn.command(`MAIL FROM:<${envelope.from}>`, [250], "Sender");
    for (const to of envelope.to) await conn.command(`RCPT TO:<${to}>`, [250, 251], "Recipient");
    await conn.command("DATA", [354], "DATA");
    const accepted = await conn.command(encodeData(message).replace(/\r\n$/, ""), [250], "Message");
    await conn.command("QUIT", [221], "QUIT").catch(() => undefined);
    return `${accepted.code} ${accepted.lines.join(" ")}`.slice(0, 300);
  } finally {
    conn.socket.destroy();
  }
}
