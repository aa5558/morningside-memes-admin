import { signOut } from "@/app/auth/actions";
import { getViewer } from "@/lib/auth";
import { MAIN_APP_URL } from "@/lib/admin-data";

// Shown (with HTTP 403) to signed-in users who aren't superadmins.
export default async function AccessDenied() {
  const viewer = await getViewer();
  const email = viewer.status !== "signed-out" ? viewer.user.email : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <div className="glass w-full max-w-md rounded-[36px] p-8 text-center sm:p-10">
        <div className="orb mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full text-2xl">
          <span aria-hidden>🔒</span>
        </div>
        <h1 className="display text-4xl text-ink">
          Access <span className="serif">denied</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {email ? (
            <>
              <span className="font-semibold text-ink">{email}</span> is signed in, but this account isn&apos;t a
              Morningside Memes superadmin.
            </>
          ) : (
            "This account isn't a Morningside Memes superadmin."
          )}
        </p>
        <p className="mt-2 text-sm text-muted">If you should have access, ask a database administrator to grant it.</p>
        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <form action={signOut}>
            <button type="submit" className="btn btn-primary w-full sm:w-auto">
              Sign in with another account
            </button>
          </form>
          <a href={MAIN_APP_URL} className="btn btn-ghost">
            Go to Morningside Memes
          </a>
        </div>
      </div>
    </main>
  );
}
