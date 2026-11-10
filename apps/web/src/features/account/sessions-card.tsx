"use client";

import { type SessionSummary, SessionListSchema, RevokedCountSchema } from "@nf/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, KeyRound, LogOut, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, Skeleton } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { describeUserAgent } from "@/lib/user-agent";

const key = ["me", "sessions"] as const;
const errorMessage = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Something went wrong";

function method(s: SessionSummary) {
  if (s.signedInWith === "local")
    return { label: "Password", icon: <KeyRound className="size-3" /> };
  if (s.signedInWith) return { label: "Single sign-on", icon: <Fingerprint className="size-3" /> };
  return null;
}

/** My account → Where you're signed in. */
export function SessionsCard() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: key,
    queryFn: () => api("/api/v1/me/sessions", { schema: SessionListSchema }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/me/sessions/${id}`, { method: "DELETE", schema: RevokedCountSchema }),
    onSuccess: () => {
      toast.success("That session was signed out.");
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const others = useMutation({
    mutationFn: () =>
      api("/api/v1/me/sessions/revoke-others", { method: "POST", schema: RevokedCountSchema }),
    onSuccess: (r) => {
      toast.success(
        r.revoked === 1
          ? "1 other session was signed out."
          : `${r.revoked} other sessions were signed out.`,
      );
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const sessions = list.data?.sessions ?? [];
  const otherCount = sessions.filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader
        title="Where you're signed in"
        description="Browsers and devices with an active session. Don't recognise one? Sign it out, then change your password."
        action={
          otherCount > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              loading={others.isPending}
              onClick={() => others.mutate()}
            >
              <LogOut /> Sign out everywhere else
            </Button>
          ) : null
        }
      />
      <CardBody>
        {list.isPending && <Skeleton className="h-28" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && (
          <ul className="divide-y divide-border">
            {sessions.map((s) => {
              const device = describeUserAgent(s.userAgent);
              const how = method(s);
              return (
                <li key={s.id} className="flex items-center gap-3.5 py-3 first:pt-0 last:pb-0">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-sunken text-muted [&_svg]:size-[18px]">
                    {device.mobile ? <Smartphone /> : <Monitor />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                      {device.label}
                      {s.current && (
                        <Badge tone="success" dot>
                          This browser
                        </Badge>
                      )}
                      {how && (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-normal text-subtle">
                          {how.icon}
                          {how.label}
                        </span>
                      )}
                    </p>
                    <p
                      className="truncate text-[12px] text-subtle"
                      title={s.userAgent ?? undefined}
                    >
                      {s.ipAddress ?? "Unknown address"} · active{" "}
                      {formatRelative(s.lastSeenAt).toLowerCase()} · signed in{" "}
                      {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Sign out ${device.label}`}
                      loading={revoke.isPending && revoke.variables === s.id}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
