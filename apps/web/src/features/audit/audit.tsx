"use client";

import { AUDIT_ACTIONS, AuditEventSchema, type AuditEvent } from "@nf/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useMemo, useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { type CoreFeatures, DataTable } from "@/components/ui/data-table";
import { SheetContent } from "@/components/ui/overlays";
import { Badge, Card, Label, NativeSelect } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { AUDIT_LABELS, auditLabel } from "@/lib/audit-labels";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const PageSchema = z.object({
  items: z.array(AuditEventSchema),
  nextCursor: z.string().nullable(),
});
const col = createColumnHelper<CoreFeatures, AuditEvent>();

const OUTCOME_TONE = { success: "success", failure: "warning", denied: "danger" } as const;
const ICON_TONE = {
  neutral: "bg-surface-sunken text-muted",
  primary: "bg-primary-soft text-primary",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

const columns = [
  col.accessor("action", {
    header: "Event",
    cell: ({ getValue }) => {
      const meta = auditLabel(getValue());
      return (
        <div className="flex min-w-44 items-center gap-2.5">
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg",
              ICON_TONE[meta.tone],
            )}
          >
            <meta.icon className="size-3.5" aria-hidden />
          </span>
          <span className="font-medium">{meta.label}</span>
        </div>
      );
    },
  }),
  col.accessor((e) => e.actor.label, {
    id: "actor",
    header: "Actor",
    cell: ({ getValue }) => <span className="block max-w-56 truncate">{getValue()}</span>,
  }),
  col.accessor((e) => e.target?.label ?? null, {
    id: "target",
    header: "Target",
    cell: ({ getValue }) => (
      <span className="block max-w-56 truncate text-muted">{getValue() ?? "—"}</span>
    ),
  }),
  col.accessor("outcome", {
    header: "Outcome",
    cell: ({ getValue }) => <Badge tone={OUTCOME_TONE[getValue()]}>{getValue()}</Badge>,
  }),
  col.accessor("occurredAt", {
    header: "When",
    cell: ({ getValue }) => (
      <time
        dateTime={getValue()}
        title={formatDateTime(getValue())}
        className="whitespace-nowrap text-muted"
      >
        {formatRelative(getValue())}
      </time>
    ),
  }),
  col.accessor("ipAddress", {
    header: "IP",
    cell: ({ getValue }) => (
      <span className="font-mono text-[12px] text-subtle">{getValue() ?? "—"}</span>
    ),
  }),
];

function EventDetail({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const meta = event ? auditLabel(event.action) : null;
  return (
    <D.Root open={!!event} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={meta?.label ?? "Event"}
        description={event ? formatDateTime(event.occurredAt) : undefined}
      >
        {event && (
          <div className="space-y-6 text-[13px]">
            <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3">
              {[
                [
                  "Action",
                  <code key="a" className="font-mono text-[12px]">
                    {event.action}
                  </code>,
                ],
                [
                  "Outcome",
                  <Badge key="o" tone={OUTCOME_TONE[event.outcome]}>
                    {event.outcome}
                  </Badge>,
                ],
                ["Actor", event.actor.label],
                [
                  "Target",
                  event.target
                    ? `${event.target.label ?? event.target.id} (${event.target.type})`
                    : "—",
                ],
                [
                  "IP address",
                  <span key="ip" className="font-mono text-[12px]">
                    {event.ipAddress ?? "—"}
                  </span>,
                ],
                [
                  "Request ID",
                  <span key="r" className="break-all font-mono text-[12px]">
                    {event.requestId ?? "—"}
                  </span>,
                ],
                [
                  "Event ID",
                  <span key="e" className="break-all font-mono text-[12px]">
                    {event.id}
                  </span>,
                ],
              ].map(([k, v]) => (
                <div key={k as string} className="contents">
                  <dt className="text-subtle">{k}</dt>
                  <dd className="min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h3 className="mb-2 text-[12px] font-medium text-subtle">Details</h3>
              <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-border bg-surface-sunken p-4 font-mono text-[12px] leading-relaxed text-muted">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </SheetContent>
    </D.Root>
  );
}

export function AuditLog() {
  const { can } = usePermissions();
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["audit", { action, outcome }],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (action) params.set("action", action);
      if (outcome) params.set("outcome", outcome);
      if (pageParam) params.set("cursor", pageParam);
      return api(`/api/v1/audit-events?${params}`, { schema: PageSchema, signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: can("audit.read"),
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  if (!can("audit.read")) return <ForbiddenState permission="audit.read" />;

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Audit log"
        description="An append-only record of sign-ins, access decisions and administrative changes. Every change is written in the same transaction as the event that describes it."
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-4 border-b border-border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="f-action" className="text-[12px] text-subtle">
              Event
            </Label>
            <NativeSelect
              id="f-action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-56"
            >
              <option value="">All events</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {AUDIT_LABELS[a].label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-outcome" className="text-[12px] text-subtle">
              Outcome
            </Label>
            <NativeSelect
              id="f-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-40"
            >
              <option value="">Any outcome</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="denied">Denied</option>
            </NativeSelect>
          </div>
          {(action || outcome) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAction("");
                setOutcome("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            loading={query.isPending}
            getRowId={(r) => r.id}
            onRowClick={setSelected}
            rowLabel={(r) => `View ${auditLabel(r.action).label} event`}
            empty={
              <EmptyState icon={ScrollText} title="No events match">
                Try a different filter.
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
              Load older events
            </Button>
          </div>
        )}
      </Card>
      <EventDetail event={selected} onClose={() => setSelected(null)} />
    </>
  );
}
