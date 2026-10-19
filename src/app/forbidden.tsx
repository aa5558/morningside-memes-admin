import { signOut } from "@/app/auth/actions";
import { getViewer } from "@/lib/auth";
import { MAIN_APP_URL } from "@/lib/admin-data";

// Shown (with HTTP 403) to signed-in users who aren't superadmins.
export default async function AccessDenied() {
  const viewer = await getViewer();
  const email = viewer.status !== "signed-out" ? viewer.user.email : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-2xl">
          <span aria-hidden>🔒</span>
        </div>
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-muted">
          {email ? (
            <>
              <span className="font-medium text-foreground">{email}</span> is signed in, but
              this account isn&apos;t a Morningside Memes superadmin.
            </>
          ) : (
            "This account isn't a Morningside Memes superadmin."
          )}
        </p>
        <p className="mt-2 text-sm text-muted">
          If you should have access, ask a database administrator to grant it.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-[#123d77] sm:w-auto dark:bg-columbia dark:text-navy"
            >
              Sign in with another account
            </button>
          </form>
          <a
            href={MAIN_APP_URL}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            Go to Morningside Memes
          </a>
        </div>
      </div>
    </main>
  );
}
