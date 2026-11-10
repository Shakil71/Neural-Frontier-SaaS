import { Body, Controller, Delete, Get, HttpCode, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UpsertEmailSettingsSchema } from "@nf/contracts";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { RequirePermission } from "../authz/decorators.js";
import { EmailService } from "./email.service.js";

/** Organisation → Email delivery. */
@ApiTags("tenant")
@Controller("v1/tenant/email")
export class EmailController {
  constructor(private readonly email: EmailService) {}

  /** Wrapped in an object: a bare `null` would be sent as an empty body. */
  @Get()
  @RequirePermission("tenant.read")
  async get(@CurrentPrincipal() p: Principal) {
    return { email: await this.email.get(p.tenantId) };
  }

  @Put()
  @RequirePermission("tenant.manage")
  upsert(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.email.upsert(p, parse(UpsertEmailSettingsSchema, body), meta);
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission("tenant.manage")
  async remove(@CurrentPrincipal() p: Principal, @Meta() meta: RequestMeta) {
    await this.email.remove(p, meta);
  }

  /** Sends a test message to the caller's own address, right away. */
  @Post("test")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermission("tenant.manage")
  test(@CurrentPrincipal() p: Principal) {
    return this.email.sendTest(p);
  }

  @Get("deliveries")
  @RequirePermission("tenant.read")
  async deliveries(@CurrentPrincipal() p: Principal) {
    return { deliveries: await this.email.deliveries(p.tenantId) };
  }
}
