import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Public, RequirePermission } from "../authz/decorators.js";
import { HealthService } from "./health.service.js";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly health: HealthService,
  ) {}

  /** Liveness: the process is up. No dependency checks, no internal detail. */
  @Public()
  @SkipThrottle()
  @Get("health/live")
  live() {
    return { status: "ok", release: this.config.release };
  }

  /** Readiness: 503 unless MySQL is reachable. Detail stays behind authentication. */
  @Public()
  @SkipThrottle()
  @Get("health/ready")
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.report();
    if (report.status === "down") res.status(503);
    return { status: report.status, release: report.release };
  }

  @Get("v1/system/health")
  @RequirePermission("system.health.read")
  detail() {
    return this.health.report();
  }
}
