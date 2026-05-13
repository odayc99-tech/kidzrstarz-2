import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getAllGuestTokens, removeGuestToken } from "@/lib/guestToken";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(meQuery.data)
    );
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  // Auto-claim guest orders when user logs in
  const claimMutation = trpc.orders.claimGuestOrders.useMutation();
  const hasClaimed = useRef(false);

  useEffect(() => {
    if (!state.isAuthenticated || state.loading || hasClaimed.current) return;

    const tokens = getAllGuestTokens();
    if (tokens.length === 0) return;

    hasClaimed.current = true;
    const guestTokens = tokens.map((t) => t.guestToken);

    claimMutation.mutateAsync({ guestTokens }).then((result) => {
      if (result.claimed > 0) {
        // Remove claimed tokens from localStorage
        tokens.forEach((t) => removeGuestToken(t.orderId));
        // Refresh user orders so dashboard picks them up
        utils.orders.getUserOrders.invalidate();
        console.log(`[Auth] Claimed ${result.claimed} guest order(s)`);
      }
    }).catch((err) => {
      console.warn("[Auth] Failed to claim guest orders:", err);
      hasClaimed.current = false; // Allow retry
    });
  }, [state.isAuthenticated, state.loading]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
