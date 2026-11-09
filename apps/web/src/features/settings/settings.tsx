"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Building2, Globe } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, ForbiddenState } from "@/components/states/states";
import { Badge, Card, CardBody, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { usePermissions } from "@/lib/session";
import { IdentityProviderCard } from "./identity-provider-card";
import { ProvisioningCard } from "./provisioning-card";

const TenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["active", "suspended"]),
  createdAt: z.string(),
  domains: z.array(z.object({ domain: z.string(), verified: z.boolean() })),
  sso: z.object({
    protocol: z.string(),
    configured: z.boolean(),
    sharedConfigured: z.boolean().optional(),
  }),
});

export function Settings() {
  const { can } = usePermissions();
  const tenant = useQuery({
    queryKey: ["tenant"],
    queryFn: () => api("/api/v1/tenant", { schema: TenantSchema }),
    enabled: can("tenant.read"),
  });
  if (!can("tenant.read")) return <ForbiddenState permission="tenant.read" />;
  const t = tenant.data;

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Organisation"
        description="Your tenant's identity, verified domains and sign-in configuration."
      />
      {tenant.isError ? (
        <Card>
          <ErrorState error={tenant.error} onRetry={() => void tenant.refetch()} />
        </Card>
      ) : !t ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="lg:row-span-2">
            <CardHeader
              title="Profile"
              action={<Building2 className="size-4 text-subtle" aria-hidden />}
            />
            <CardBody>
              <dl className="divide-y divide-border text-[13.5px]">
                {[
                  [
                    "Name",
                    <span key="n" className="font-medium">
                      {t.name}
                    </span>,
                  ],
                  [
                    "Slug",
                    <code key="s" className="font-mono text-[12.5px]">
                      {t.slug}
                    </code>,
                  ],
                  [
                    "Status",
                    <Badge key="st" tone={t.status === "active" ? "success" : "danger"} dot>
                      {t.status}
                    </Badge>,
                  ],
                  ["Created", formatDateTime(t.createdAt)],
                  [
                    "Tenant ID",
                    <code key="i" className="break-all font-mono text-[12px] text-muted">
                      {t.id}
                    </code>,
                  ],
                ].map(([k, v]) => (
                  <div
                    key={k as string}
                    className="grid grid-cols-[120px_1fr] items-center gap-4 py-3.5 first:pt-0"
                  >
                    <dt className="text-subtle">{k}</dt>
                    <dd className="min-w-0">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Domains"
              description="Verified users from these domains sign in to this organisation."
              action={<Globe className="size-4 text-subtle" aria-hidden />}
            />
            <CardBody>
              <ul className="space-y-2">
                {t.domains.map((d) => (
                  <li
                    key={d.domain}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface-sunken/50 px-3.5 py-2.5"
                  >
                    <span className="font-mono text-[13px]">{d.domain}</span>
                    {d.verified ? (
                      <Badge tone="success">
                        <BadgeCheck className="size-3" aria-hidden /> Verified
                      </Badge>
                    ) : (
                      <Badge tone="warning">Unverified</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <IdentityProviderCard sharedConfigured={t.sso.sharedConfigured ?? t.sso.configured} />
          <ProvisioningCard />
        </div>
      )}
    </>
  );
}
