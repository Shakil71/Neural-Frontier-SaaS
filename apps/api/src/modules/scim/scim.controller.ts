import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AppError } from "../../common/errors.js";
import { Meta } from "../../common/request.js";
import type { RequestMeta } from "../../common/principal.js";
import { Public } from "../authz/decorators.js";
import { ScimAuthGuard, type ScimCaller } from "./scim-tokens.js";
import { SCIM_LIST, SCIM_USER, ScimError, ScimUsersService } from "./scim-users.service.js";

const SCIM_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";

/** Every SCIM response, including errors, uses RFC 7644 shapes and application/scim+json. */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("Scim");

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let detail = "Internal error";
    let scimType: string | undefined;
    if (err instanceof ScimError) {
      status = err.status;
      detail = err.message;
      scimType = err.scimType;
    } else if (err instanceof AppError) {
      status = err.status;
      detail = err.message;
    } else if (err instanceof ThrottlerException) {
      status = 429;
      detail = "Too many requests";
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      detail = err.message;
    } else if (err instanceof SyntaxError) {
      status = 400;
      detail = "Malformed JSON";
      scimType = "invalidSyntax";
    } else {
      this.logger.error({ err }, "SCIM request failed");
    }
    res
      .status(status)
      .type("application/scim+json")
      .json({
        schemas: [SCIM_ERROR],
        status: String(status),
        detail,
        ...(scimType ? { scimType } : {}),
      });
  }
}

function caller(req: Request): ScimCaller {
  if (!req.scim) throw new ScimError(401, "Unauthenticated");
  return req.scim;
}

function intParam(value: unknown, def: number, min: number, max: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/**
 * SCIM 2.0 service provider for Users (`/api/scim/v2`). Authenticated with a tenant SCIM token,
 * not a session, so it is @Public to the session guard and uses ScimAuthGuard instead.
 * Groups are not supported yet (ServiceProviderConfig says so; configure the client for users).
 */
@ApiExcludeController()
@Public()
@UseGuards(ScimAuthGuard)
@UseFilters(ScimExceptionFilter)
@Controller("scim/v2")
export class ScimController {
  constructor(private readonly users: ScimUsersService) {}

  @Get("ServiceProviderConfig")
  config() {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri:
        "https://github.com/Shakil71/Neural-Frontier-SaaS/blob/main/docs/operations/deployment.md",
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer token",
          description: "A SCIM token created in the Admin Center (Organisation → Provisioning).",
          primary: true,
        },
      ],
    };
  }

  @Get("ResourceTypes")
  resourceTypes() {
    return {
      schemas: [SCIM_LIST],
      totalResults: 1,
      Resources: [
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
          id: "User",
          name: "User",
          endpoint: "/Users",
          schema: SCIM_USER,
        },
      ],
    };
  }

  @Get("Users")
  list(
    @Req() req: Request,
    @Query("filter") filter?: string,
    @Query("startIndex") startIndex?: string,
    @Query("count") count?: string,
  ) {
    return this.users.list(
      caller(req),
      filter,
      intParam(startIndex, 1, 1, 1_000_000),
      intParam(count, 100, 0, 100),
    );
  }

  @Get("Users/:id")
  get(@Req() req: Request, @Param("id") id: string) {
    return this.users.get(caller(req), id);
  }

  @Post("Users")
  @HttpCode(201)
  create(@Req() req: Request, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.users.create(caller(req), (body ?? {}) as Record<string, unknown>, meta);
  }

  @Put("Users/:id")
  replace(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.users.replace(caller(req), id, (body ?? {}) as Record<string, unknown>, meta);
  }

  @Patch("Users/:id")
  patch(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.users.patch(caller(req), id, body, meta);
  }

  @Delete("Users/:id")
  @HttpCode(204)
  async remove(@Req() req: Request, @Param("id") id: string, @Meta() meta: RequestMeta) {
    await this.users.remove(caller(req), id, meta);
  }

  @Get("Groups")
  groups() {
    throw new ScimError(501, "Groups are not supported yet; provision users only");
  }
}
