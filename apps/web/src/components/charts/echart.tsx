"use client";

import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export type ChartTokens = Record<
  | "foreground"
  | "muted"
  | "subtle"
  | "border"
  | "surface"
  | "chart1"
  | "chart2"
  | "chart3"
  | "chart4"
  | "chart5"
  | "danger",
  string
>;

let probe: CanvasRenderingContext2D | null = null;

/**
 * Converts any CSS colour (including oklch with alpha) to `rgba(r, g, b, a)` by painting one
 * pixel. ECharts' colour maths only understands sRGB notations.
 */
function toRgba(color: string): string {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe || !color) return color;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(((a ?? 255) / 255) * 1000) / 1000})`;
}

/** Same colour with a new alpha. Input must come from ChartTokens (rgba form). */
export function withAlpha(rgba: string, alpha: number): string {
  return rgba.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3, ${alpha})`);
}

/** Resolve design tokens to concrete sRGB colours (canvas can't read CSS variables). */
function readTokens(): ChartTokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => toRgba(s.getPropertyValue(name).trim());
  return {
    foreground: v("--foreground"),
    muted: v("--muted"),
    subtle: v("--subtle"),
    border: v("--border"),
    surface: v("--surface-raised"),
    chart1: v("--chart-1"),
    chart2: v("--chart-2"),
    chart3: v("--chart-3"),
    chart4: v("--chart-4"),
    chart5: v("--chart-5"),
    danger: v("--danger"),
  };
}

/**
 * Thin ECharts wrapper: tree-shaken modules, theme-aware (re-renders on light/dark switch),
 * responsive, and disposed on unmount. `build` receives resolved colour tokens.
 */
export function EChart({
  build,
  height = 260,
  ariaLabel,
}: {
  build: (t: ChartTokens) => echarts.EChartsCoreOption;
  height?: number;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!ref.current) return;
    const instance = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = instance;
    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    // Wait a frame so the new theme's CSS variables are applied before reading them.
    const id = requestAnimationFrame(() => {
      const t = readTokens();
      chart.current?.setOption(
        {
          textStyle: {
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            color: t.muted,
          },
          tooltip: {
            backgroundColor: t.surface,
            borderColor: t.border,
            textStyle: { color: t.foreground, fontSize: 12 },
            extraCssText: "border-radius:10px;box-shadow:0 12px 32px -12px rgba(0,0,0,.45);",
          },
          ...build(t),
        },
        { notMerge: true },
      );
    });
    return () => cancelAnimationFrame(id);
  }, [build, resolvedTheme]);

  return <div ref={ref} role="img" aria-label={ariaLabel} style={{ height }} className="w-full" />;
}
