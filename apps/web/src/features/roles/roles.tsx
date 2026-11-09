"use client";

import { PERMISSIONS, type Permission, RoleSchema } from "@nf/contracts";
import { useQuery } from "@tanstack/react-query";
import { Check, Crown, Eye, Minus, ShieldCheck, UserRound } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, ForbiddenState } from "@/components/states/states";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePermissions } from "@/lib/session";

const ROLE_ICON: Record<string, typeof Crown> = {
  owner: Crown,
  administrator: ShieldCheck,
  security_auditor: Eye,
  member: UserRound,
};

const PERMISSION_GROUPS: { label: string; prefix: string }[] = [
  { label: "Organisation", prefix: "tenant." },
  { label: "Identities", prefix: "identities." },
  { label: "Roles", prefix: "roles." },
  { label: "Audit", prefix: "audit." },
  { label: "Platform", prefix: "system." },
  { label: "Directory", prefix: "directory." },
  { label: "Connectors", prefix: "connectors." },
  { label: "Machine identity", prefix: "service_principals." },
];

export function Roles() {
  const { can } = usePermissions();
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api("/api/v1/roles", { schema: z.array(RoleSchema) }),
    enabled: can("roles.read"),
  });
  if (!can("roles.read")) return <ForbiddenState permission="roles.read" />;

  return (
    <>
      <PageHeader
        eyebrow="Identity"
        title="Roles & access"
        description="Built-in roles bundle permissions into least-privilege sets. Only Tenant Owners can grant roles, keeping administration separate from approval."
      />
      {roles.isError ? (
        <Card>
          <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
        </Card>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {roles.isPending
              ? Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-48 rounded-xl" />
                ))
              : roles.data.map((r, i) => {
                  const Icon = ROLE_ICON[r.key] ?? ShieldCheck;
                  return (
                    <Card
                      key={r.id}
                      className="relative flex flex-col overflow-hidden p-5"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <div
                        aria-hidden
                        className={cn(
                          "absolute inset-x-0 top-0 h-px",
                          r.key === "owner"
                            ? "bg-gradient-to-r from-transparent via-primary to-transparent"
                            : "bg-gradient-to-r from-transparent via-border-strong to-transparent",
                        )}
                      />
                      <div className="flex items-start justify-between">
                        <span
                          className={cn(
                            "grid size-10 place-items-center rounded-xl",
                            r.key === "owner"
                              ? "bg-primary-soft text-primary"
                              : "bg-surface-sunken text-muted ring-1 ring-inset ring-border",
                          )}
                        >
                          <Icon className="size-[18px]" aria-hidden />
                        </span>
                        {r.builtIn && <Badge>Built-in</Badge>}
                      </div>
                      <h2 className="mt-4 text-[15px] font-semibold tracking-tight">{r.name}</h2>
                      <p className="mt-1 flex-1 text-[13px] leading-relaxed text-muted">
                        {r.description}
                      </p>
                      <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-[12.5px]">
                        <span className="text-subtle">
                          <span data-numeric className="font-semibold text-foreground">
                            {r.memberCount}
                          </span>{" "}
                          {r.memberCount === 1 ? "member" : "members"}
                        </span>
                        <span className="text-subtle">
                          <span data-numeric className="font-semibold text-foreground">
                            {r.permissions.length}
                          </span>{" "}
                          permissions
                        </span>
                      </div>
                    </Card>
                  );
                })}
          </div>

          <Card className="overflow-hidden">
            <CardHeader
              title="Permission matrix"
              description="Exactly what each role can do. Enforced by the API on every request."
            />
            <div className="scrollbar-thin mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="border-b border-border px-5 py-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-subtle"
                    >
                      Permission
                    </th>
                    {roles.data?.map((r) => (
                      <th
                        key={r.id}
                        scope="col"
                        className="border-b border-border px-4 py-3 text-center text-[12px] font-semibold"
                      >
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_GROUPS.map((g) => {
                    const perms = (Object.keys(PERMISSIONS) as Permission[]).filter((p) =>
                      p.startsWith(g.prefix),
                    );
                    return [
                      <tr key={g.label}>
                        <th
                          colSpan={(roles.data?.length ?? 0) + 1}
                          scope="colgroup"
                          className="bg-surface-sunken/60 px-5 py-2 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-subtle"
                        >
                          {g.label}
                        </th>
                      </tr>,
                      ...perms.map((p) => (
                        <tr key={p} className="hover:bg-surface-sunken/40">
                          <th
                            scope="row"
                            className="border-b border-border px-5 py-3 text-left font-normal"
                          >
                            <span className="block font-medium text-foreground">
                              {PERMISSIONS[p]}
                            </span>
                            <code className="font-mono text-[11px] text-subtle">{p}</code>
                          </th>
                          {roles.data?.map((r) => {
                            const has = r.permissions.includes(p);
                            return (
                              <td
                                key={r.id}
                                className="border-b border-border px-4 py-3 text-center"
                              >
                                {has ? (
                                  <span className="inline-grid size-6 place-items-center rounded-full bg-success-soft text-success">
                                    <Check className="size-3.5" aria-label="Granted" />
                                  </span>
                                ) : (
                                  <Minus
                                    className="mx-auto size-3.5 text-border-strong"
                                    aria-label="Not granted"
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
