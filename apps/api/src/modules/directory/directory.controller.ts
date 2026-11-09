import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DirectoryQuerySchema, IdSchema } from "@nf/contracts";
import { z } from "zod";
import type { Principal } from "../../common/principal.js";
import { CurrentPrincipal } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { MachineAccess, RequirePermission } from "../authz/decorators.js";
import { DirectoryService } from "./directory.service.js";

const MembersQuerySchema = z.object({
  cursor: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

@ApiTags("directory")
@Controller("v1/directory")
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get("users")
  @MachineAccess()
  @RequirePermission("directory.read")
  users(@CurrentPrincipal() p: Principal, @Query() query: unknown) {
    return this.directory.users(p.tenantId, parse(DirectoryQuerySchema, query));
  }

  @Get("groups")
  @MachineAccess()
  @RequirePermission("directory.read")
  groups(@CurrentPrincipal() p: Principal, @Query() query: unknown) {
    return this.directory.groups(p.tenantId, parse(DirectoryQuerySchema, query));
  }

  @Get("groups/:id/members")
  @MachineAccess()
  @RequirePermission("directory.read")
  members(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    const q = parse(MembersQuerySchema, query);
    return this.directory.members(p.tenantId, id, q.cursor, q.limit);
  }
}
