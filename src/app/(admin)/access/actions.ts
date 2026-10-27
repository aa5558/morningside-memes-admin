"use server";

import { revalidatePath } from "next/cache";
import { AdminAuthError, requireAdminAction } from "@/lib/auth";
import type { FormResult } from "@/app/(admin)/resources/actions";

// UPDATE the signup gate. RLS lets only superadmins change it, and the
// change is written to the audit log by a trigger.
export async function setSignupRestriction(restricted: boolean): Promise<FormResult> {
  try {
    const { supabase } = await requireAdminAction();
    if (typeof restricted !== "boolean") return { error: "Invalid value." };

    if (restricted) {
      // Don't lock the door with no way in: require at least one domain or email.
      const [{ count: domains }, { count: emails }] = await Promise.all([
        supabase.from("allowed_signup_domains").select("id", { count: "exact", head: true }),
        supabase.from("whitelisted_emails").select("id", { count: "exact", head: true }),
      ]);
      if (!domains && !emails) return { error: "Add at least one domain or email before restricting signups." };
    }

    const { data, error } = await supabase
      .from("signup_settings")
      .update({ restrict_signups: restricted })
      .eq("id", true)
      .select("restrict_signups");
    if (error || !data?.length) return { error: "Couldn't change the signup setting." };

    revalidatePath("/access");
    revalidatePath("/audit");
    return { success: restricted ? "Signups are now restricted." : "Signups are open to any Google account." };
  } catch (error) {
    if (error instanceof AdminAuthError) return { error: error.message };
    throw error;
  }
}
