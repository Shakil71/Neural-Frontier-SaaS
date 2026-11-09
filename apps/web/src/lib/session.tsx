"use client";

import { type Permission, SessionSchema, type Session } from "@nf/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, setCsrfToken } from "./api";

export const sessionKey = ["session"] as const;

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      const session = await api("/api/v1/auth/session", { schema: SessionSchema });
      setCsrfToken(session.csrfToken);
      return session;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** UI-side permission check for showing or hiding controls. The API enforces every rule. */
export function usePermissions() {
  const { data } = useSession();
  const can = useCallback((p: Permission) => data?.permissions.includes(p) ?? false, [data]);
  return { can, session: data as Session | undefined };
}

export function useSignOut() {
  const client = useQueryClient();
  return async () => {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    setCsrfToken(null);
    client.clear();
    // Full reload on purpose: drops every piece of in-memory state from the old session.
    window.location.replace(new URL("/sign-in?signedOut=1", window.location.origin).href);
  };
}
