import { randomBytes, randomUUID } from "node:crypto";

/**
 * Builds a multipart/alternative message (RFC 5322 + MIME): a plain-text part and an HTML
 * part, both UTF-8 and base64-encoded, so any content survives any mail server.
 */
export interface MailContent {
  from: { address: string; name: string };
  to: string;
  subject: string;
  text: string;
  html: string;
}

const NEEDS_ENCODING = /[^\x20-\x7e]/;

/** RFC 2047 encoded-word for non-ASCII header text. */
export function encodeHeader(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Header values cannot contain line breaks");
  if (!NEEDS_ENCODING.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function displayName(name: string): string {
  if (NEEDS_ENCODING.test(name)) return encodeHeader(name);
  return `"${name.replace(/["\\]/g, "\\$&")}"`;
}

function base64Lines(text: string): string {
  return (
    Buffer.from(text, "utf8")
      .toString("base64")
      .match(/.{1,76}/g) ?? []
  ).join("\r\n");
}

export function buildMessage(c: MailContent, now = new Date()): string {
  for (const addr of [c.from.address, c.to]) {
    if (/[\r\n<>"]/.test(addr) || !addr.includes("@")) throw new Error("Invalid address");
  }
  const boundary = `nf-${randomBytes(12).toString("hex")}`;
  const domain = c.from.address.split("@")[1];
  const headers = [
    `From: ${displayName(c.from.name)} <${c.from.address}>`,
    `To: <${c.to}>`,
    `Subject: ${encodeHeader(c.subject)}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    // Automated mail: no vacation auto-replies (RFC 3834).
    "Auto-Submitted: auto-generated",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(body),
    ].join("\r\n");
  return [
    ...headers,
    "",
    part("text/plain", c.text),
    part("text/html", c.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
