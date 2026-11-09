"use client";

import {
  ConnectorSchema,
  type DirectoryGroup,
  DirectoryGroupMemberSchema,
  DirectoryGroupSchema,
  type DirectoryUser,
  DirectoryUserSchema,
} from "@nf/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { BookUser, Boxes, Cable, Lock, Search, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { Dialog as D } from "radix-ui";
import { useDeferredValue, useMemo, useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { type CoreFeatures, DataTable } from "@/components/ui/data-table";
import { SheetContent } from "@/components/ui/overlays";
import { Avatar, Badge, Card, Input, NativeSelect, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatNumber, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
const UsersPage = page(DirectoryUserSchema);
const GroupsPage = page(DirectoryGroupSchema);
const MembersPage = page(DirectoryGroupMemberSchema.extend({ id: z.string() }));

const userCol = createColumnHelper<CoreFeatures, DirectoryUser>();
const groupCol = createColumnHelper<CoreFeatures, DirectoryGroup>();

const userColumns = [
  userCol.accessor("displayName", {
    header: "Person",
    cell: ({ row }) => (
      <div className="flex min-w-56 items-center gap-3">
        <Avatar name={row.original.displayName} seed={row.original.userPrincipalName} size={32} />
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.original.displayName}</p>
          <p className="truncate text-[12px] text-subtle">{row.original.userPrincipalName}</p>
        </div>
      </div>
    ),
  }),
  userCol.accessor("jobTitle", {
    header: "Role",
    cell: ({ row }) => (
      <div className="min-w-40">
        <p className="truncate text-foreground">{row.original.jobTitle ?? "—"}</p>
        <p className="truncate text-[12px] text-subtle">{row.original.department ?? ""}</p>
      </div>
    ),
  }),
  userCol.accessor("accountEnabled", {
    header: "Account",
    cell: ({ getValue }) =>
      getValue() ? (
        <Badge tone="success" dot>
          Enabled
        </Badge>
      ) : (
        <Badge tone="warning" dot>
          Disabled
        </Badge>
      ),
  }),
  userCol.accessor("syncedAt", {
    header: "Synced",
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-muted">{formatRelative(getValue())}</span>
    ),
  }),
];

function groupKind(g: DirectoryGroup) {
  if (g.groupTypes.some((t) => t.toLowerCase() === "unified"))
    return { label: "Microsoft 365", tone: "accent" as const };
  if (g.securityEnabled && g.mailEnabled)
    return { label: "Mail-enabled security", tone: "primary" as const };
  if (g.securityEnabled) return { label: "Security", tone: "primary" as const };
  return { label: "Distribution", tone: "neutral" as const };
}

const groupColumns = [
  groupCol.accessor("displayName", {
    header: "Group",
    cell: ({ row }) => (
      <div className="flex min-w-56 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-muted ring-1 ring-inset ring-border">
          <Boxes className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.original.displayName}</p>
          <p className="truncate text-[12px] text-subtle">
            {row.original.mail ?? row.original.description ?? "—"}
          </p>
        </div>
      </div>
    ),
  }),
  groupCol.display({
    id: "kind",
    header: "Type",
    cell: ({ row }) => {
      const k = groupKind(row.original);
      return <Badge tone={k.tone}>{k.label}</Badge>;
    },
  }),
  groupCol.accessor("memberCount", {
    header: "Members",
    cell: ({ getValue }) => (
      <span data-numeric className="font-medium">
        {formatNumber(getValue())}
      </span>
    ),
  }),
  groupCol.accessor("syncedAt", {
    header: "Synced",
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-muted">{formatRelative(getValue())}</span>
    ),
  }),
];

