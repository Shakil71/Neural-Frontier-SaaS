import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  CreateConnectorSchema,
  DeleteConnectorSchema,
  IdSchema,
  UpdateConnectorSchema,
} from "@nf/contracts";
import { z } from "zod";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { MachineAccess, RequirePermission } from "../authz/decorators.js";
import { ConnectorsService } from "./connectors.service.js";

const RunsQuerySchema = z.object({
  cursor: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

@ApiTags("connectors")
@Controller("v1/connectors")
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  @MachineAccess()
  @RequirePermission("connectors.read")
  list(@CurrentPrincipal() p: Principal) {
    return this.connectors.list(p.tenantId);
  }

  @Get(":id")
  @MachineAccess()
  @RequirePermission("connectors.read")
  get(@CurrentPrincipal() p: Principal, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.connectors.get(p.tenantId, id);
  }

  /** The client secret is encrypted at rest and never returned. */
  @Post()
  @RequirePermission("connectors.manage")
  create(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.connectors.create(p, parse(CreateConnectorSchema, body), meta);
  }

  @Patch(":id")
  @RequirePermission("connectors.manage")
  update(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.connectors.update(p, id, parse(UpdateConnectorSchema, body), meta);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("connectors.manage")
  async remove(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    await this.connectors.remove(p, id, parse(DeleteConnectorSchema, body).reason, meta);
  }

  /** Verifies the credential against the directory. Reads only; throttled. */
  @Post(":id/test")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission("connectors.manage")
  test(@CurrentPrincipal() p: Principal, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.connectors.test(p.tenantId, id);
  }

  @Post(":id/sync")
  @HttpCode(202)
  @MachineAccess()
  @RequirePermission("connectors.sync")
  sync(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.connectors.requestSync(
      p.tenantId,
      id,
      "manual",
      { id: p.identityId, label: p.email },
      meta,
    );
  }

  @Get(":id/runs")
  @MachineAccess()
  @RequirePermission("connectors.read")
  runs(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    const q = parse(RunsQuerySchema, query);
    return this.connectors.runs(p.tenantId, id, q.cursor, q.limit);
  }
}
