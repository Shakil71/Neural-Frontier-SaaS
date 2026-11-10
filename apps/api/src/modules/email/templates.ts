/**
 * Email templates: a plain-text and an HTML version of each message. The HTML uses tables
 * and inline styles only, which is what mail clients render reliably.
 */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function layout(opts: {
  tenantName: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footnote: string;
}): string {
  const p = opts.paragraphs
    .map(
      (t) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#2b3141">${escapeHtml(t)}</p>`,
    )
    .join("");
  const button = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:#4f46e5">
<a href="${escapeHtml(opts.button.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(opts.button.label)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:12.5px;line-height:1.6;color:#6b7280">If the button doesn't work, copy this address into your browser:<br><span style="word-break:break-all;color:#4f46e5">${escapeHtml(opts.button.url)}</span></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef0f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f6;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td style="background:linear-gradient(120deg,#151a3a,#1f2a6b 55%,#0e5560);padding:22px 32px">
<span style="font-size:16px;font-weight:700;letter-spacing:-0.01em;color:#ffffff">Neural Frontier</span>
<span style="font-size:12px;color:#9fb3ff;padding-left:8px">${escapeHtml(opts.tenantName)}</span>
</td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#111827">${escapeHtml(opts.heading)}</h1>
${p}${button}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#6b7280">${escapeHtml(opts.footnote)}</p>
</td></tr></table>
</td></tr></table></body></html>`;
}

function text(lines: (string | null)[]): string {
  return `${lines.filter((l) => l !== null).join("\n\n")}\n`;
}

export function passwordResetEmail(o: {
  tenantName: string;
  displayName: string;
  url: string;
  expires: string;
  purpose: "setup" | "reset";
}): RenderedEmail {
  const reset = o.purpose === "reset";
  const subject = reset
    ? "Reset your Neural Frontier password"
    : "Set your Neural Frontier password";
  const intro = reset
    ? "Someone, hopefully you, asked to reset the password for your account."
    : "Someone, hopefully you, asked to set a password for your account.";
  const paragraphs = [
    `Hi ${o.displayName},`,
    intro,
    `The link works once and expires ${o.expires}.`,
  ];
  const footnote =
    "Didn't ask for this? Ignore this email: your password stays the same. If it keeps happening, tell your administrator.";
  return {
    subject,
    text: text([...paragraphs, o.url, footnote]),
    html: layout({
      tenantName: o.tenantName,
      heading: reset ? "Reset your password" : "Set your password",
      paragraphs,
      button: { label: reset ? "Choose a new password" : "Set your password", url: o.url },
      footnote,
    }),
  };
}

export function signInLinkEmail(o: {
  tenantName: string;
  displayName: string;
  url: string;
  expires: string;
  purpose: "setup" | "reset";
  issuedBy: string;
}): RenderedEmail {
  const reset = o.purpose === "reset";
  const paragraphs = [
    `Hi ${o.displayName},`,
    reset
      ? `${o.issuedBy} sent you a link to choose a new password for ${o.tenantName} on Neural Frontier. Your current sessions will be signed out.`
      : `${o.issuedBy} invited you to sign in to ${o.tenantName} on Neural Frontier. Choose a password to get started.`,
    `The link works once and expires ${o.expires}.`,
  ];
  const footnote = "Not expecting this? You can ignore it, or tell your administrator.";
  return {
    subject: reset
      ? `Choose a new password for ${o.tenantName}`
      : `You're invited to ${o.tenantName} on Neural Frontier`,
    text: text([...paragraphs, o.url, footnote]),
    html: layout({
      tenantName: o.tenantName,
      heading: reset ? "Choose a new password" : "Welcome to Neural Frontier",
      paragraphs,
      button: { label: reset ? "Choose a new password" : "Set your password", url: o.url },
      footnote,
    }),
  };
}

export function testEmail(o: { tenantName: string; requestedBy: string }): RenderedEmail {
  const paragraphs = [
    `${o.requestedBy} sent this test from the Admin Center to check the email settings.`,
    "If you can read this, Neural Frontier can deliver password resets and sign-in links for your organisation.",
  ];
  const footnote = "This is an automated message. There's nothing you need to do.";
  return {
    subject: "Neural Frontier: email delivery works",
    text: text([...paragraphs, footnote]),
    html: layout({
      tenantName: o.tenantName,
      heading: "Email delivery works",
      paragraphs,
      footnote,
    }),
  };
}