function MembersSheet({ group, onClose }: { group: DirectoryGroup | null; onClose: () => void }) {
  const members = useInfiniteQuery({
    queryKey: ["directory", "members", group?.id],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (pageParam) params.set("cursor", pageParam);
      return api(`/api/v1/directory/groups/${group!.id}/members?${params}`, {
        schema: MembersPage,
        signal,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!group,
  });
  const items = members.data?.pages.flatMap((p) => p.items) ?? [];
  const k = group ? groupKind(group) : null;

  return (
    <D.Root open={!!group} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={group?.displayName ?? "Group"}
        description={group?.mail ?? group?.description ?? undefined}
      >
        {group && k && (
          <div className="mb-6 flex flex-wrap gap-2">
            <Badge tone={k.tone}>{k.label}</Badge>
            <Badge>
              <UsersRound className="size-3" aria-hidden /> {formatNumber(group.memberCount)}{" "}
              members
            </Badge>
          </div>
        )}
        {members.isPending && <Skeleton className="h-48" />}
        {members.isError && (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        )}
        {members.isSuccess &&
          (items.length === 0 ? (
            <EmptyState icon={UsersRound} title="No members">
              This group has no members in the synced directory.
            </EmptyState>
          ) : (
            <ul className="space-y-1.5 animate-fade-in">
              {items.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5"
                >
                  {m.memberType === "user" && m.displayName ? (
                    <Avatar name={m.displayName} seed={m.detail ?? m.externalId} size={30} />
                  ) : (
                    <span className="grid size-[30px] place-items-center rounded-full bg-surface-sunken text-muted ring-1 ring-inset ring-border">
                      {m.memberType === "group" ? (
                        <Boxes className="size-3.5" />
                      ) : (
                        <UserRound className="size-3.5" />
                      )}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {m.displayName ?? "Not in synced directory"}
                    </p>
                    <p className="truncate font-mono text-[11px] text-subtle">
                      {m.detail ?? m.externalId}
                    </p>
                  </div>
                  {m.memberType !== "user" && (
                    <Badge>{m.memberType === "group" ? "Nested group" : "Other"}</Badge>
                  )}
                </li>
              ))}
            </ul>
          ))}
        {members.hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              loading={members.isFetchingNextPage}
              onClick={() => void members.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </SheetContent>
    </D.Root>
  );
}

type Tab = "users" | "groups";

export function Directory() {
  const { can } = usePermissions();
  const [tab, setTab] = useState<Tab>("users");
  const [search, setSearch] = useState("");
  const [connectorId, setConnectorId] = useState("");
  const [group, setGroup] = useState<DirectoryGroup | null>(null);
  const q = useDeferredValue(search.trim());

  const connectors = useQuery({
    queryKey: ["connectors"],
    queryFn: () => api("/api/v1/connectors", { schema: z.array(ConnectorSchema) }),
    enabled: can("connectors.read"),
  });

  const params = (pageParam: string | null) => {
    const p = new URLSearchParams({ limit: "50" });
    if (q) p.set("search", q);
    if (connectorId) p.set("connectorId", connectorId);
    if (pageParam) p.set("cursor", pageParam);
    return p;
  };
  const users = useInfiniteQuery({
    queryKey: ["directory", "users", { q, connectorId }],
    queryFn: ({ pageParam, signal }) =>
      api(`/api/v1/directory/users?${params(pageParam)}`, { schema: UsersPage, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: can("directory.read") && tab === "users",
  });
  const groups = useInfiniteQuery({
    queryKey: ["directory", "groups", { q, connectorId }],
    queryFn: ({ pageParam, signal }) =>
      api(`/api/v1/directory/groups?${params(pageParam)}`, { schema: GroupsPage, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: can("directory.read") && tab === "groups",
  });
  const userRows = useMemo(() => users.data?.pages.flatMap((p) => p.items) ?? [], [users.data]);
  const groupRows = useMemo(() => groups.data?.pages.flatMap((p) => p.items) ?? [], [groups.data]);
  const list = tab === "users" ? users : groups;

  if (!can("directory.read")) return <ForbiddenState permission="directory.read" />;

  const totals = connectors.data?.reduce(
    (acc, c) => ({ users: acc.users + c.counts.users, groups: acc.groups + c.counts.groups }),
    { users: 0, groups: 0 },
  );
  const noConnectors = connectors.isSuccess && connectors.data.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Directory"
        description="People and groups mirrored from your connected directories. Read-only: changes are made in the source directory and arrive with the next sync."
      />

      {totals && !noConnectors && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {[
            { icon: UsersRound, label: "Synced people", value: formatNumber(totals.users) },
            { icon: Boxes, label: "Synced groups", value: formatNumber(totals.groups) },
            {
              icon: Cable,
              label: "Connected directories",
              value: formatNumber(connectors.data!.length),
            },
          ].map((s, i) => (
            <Card
              key={s.label}
              className="flex items-center gap-4 p-5"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
                <s.icon className="size-[18px]" aria-hidden />
              </span>
              <div>
                <p className="text-[12px] text-subtle">{s.label}</p>
                <p data-numeric className="text-[22px] font-semibold tracking-tight">
                  {s.value}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
          <div
            role="tablist"
            aria-label="Directory objects"
            className="flex rounded-lg border border-border bg-surface-sunken p-0.5"
          >
            {(
              [
                { value: "users", label: "People", icon: UserRound },
                { value: "groups", label: "Groups", icon: Boxes },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                onClick={() => setTab(t.value)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium transition-all [&_svg]:size-3.5",
                  tab === t.value
                    ? "bg-surface-raised text-foreground shadow-card"
                    : "text-muted hover:text-foreground",
                )}
              >
                <t.icon aria-hidden /> {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "users" ? "Search name, email or department" : "Search groups"}
              aria-label="Search the directory"
              className="pl-9"
            />
          </div>
          {connectors.data && connectors.data.length > 1 && (
            <NativeSelect
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              aria-label="Filter by connector"
              className="lg:w-56"
            >
              <option value="">All connectors</option>
              {connectors.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : tab === "users" ? (
          <DataTable
            columns={userColumns}
            data={userRows}
            loading={list.isPending}
            getRowId={(r) => r.id}
            empty={
              <DirectoryEmpty
                searching={!!q}
                noConnectors={noConnectors}
                canConnect={can("connectors.manage")}
              />
            }
          />
        ) : (
          <DataTable
            columns={groupColumns}
            data={groupRows}
            loading={list.isPending}
            getRowId={(r) => r.id}
            onRowClick={(g) => setGroup(g)}
            rowLabel={(g) => `Open ${g.displayName}`}
            empty={
              <DirectoryEmpty
                searching={!!q}
                noConnectors={noConnectors}
                canConnect={can("connectors.manage")}
              />
            }
          />
        )}

        {list.hasNextPage && (
          <div className="flex justify-center border-t border-border p-4">
            <Button
              variant="secondary"
              size="sm"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </Card>

      <p className="mt-4 flex items-center gap-2 text-[12px] text-subtle">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        <span>
          Synced people can&apos;t sign in. Access to Neural Frontier is granted only to{" "}
          <Link href="/identities" className="text-primary hover:underline">
            identities
          </Link>
          .
        </span>
      </p>

      <MembersSheet group={group} onClose={() => setGroup(null)} />
    </>
  );
}

function DirectoryEmpty({
  searching,
  noConnectors,
  canConnect,
}: {
  searching: boolean;
  noConnectors: boolean;
  canConnect: boolean;
}) {
  if (searching)
    return (
      <EmptyState icon={Search} title="No matches">
        Try a different search.
      </EmptyState>
    );
  return (
    <EmptyState
      icon={BookUser}
      title={noConnectors ? "No directory connected yet" : "Nothing synced yet"}
      action={
        canConnect ? (
          <Button asChild variant="secondary" size="sm">
            <Link href="/connectors">
              <Cable /> {noConnectors ? "Connect a directory" : "Open connectors"}
            </Link>
          </Button>
        ) : undefined
      }
    >
      {noConnectors
        ? "Connect Microsoft Entra ID to mirror your organisation's people and groups."
        : "Run a sync from Connectors. Results appear here when it finishes."}
    </EmptyState>
  );
}
