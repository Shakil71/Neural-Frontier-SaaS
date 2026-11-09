import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Principal } from "../../common/principal.js";
import { CurrentPrincipal } from "../../common/request.js";
import { RequirePermission } from "../authz/decorators.js";
import { DashboardService } from "./dashboard.service.js";

@ApiTags("dashboard")
@Controller("v1/dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("summary")
  @RequirePermission("identities.read")
  summary(@CurrentPrincipal() p: Principal) {
    return this.dashboard.summary(p.tenantId);
  }
}
