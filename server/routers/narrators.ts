import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  DEFAULT_VOICE_RETIREMENT_DATE,
  NARRATOR_AUDITION_MODEL,
  NARRATOR_AUDITION_PRESETS,
  NARRATOR_AUDITION_SETTINGS,
  NARRATOR_AUDITION_TEXT,
} from "../../shared/narratorAuditions";
import {
  checkNarratorAuditionStorage,
  getNarratorAudition,
  NarratorAuditionError,
} from "../services/narratorAuditions";

export const narratorsRouter = router({
  listAuditions: adminProcedure.query(() => ({
    presets: NARRATOR_AUDITION_PRESETS,
    text: NARRATOR_AUDITION_TEXT,
    modelId: NARRATOR_AUDITION_MODEL,
    settings: NARRATOR_AUDITION_SETTINGS,
    retirementDate: DEFAULT_VOICE_RETIREMENT_DATE,
  })),

  checkStorage: adminProcedure.mutation(async () => {
    try {
      return await checkNarratorAuditionStorage();
    } catch {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The sample storage check could not finish. No speech was requested.",
      });
    }
  }),

  audition: adminProcedure
    .input(
      z.object({
        presetId: z.enum(["playful", "warm", "bedtime"]),
        confirmCredits: z.literal(true),
      }).strict()
    )
    .mutation(async ({ input }) => {
      try {
        return await getNarratorAudition(input.presetId);
      } catch (error) {
        if (error instanceof NarratorAuditionError) {
          throw new TRPCError({
            code: error.code === "BUSY" ? "CONFLICT" : "PRECONDITION_FAILED",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The narrator audition could not be prepared. Check the staging voice and storage settings.",
        });
      }
    }),
});
