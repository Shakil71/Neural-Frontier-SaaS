"use client";

import { IdentitySchema, type Identity, type IdentityStatus } from "@nf/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { Search, Users } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { type CoreFeatures, DataTable } from "@/components/ui/data-table";
import { Avatar, Badge, Card, Input } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";
import { IdentitySheet } from "./identity-sheet";

const PageSchema = z.object({ items: z.array(IdentitySchema), nextCursor: z.string().nullable() });
const col = createColumnHelper<CoreFeatures, Identity>();

export const identityKeys = { all: ["identities"] as const };

const PRIVILEGED = new Set(["owner", "administrator"]);

const columns = [
  col.accessor("displayName", {
    header: "Identity",
    cell: ({ row }) => (
      <div className="flex min-w-56 items-center gap-3">
        <Avatar name={row.original.displayName} seed={row.original.email} size={32} />
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.original.displayName}</p>
          <p className="truncate text-[12px] text-subtle">{row.original.email}</p>
        </div>
      </div>
    ),
  }),
  col.accessor("status", {
    header: "Status",
    cell: ({ getValue }) =>
      getValue() === "active" ? (
        <Badge tone="success" dot>
          Active
        </Badge>
      ) : (
        <Badge tone="danger" dot>
          Suspended
        </Badge>
      ),
  }),
  col.accessor("roles", {
    header: "Roles",
    cell: ({ getValue }) => {
      const roles = getValue();
      if (roles.length === 0) return <span className="text-subtle">—</span>;
      return (
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <Badge key={r.id} tone={PRIVILEGED.has(r.key) ? "primary" : "neutral"}>
              {r.name}
            </Badge>
          ))}
        </div>
      );
    },
  }),
  col.accessor("lastSignInAt", {
    header: "Last sign-in",
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-muted" title={formatDateTime(getValue())}>
        {formatRelative(getValue())}
      </span>
    ),
  }),
  col.accessor("createdAt", {
    header: "Added",
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-muted">{formatDateTime(getValue())}</span>
    ),
  }),
];

const STATUS_FILTERS: { value: IdentityStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

export function Identities() {
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<IdentityStatus | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const query = useInfiniteQuery({
    queryKey: [...identityKeys.all, "list", { search: deferredSearch, status }],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (deferredSearch) params.set("search", deferredSearch);
      if (status !== "all") params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      return api(`/api/v1/identities?${params}`, { schema: PageSchema, signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: can("identities.read"),
  });

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  if (!can("identities.read")) return <ForbiddenState permission="identities.read" />;

  return (
    <>
      <PageHeader
        eyebrow="Identity"
        title="Identities"
        description="Everyone who can sign in to your organisation through single sign-on. Select a person to manage their roles and access."
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search identities"
              className="pl-9"
            />
          </div>
          <div
            role="radiogroup"
            aria-label="Filter by status"
            className="flex rounded-lg border border-border bg-surface-sunken p-0.5"
          >
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={status === f.value}
                onClick={() => setStatus(f.value)}
                className={cn(
                  "h-8 rounded-md px-3.5 text-[13px] font-medium transition-all",
                  status === f.value
                    ? "bg-surface-raised text-foreground shadow-card"
                    : "text-muted hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            loading={query.isPending}
            getRowId={(r) => r.id}
            onRowClick={(r) => setSelected(r.id)}
            rowLabel={(r) => `Open ${r.displayName}`}
            empty={
              <EmptyState
                icon={Users}
                title={
                  deferredSearch || status !== "all"
                    ? "No matching identities"
                    : "No identities yet"
                }
              >
                {deferredSearch || status !== "all"
                  ? "Try a different search or filter."
                  : "People appear here the first time they sign in with single sign-on."}
              </EmptyState>
            }
          />
        )}

        {query.hasNextPage && (
          <div className="flex justify-center border-t border-border p-4">
            <Button
              variant="secondary"
              size="sm"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </Card>

      <IdentitySheet identityId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
