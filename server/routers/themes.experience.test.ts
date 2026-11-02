import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const mocks = vi.hoisted(() => ({
  listPublic: vi.fn(),
  listAdmin: vi.fn(),
  save: vi.fn(),
  setPublished: vi.fn(),
  reorder: vi.fn(),
}));

vi.mock("../services/experienceCatalog", async importOriginal => {
  const actual = await importOriginal<typeof import("../services/experienceCatalog")>();
  return {
    ...actual,
    getPublicExperienceCatalog: mocks.listPublic,
    getAdminExperienceCatalog: mocks.listAdmin,
    saveExperienceTheme: mocks.save,
    setExperienceThemePublished: mocks.setPublished,
    reorderExperienceThemes: mocks.reorder,
  };
});

import { appRouter } from "../routers";
import { ExperienceCatalogConflictError } from "../services/experienceCatalog";

const adminCatalog = {
  revision: '"revision-1"',
  themes: [
    {
      id: "adventure",
      title: "Adventure",
      description: "Exciting quests through magical lands",
      category: "classics",
      icon: "sparkles" as const,
      color: "amber" as const,
      storySetting: "An exciting quest through magical lands with challenges to overcome",
      storyTone: "thrilling, courageous, and wonder-filled",
      defaultMusicId: "playful-adventure" as const,
      featured: true,
      sortOrder: 0,
      published: true,
    },
  ],
  music: [],
};

const publicCatalog = {
  revision: adminCatalog.revision,
  themes: adminCatalog.themes.map(({ storySetting, storyTone, published, ...theme }) => theme),
  music: [],
};

function context(role: "user" | "admin" | null): TrpcContext {
  return {
    user: role
      ? {
          id: 1,
          openId: `test-${role}`,
          email: "test@example.com",
          name: "Test User",
          loginMethod: "manus",
          role,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listPublic.mockResolvedValue(publicCatalog);
  mocks.listAdmin.mockResolvedValue(adminCatalog);
  mocks.save.mockResolvedValue(adminCatalog);
  mocks.setPublished.mockResolvedValue(adminCatalog);
  mocks.reorder.mockResolvedValue(adminCatalog);
});

describe("themes root router", () => {
  it("registers public discovery and never returns generation prompts", async () => {
    const caller = appRouter.createCaller(context(null));
    const result = await caller.themes.listPublic();

    expect(mocks.listPublic).toHaveBeenCalledOnce();
    expect(result).toEqual(publicCatalog);
    expect(result.themes[0]).not.toHaveProperty("storySetting");
    expect(result.themes[0]).not.toHaveProperty("storyTone");
    expect(result.themes[0]).not.toHaveProperty("published");
  });

  it("denies every admin catalog operation to non-admin callers", async () => {
    const caller = appRouter.createCaller(context("user"));
    const operations = [
      caller.themes.listAdmin(),
      caller.themes.save({ expectedRevision: adminCatalog.revision, theme: adminCatalog.themes[0] }),
      caller.themes.setPublished({ expectedRevision: adminCatalog.revision, id: "adventure", published: false }),
      caller.themes.reorder({ expectedRevision: adminCatalog.revision, ids: ["adventure"] }),
    ];

    for (const operation of operations) {
      await expect(operation).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.listAdmin).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.setPublished).not.toHaveBeenCalled();
    expect(mocks.reorder).not.toHaveBeenCalled();
  });

  it("returns tRPC CONFLICT for a stale conditional save instead of overwriting", async () => {
    mocks.save.mockRejectedValueOnce(new ExperienceCatalogConflictError("Refresh before saving."));
    const caller = appRouter.createCaller(context("admin"));

    await expect(
      caller.themes.save({ expectedRevision: adminCatalog.revision, theme: adminCatalog.themes[0] })
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Refresh before saving." });

    expect(mocks.save).toHaveBeenCalledWith(adminCatalog.revision, adminCatalog.themes[0]);
  });
});
