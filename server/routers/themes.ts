import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import {
  ExperienceCatalogConflictError,
  ExperienceCatalogValidationError,
  expectedRevisionSchema,
  getAdminExperienceCatalog,
  getPublicExperienceCatalog,
  reorderExperienceThemes,
  reorderThemeIdsSchema,
  saveExperienceTheme,
  setExperienceThemePublished,
  themeDefinitionSchema,
  themeIdSchema,
} from "../services/experienceCatalog";

async function catalogProcedure<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ExperienceCatalogConflictError) {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    if (error instanceof ExperienceCatalogValidationError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

export const themesRouter = router({
  listPublic: publicProcedure.query(() => catalogProcedure(getPublicExperienceCatalog)),

  listAdmin: adminProcedure.query(() => catalogProcedure(getAdminExperienceCatalog)),

  save: adminProcedure
    .input(
      z
        .object({
          expectedRevision: expectedRevisionSchema,
          theme: themeDefinitionSchema,
        })
        .strict()
    )
    .mutation(({ input }) =>
      catalogProcedure(() => saveExperienceTheme(input.expectedRevision, input.theme))
    ),

  setPublished: adminProcedure
    .input(
      z
        .object({
          expectedRevision: expectedRevisionSchema,
          id: themeIdSchema,
          published: z.boolean(),
        })
        .strict()
    )
    .mutation(({ input }) =>
      catalogProcedure(() =>
        setExperienceThemePublished(input.expectedRevision, input.id, input.published)
      )
    ),

  reorder: adminProcedure
    .input(
      z
        .object({
          expectedRevision: expectedRevisionSchema,
          ids: reorderThemeIdsSchema,
        })
        .strict()
    )
    .mutation(({ input }) =>
      catalogProcedure(() => reorderExperienceThemes(input.expectedRevision, input.ids))
    ),
});
