/** "Chrome on Windows", from a User-Agent string. Good enough to recognise your own devices. */
export interface DeviceDescription {
  browser: string;
  os: string;
  mobile: boolean;
  label: string;
}

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/CriOS\/|Chrome\/|Chromium\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
  [/curl\//, "curl"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows NT/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function describeUserAgent(ua: string | null | undefined): DeviceDescription {
  if (!ua)
    return {
      browser: "Unknown browser",
      os: "unknown device",
      mobile: false,
      label: "Unknown device",
    };
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? "Browser";
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? "unknown system";
  const mobile = /Mobile|iPhone|Android/.test(ua);
  return { browser, os, mobile, label: `${browser} on ${os}` };
}
