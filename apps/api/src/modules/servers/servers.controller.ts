import { createReadStream } from "node:fs";
import {
  Body,
  type CanActivate,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  AgentEnrollRequestSchema,
  AgentInventorySchema,
  CreateEnrollmentKeySchema,
} from "@nf/contracts";
import type { Request, Response } from "express";
import { z } from "zod";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta, requestMeta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { MachineAccess, Public, RequirePermission } from "../authz/decorators.js";
import {
  AGENT_ARCHES,
  type AgentArch,
  AgentAuthError,
  type AgentCaller,
  ServersService,
} from "./servers.service.js";

const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

declare module "express-serve-static-core" {
  interface Request {
    agent?: AgentCaller;
  }
}

@ApiTags("servers")
@Controller("v1")
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get("servers")
  @MachineAccess()
  @RequirePermission("servers.read")
  list(@CurrentPrincipal() p: Principal) {
    return this.servers.list(p.tenantId);
  }

  @Get("servers/:id")
  @MachineAccess()
  @RequirePermission("servers.read")
  get(@CurrentPrincipal() p: Principal, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.servers.get(p.tenantId, id);
  }

  @Delete("servers/:id")
  @HttpCode(204)
  @RequirePermission("servers.manage")
  async retire(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    await this.servers.retire(p, id, parse(ReasonSchema, body).reason, meta);
  }

  @Get("agent-enrollment-keys")
  @RequirePermission("servers.read")
  async keys(@CurrentPrincipal() p: Principal) {
    return {
      keys: await this.servers.listKeys(p.tenantId),
      agentAvailable: AGENT_ARCHES.some((a) => this.servers.binaryPath(a) !== null),
      certificatePin: this.servers.certificatePin(),
    };
  }

  /** Returns the key once, with a ready-to-paste install command. */
  @Post("agent-enrollment-keys")
  @RequirePermission("servers.manage")
  createKey(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.servers.createKey(p, parse(CreateEnrollmentKeySchema, body ?? {}), meta);
  }

  @Delete("agent-enrollment-keys/:id")
  @HttpCode(200)
  @RequirePermission("servers.manage")
  revokeKey(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.servers.revokeKey(p, id, meta);
  }
}

/** Authenticates agent reports with the per-server bearer token. */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(private readonly servers: ServersService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    try {
      req.agent = await this.servers.authenticateAgent(req.get("authorization"));
      return true;
    } catch (err) {
      if (err instanceof AgentAuthError) throw Errors.unauthenticated(err.message);
      throw err;
    }
  }
}

/**
 * Endpoints the agent and the installer talk to (/api/agent/v1). They are @Public to the
 * session guard: enrolment authenticates with an enrollment key, reports with the agent token.
 */
@ApiExcludeController()
@Public()
@Controller("agent/v1")
export class AgentController {
  constructor(private readonly servers: ServersService) {}

  @Post("enroll")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  enroll(@Req() req: Request, @Body() body: unknown) {
    return this.servers.enroll(parse(AgentEnrollRequestSchema, body), requestMeta(req));
  }

  @Post("inventory")
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(AgentGuard)
  async inventory(@Req() req: Request, @Body() body: unknown) {
    if (!req.agent) throw Errors.unauthenticated();
    await this.servers.ingest(req.agent, parse(AgentInventorySchema, body));
  }

  @Get("install.sh")
  install(@Res({ passthrough: true }) res: Response) {
    res.type("text/x-shellscript").setHeader("Cache-Control", "no-store");
    return this.servers.installScript();
  }

  @Get("download/:arch")
  download(@Param("arch") arch: string, @Res({ passthrough: true }) res: Response) {
    if (!(AGENT_ARCHES as readonly string[]).includes(arch)) throw Errors.notFound("Agent build");
    const path = this.servers.binaryPath(arch as AgentArch);
    if (!path) throw Errors.notFound("Agent build");
    res.setHeader("Content-Disposition", `attachment; filename="nf-agent-linux-${arch}"`);
    res.setHeader("Cache-Control", "no-store");
    return new StreamableFile(createReadStream(path), { type: "application/octet-stream" });
  }
}
