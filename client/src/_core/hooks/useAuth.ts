import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAllGuestTokens, removeGuestToken } from "@/lib/guestToken";
import { useClerk, useUser } from "@clerk/clerk-react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false } = options ?? {};
  const utils = trpc.useUtils();
  const { signOut, openSignIn } = useClerk();
  const { user: clerkUser, isLoaded: clerkLoaded, isSignedIn } = useUser();

  // Track whether we've already exchanged the Clerk token for our session cookie
  const [sessionExchanged, setSessionExchanged] = useState(false);
  const exchanging = useRef(false);

  // Exchange Clerk session token → our JWT session cookie
  useEffect(() => {
    if (!clerkLoaded || !isSignedIn || sessionExchanged || exchanging.current) return;
    exchanging.current = true;

    (async () => {
      try {
        // Get a fresh short-lived Clerk session token
        const token = await window.Clerk?.session?.getToken();
        if (!token) return;

        const res = await fetch("/api/auth/clerk-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });

        if (res.ok) {
          setSessionExchanged(true);
          // Refresh tRPC auth.me so the rest of the app sees the logged-in user
          await utils.auth.me.invalidate();
        }
      } catch (err) {
        console.warn("[Auth] Clerk session exchange failed", err);
      } finally {
        exchanging.current = false;
      }
    })();
  }, [clerkLoaded, isSignedIn, sessionExchanged]);

  // Reset exchanged flag when user signs out of Clerk
  useEffect(() => {
    if (clerkLoaded && !isSignedIn) {
      setSessionExchanged(false);
    }
  }, [clerkLoaded, isSignedIn]);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    // Only query once Clerk has loaded and we've exchanged the token (or user is not signed in)
    enabled: clerkLoaded && (!isSignedIn || sessionExchanged),
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
        // Already logged out on server side, continue
      } else {
        console.warn("[Auth] Server logout error", error);
      }
    } finally {
      utils.auth.me.setData(undefined, null);
      setSessionExchanged(false);
      await signOut();
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils, signOut]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: !clerkLoaded || meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    clerkLoaded,
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  // Redirect unauthenticated users to sign-in modal
  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (!clerkLoaded || meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    openSignIn();
  }, [
    redirectOnUnauthenticated,
    clerkLoaded,
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
        tokens.forEach((t) => removeGuestToken(t.orderId));
        utils.orders.getUserOrders.invalidate();
        console.log(`[Auth] Claimed ${result.claimed} guest order(s)`);
      }
    }).catch((err) => {
      console.warn("[Auth] Failed to claim guest orders:", err);
      hasClaimed.current = false;
    });
  }, [state.isAuthenticated, state.loading]);

  return {
    ...state,
    openSignIn,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
