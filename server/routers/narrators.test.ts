import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { NARRATOR_AUDITION_TEXT } from "../../shared/narratorAuditions";

const mocks = vi.hoisted(() => ({ audition: vi.fn() }));
vi.mock("../services/narratorAuditions", () => {
  class NarratorAuditionError extends Error {
    constructor(public code: string) {
      super(code === "BUSY"
        ? "This narrator audition is already being prepared. Please try again shortly."
        : "This native narrator audition is unavailable. No substitute voice or model was used.");
    }
  }
  return { getNarratorAudition: mocks.audition, NarratorAuditionError };
});
import { narratorsRouter } from "./narrators";
import { NarratorAuditionError } from "../services/narratorAuditions";

function context(role: "user" | "admin" | null): TrpcContext {
  return {
    user: role ? {
      id: 1, openId: `test-${role}`, email: "test@example.com", name: "Test",
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
beforeEach(() => { vi.clearAllMocks(); });

describe("native narrator audition API", () => {
  it.each([null, "user"] as const)("denies list and generation to %s without provider work", async role => {
    const caller = narratorsRouter.createCaller(context(role));
    await expect(caller.listAuditions()).rejects.toBeInstanceOf(Error);
    await expect(caller.audition({ presetId: "playful", confirmCredits: true })).rejects.toBeInstanceOf(Error);
    expect(mocks.audition).not.toHaveBeenCalled();
  });
  it("lists the fixed recipe without generating speech", async () => {
    const result = await narratorsRouter.createCaller(context("admin")).listAuditions();
    expect(result.presets.map(p => p.name)).toEqual(["Jade", "Darian", "Talia"]);
    expect(result.text).toBe(NARRATOR_AUDITION_TEXT);
    expect(result.modelId).toBe("eleven_multilingual_v2");
    expect(result.retirementDate).toBe("December 31, 2026");
    expect(mocks.audition).not.toHaveBeenCalled();
  });
  it.each([
    { presetId: "playful", confirmCredits: false },
    { presetId: "arbitrary-voice", confirmCredits: true },
    { presetId: "playful", confirmCredits: true, voiceId: "attacker" },
    { presetId: "playful", confirmCredits: true, text: "arbitrary text" },
    { presetId: "playful", confirmCredits: true, key: "customer/photo" },
  ])("rejects unconfirmed or arbitrary input before provider work", async input => {
    const caller = narratorsRouter.createCaller(context("admin"));
    await expect(caller.audition(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.audition).not.toHaveBeenCalled();
  });
  it("runs only the fixed confirmed preset for an admin", async () => {
    const result = { id: "warm", name: "Darian", label: "Warm storyteller", url: "https://signed.example.test/clip", fromCache: true, modelId: "eleven_multilingual_v2" };
    mocks.audition.mockResolvedValueOnce(result);
    expect(await narratorsRouter.createCaller(context("admin")).audition({ presetId: "warm", confirmCredits: true })).toEqual(result);
    expect(mocks.audition).toHaveBeenCalledWith("warm");
  });
  it("maps busy leases to safe conflict errors", async () => {
    mocks.audition.mockRejectedValueOnce(new NarratorAuditionError("BUSY"));
    await expect(narratorsRouter.createCaller(context("admin")).audition({ presetId: "bedtime", confirmCredits: true })).rejects.toMatchObject({ code: "CONFLICT", message: "This narrator audition is already being prepared. Please try again shortly." });
  });
  it("does not expose unexpected provider or credential details", async () => {
    mocks.audition.mockRejectedValueOnce(new Error("SECRET_PROVIDER_PAYLOAD"));
    await expect(narratorsRouter.createCaller(context("admin")).audition({ presetId: "playful", confirmCredits: true })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "The narrator audition could not be prepared. Check the staging voice and storage settings." });
  });
});
