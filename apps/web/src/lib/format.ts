const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat("en");

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "Never";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

export function formatNumber(n: number): string {
  return number.format(n);
}

export function initials(name: string): string {
  const parts = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Stable hue per identity so avatars are recognisable without photos. */
export function avatarHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
