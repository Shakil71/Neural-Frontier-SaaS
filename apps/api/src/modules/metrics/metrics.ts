import { Controller, Get, Header, Injectable, type NestMiddleware, Req } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { NextFunction, Request, Response } from "express";
import { collectDefaultMetrics, Histogram, Registry } from "prom-client";
import { Errors } from "../../common/errors.js";
import { Public } from "../authz/decorators.js";

export const registry = new Registry();
registry.setDefaultLabels({ service: "neural-frontier-api" });
collectDefaultMetrics({ register: registry, prefix: "nf_" });

const httpDuration = new Histogram({
  name: "nf_http_request_duration_seconds",
  help: "HTTP request duration by route template and status class",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/** Records request latency. Uses the route template (not the raw URL) to bound label cardinality. */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const end = httpDuration.startTimer();
    res.on("finish", () => {
      const route = (req.route?.path as string | undefined) ?? "unmatched";
      end({ method: req.method, route, status: `${Math.floor(res.statusCode / 100)}xx` });
    });
    next();
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Prometheus scrape endpoint. Served only to direct loopback connections: requests that came
 * through Nginx carry X-Forwarded-For and are refused (Nginx also blocks the path).
 */
@ApiExcludeController()
@Controller("metrics")
export class MetricsController {
  @Public()
  @SkipThrottle()
  @Get()
  @Header("Content-Type", registry.contentType)
  async scrape(@Req() req: Request) {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? "") || req.get("x-forwarded-for"))
      throw Errors.notFound("Route");
    return registry.metrics();
  }
}
