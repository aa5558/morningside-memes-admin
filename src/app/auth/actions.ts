"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

async function getSiteURL() {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol =
    headersList.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNext(formData.get("next"));

  const supabase = await createClient();
  const redirectTo = new URL("/auth/callback", await getSiteURL());
  if (next !== "/") redirectTo.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo.toString(),
      // Always show the account picker, so someone who landed on Access
      // Denied can switch to their admin account.
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth");
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
