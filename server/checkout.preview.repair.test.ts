import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ order: {} as any, refetch: vi.fn(), mutate: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7 }, isAuthenticated: true, loading: false, openSignIn: vi.fn() }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { orders: new Proxy({}, { get: (_target, prop) => ({
  useQuery: () => ({ data: mocks.order, isLoading: false, error: null, refetch: mocks.refetch }),
  useMutation: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutate, isPending: false }),
}) }) } }));
vi.mock("wouter", () => ({ useLocation: () => ["/checkout", vi.fn()], useSearch: () => "?orderId=22", Link: (props: any) => React.createElement("a", { href: props.href }, props.children) }));
vi.mock("@/lib/guestToken", () => ({ getGuestToken: () => null, saveGuestToken: vi.fn() }));
vi.mock("@/components/ProgressBar", () => ({ ProgressBar: () => null }));
vi.mock("@/components/ui/button", () => ({ Button: (props: any) => React.createElement("button", { disabled: props.disabled }, props.children) }));
vi.mock("@/components/ui/card", () => ({
  Card: (props: any) => React.createElement("div", {}, props.children),
  CardContent: (props: any) => React.createElement("div", {}, props.children),
  CardHeader: (props: any) => React.createElement("div", {}, props.children),
  CardTitle: (props: any) => React.createElement("h2", {}, props.children),
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
import Checkout from "../client/src/pages/Checkout";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  mocks.order = {
    id: 22, status: "pending", paymentStatus: "unpaid", amount: "19.99", childName: "Mock child",
    story: "Mock story", storyApproved: false, originalImageKey: "7/original.jpg",
    originalImageUrl: "https://signed.example.invalid/original", previewImageKey: null, previewImageUrl: null,
    previewError: null, originalImageAccessError: null, previewImageAccessError: null, previewGenerating: false,
  };
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("checkout preview status", () => {
  it("shows a failed preview message and explicit retry instead of an indefinite generation spinner", () => {
    mocks.order.previewError = "generation failed. Please try again.";
    const html = renderToStaticMarkup(React.createElement(Checkout));
    expect(html).toContain("generation failed. Please try again.");
    expect(html).toContain("Retry preview");
    expect(html).not.toContain("Generating preview...");
  });
  it("shows progress for an active job and disables retry", () => {
    mocks.order.previewGenerating = true;
    const html = renderToStaticMarkup(React.createElement(Checkout));
    expect(html).toContain("Generating preview...");
    expect(html).toContain("disabled");
  });
  it.each(["paid", "refunded"])("does not offer preview retry for %s orders", (status) => {
    mocks.order.paymentStatus = status;
    expect(renderToStaticMarkup(React.createElement(Checkout))).not.toContain("Retry preview");
  });
  it("shows a clear original-image access error and read-only refresh", () => {
    mocks.order.originalImageUrl = null;
    mocks.order.originalImageAccessError = "This image is temporarily unavailable.";
    const html = renderToStaticMarkup(React.createElement(Checkout));
    expect(html).toContain("This image is temporarily unavailable.");
    expect(html).toContain("Refresh images");
  });
});
