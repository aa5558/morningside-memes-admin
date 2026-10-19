import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// The one place the admin app decides who gets in. Every page, server action
// and route handler calls one of the functions below. They ask the database,
// not the browser: getUser() validates the session with Supabase Auth, and
// is_superadmin() reads profiles.is_superadmin for that user. The database
// functions the app calls re-check the same flag, so a missed check here
// still can't leak admin data.

export type Viewer =
  | { status: "signed-out" }
  | { status: "denied"; user: User; supabase: SupabaseClient }
  | { status: "admin"; user: User; supabase: SupabaseClient };

export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed-out" };

  const { data, error } = await supabase.rpc("is_superadmin");
  if (error) {
    console.error("is_superadmin check failed", error.message);
  }
  // Fail closed: any error counts as "not an admin".
  return data === true
    ? { status: "admin", user, supabase }
    : { status: "denied", user, supabase };
});

// For pages and layouts: sends signed-out visitors to /login and shows the
// Access Denied page (HTTP 403) to everyone else who isn't a superadmin.
export async function requireAdmin(next?: string) {
  const viewer = await getViewer();
  if (viewer.status === "signed-out") {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  if (viewer.status !== "admin") forbidden();
  return viewer;
}

export class AdminAuthError extends Error {}

// For server actions: same check, but throws instead of rendering, so a
// direct POST to the action endpoint gets nothing.
export async function requireAdminAction() {
  const viewer = await getViewer();
  if (viewer.status !== "admin") {
    throw new AdminAuthError(
      viewer.status === "signed-out" ? "Sign in required." : "Superadmin access required."
    );
  }
  return viewer;
}

// For route handlers: returns either the admin context or a 401/403 response.
export async function requireAdminApi(): Promise<
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; response: NextResponse }
> {
  const viewer = await getViewer();
  if (viewer.status === "signed-out") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in required." }, { status: 401 }),
    };
  }
  if (viewer.status !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Superadmin access required." }, { status: 403 }),
    };
  }
  return { ok: true, supabase: viewer.supabase, user: viewer.user };
}
