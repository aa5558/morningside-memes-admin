"use server";

import { revalidatePath } from "next/cache";
import { AdminAuthError, requireAdminAction } from "@/lib/auth";
import { isUuid } from "@/lib/validate";

export type MixResult = { error?: string; success?: string };

const MIX_ERRORS: Record<string, string> = {
  mix_must_total_100: "The mix has to add up to exactly 100%.",
  invalid_mix: "The mix has an invalid value. Refresh and try again.",
  chain_not_runnable: "A chain that can't run (inactive model or provider) can't get any share. Set it to 0%.",
  forbidden: "Superadmin access required.",
};

// UPDATE the prompt chain mix: the share of new posts each chain captions.
export async function updateChainMix(weights: Record<string, number>): Promise<MixResult> {
  try {
    const { supabase } = await requireAdminAction();
    if (!weights || typeof weights !== "object" || Array.isArray(weights)) return { error: MIX_ERRORS.invalid_mix };
    const entries = Object.entries(weights);
    if (
      entries.length === 0 ||
      entries.length > 50 ||
      !entries.every(([id, w]) => isUuid(id) && Number.isInteger(w) && w >= 0 && w <= 100)
    ) {
      return { error: MIX_ERRORS.invalid_mix };
    }
    if (entries.reduce((sum, [, w]) => sum + w, 0) !== 100) return { error: MIX_ERRORS.mix_must_total_100 };

    const { error } = await supabase.rpc("admin_update_chain_mix", { p_weights: weights });
    if (error) return { error: MIX_ERRORS[error.message] ?? "Couldn't save the mix." };

    revalidatePath("/studio");
    revalidatePath("/audit");
    return { success: "Mix saved. New posts use it right away." };
  } catch (error) {
    if (error instanceof AdminAuthError) return { error: error.message };
    throw error;
  }
}
