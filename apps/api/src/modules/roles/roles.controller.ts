import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RoleAssignmentInputSchema } from "@nf/contracts";
import { z } from "zod";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { RequirePermission } from "../authz/decorators.js";
import { RolesService } from "./roles.service.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const RevokeSchema = z.object({ reason: z.string().trim().min(3).max(500) });

@ApiTags("roles")
@Controller("v1")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get("roles")
  @RequirePermission("roles.read")
  list(@CurrentPrincipal() p: Principal) {
    return this.roles.list(p.tenantId);
  }

  @Get("identities/:id/role-assignments")
  @RequirePermission("roles.read")
  assignments(@CurrentPrincipal() p: Principal, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.roles.assignmentsFor(p.tenantId, id);
  }

  @Post("role-assignments")
  @RequirePermission("roles.assign")
  assign(
    @CurrentPrincipal() p: Principal,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
      throw Errors.badRequest("Idempotency-Key must be 8–128 characters of [A-Za-z0-9_-]");
    }
    return this.roles.assign(p, parse(RoleAssignmentInputSchema, body), meta, key ?? null);
  }

  /** DELETE with a body: the reason is mandatory for the audit trail. */
  @Delete("role-assignments/:id")
  @HttpCode(204)
  @RequirePermission("roles.assign")
  async revoke(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    await this.roles.revoke(p, id, parse(RevokeSchema, body).reason, meta);
  }
}
