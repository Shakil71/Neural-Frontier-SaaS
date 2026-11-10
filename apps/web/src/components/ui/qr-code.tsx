"use client";

import { useMemo } from "react";
import { encodeQr } from "@/lib/qr";
import { cn } from "@/lib/cn";

/**
 * Crisp SVG QR code (one path, so it scales and prints cleanly). Always dark-on-white with the
 * standard four-module quiet zone, whatever the theme: phone cameras need the contrast.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { size, path } = useMemo(() => {
    const qr = encodeQr(value);
    let d = "";
    qr.modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }),
    );
    return { size: qr.size + 8, path: d };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("rounded-lg bg-white", className)}
    >
      <path d={path} fill="#0b0d12" />
    </svg>
  );
}
