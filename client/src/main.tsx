import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async fetch(input, init) {
        const response = await globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
        // Detect non-JSON responses (e.g., HTML error pages from proxy/deployment)
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json") && !response.ok) {
          throw new Error(
            "Server temporarily unavailable. Please refresh the page and try again."
          );
        }
        return response;
      },
    }),
  ],
});

// Add retry logic for transient failures
queryClient.setDefaultOptions({
  queries: {
    retry: (failureCount, error) => {
      // Retry up to 3 times for transient errors (non-JSON responses, network errors)
      if (failureCount >= 3) return false;
      if (error instanceof TRPCClientError) {
        // Don't retry auth errors or validation errors
        if (error.message === UNAUTHED_ERR_MSG) return false;
        if (error.data?.code === "BAD_REQUEST") return false;
        if (error.data?.code === "NOT_FOUND") return false;
        if (error.data?.code === "FORBIDDEN") return false;
      }
      return true;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  },
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
