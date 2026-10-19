import { signOut } from "@/app/auth/actions";
import { Sidebar } from "@/components/Sidebar";
import { MAIN_APP_URL } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Every admin page lives under this layout. The superadmin check here is
// repeated in each page (requireAdmin is cached per request), because a
// layout check alone doesn't cover pages rendered on client navigation.
export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const { user, supabase } = await requireAdmin();

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    (user.user_metadata?.full_name as string | undefined) ||
    user.email?.split("@")[0] ||
    "Admin";

  return (
    <div className="min-h-screen">
      <Sidebar
        name={name}
        email={user.email ?? ""}
        avatarUrl={profile?.avatar_url ?? (user.user_metadata?.avatar_url as string | undefined) ?? null}
        mainAppUrl={MAIN_APP_URL}
        signOutAction={signOut}
      />
      <div className="lg:pl-[264px]">
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
