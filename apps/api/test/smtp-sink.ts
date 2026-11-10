import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";

/**
 * A minimal SMTP server for tests: EHLO, STARTTLS, implicit TLS, AUTH PLAIN/LOGIN, MAIL, RCPT,
 * DATA, QUIT. Records what it receives. `rejectRcpt` makes RCPT fail with 550.
 */
export interface Received {
  from: string;
  to: string[];
  data: string;
  auth: { user: string; pass: string } | null;
  tls: boolean;
}

export interface Sink {
  port: number;
  messages: Received[];
  close(): Promise<void>;
}

export interface TlsMaterial {
  key: string;
  cert: string;
  certFile: string;
}

/** A throwaway self-signed certificate for localhost, or null when openssl isn't available. */
export function selfSigned(): TlsMaterial | null {
  const dir = mkdtempSync(join(tmpdir(), "nf-smtp-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
  } catch {
    return null;
  }
  return {
    key: readFileSync(join(dir, "key.pem"), "utf8"),
    cert: readFileSync(join(dir, "cert.pem"), "utf8"),
    certFile: join(dir, "cert.pem"),
  };
}

export async function startSink(
  opts: { mode?: "plain" | "starttls" | "tls"; tls?: TlsMaterial; rejectRcpt?: boolean } = {},
): Promise<Sink> {
  const messages: Received[] = [];
  const mode = opts.mode ?? "plain";

  const serve = (raw: Socket) => {
    let socket: Socket = raw;
    let secure = false;
    if (mode === "tls") {
      socket = new TLSSocket(raw, { isServer: true, key: opts.tls!.key, cert: opts.tls!.cert });
      secure = true;
    }
    let buffer = "";
    let inData = false;
    let data: string[] = [];
    let from = "";
    let to: string[] = [];
    let auth: Received["auth"] = null;
    let loginStep: 0 | 1 | 2 = 0;
    let loginUser = "";
    const send = (line: string) => socket.write(`${line}\r\n`);

    const onLine = (line: string) => {
      if (inData) {
        if (line === ".") {
          inData = false;
          messages.push({ from, to, data: data.join("\r\n"), auth, tls: secure });
          data = [];
          to = [];
          return send("250 2.0.0 Ok: queued as TEST");
        }
        data.push(line.startsWith("..") ? line.slice(1) : line);
        return;
      }
      if (loginStep === 1) {
        loginUser = Buffer.from(line, "base64").toString();
        loginStep = 2;
        return send("334 UGFzc3dvcmQ6");
      }
      if (loginStep === 2) {
        auth = { user: loginUser, pass: Buffer.from(line, "base64").toString() };
        loginStep = 0;
        return send("235 2.7.0 Authenticated");
      }
      const [verb = "", ...rest] = line.split(" ");
      switch (verb.toUpperCase()) {
        case "EHLO": {
          const ext = ["250-sink.test", "250-AUTH PLAIN LOGIN", "250-8BITMIME"];
          if (mode === "starttls" && !secure) ext.push("250-STARTTLS");
          ext.push("250 SMTPUTF8");
          return socket.write(`${ext.join("\r\n")}\r\n`);
        }
        case "STARTTLS": {
          send("220 2.0.0 Ready to start TLS");
          socket.removeAllListeners("data");
          const tls = new TLSSocket(socket, {
            isServer: true,
            key: opts.tls!.key,
            cert: opts.tls!.cert,
          });
          socket = tls;
          secure = true;
          buffer = "";
          attach();
          return;
        }
        case "AUTH": {
          if (rest[0] === "PLAIN") {
            const [, user = "", pass = ""] = Buffer.from(rest[1] ?? "", "base64")
              .toString()
              .split("\0");
            auth = { user, pass };
            return send("235 2.7.0 Authenticated");
          }
          loginStep = 1;
          return send("334 VXNlcm5hbWU6");
        }
        case "MAIL":
          from = /<(.*)>/.exec(line)?.[1] ?? "";
          return send("250 2.1.0 Ok");
        case "RCPT":
          if (opts.rejectRcpt) return send("550 5.1.1 No such user");
          to.push(/<(.*)>/.exec(line)?.[1] ?? "");
          return send("250 2.1.5 Ok");
        case "DATA":
          inData = true;
          return send("354 End data with <CR><LF>.<CR><LF>");
        case "QUIT":
          send("221 2.0.0 Bye");
          return socket.end();
        default:
          return send("502 5.5.2 Command not recognised");
      }
    };

    const attach = () => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          onLine(line);
        }
      });
      socket.on("error", () => undefined);
    };
    attach();
    send("220 sink.test ESMTP ready");
  };

  const server: Server = createServer(serve);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    port: address.port,
    messages,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Decodes the text/plain part of a received multipart message. */
export function textPart(data: string): string {
  const m =
    /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(
      data,
    );
  return m ? Buffer.from(m[1]!.replace(/\r\n/g, ""), "base64").toString("utf8") : "";
}
