import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInWithGoogle } from "@/app/auth/actions";
import { safeNext } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  auth: "We couldn't sign you in. Please try again.",
  oauth: "We couldn't start the Google sign-in flow. Please try again.",
  missing_code: "That sign-in link was invalid. Please try again.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = safeNext(searchParams.next);
  const error = typeof searchParams.error === "string" ? searchParams.error : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(next);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-deep p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60rem 30rem at 15% 10%, rgba(185,217,235,0.18), transparent 60%), radial-gradient(40rem 25rem at 90% 90%, rgba(42,120,214,0.25), transparent 60%)",
        }}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-white p-8 shadow-2xl dark:bg-[#121a2a]">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-base font-bold text-columbia">
            MM
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Morningside Memes
            </p>
            <h1 className="text-xl font-semibold">Admin Console</h1>
          </div>
        </div>
        <p className="mb-6 text-sm text-muted">
          Restricted area. Sign in with the Google account linked to a Morningside Memes
          superadmin profile.
        </p>
        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-danger">
            {ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."}
          </p>
        )}
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-navy px-4 py-2.5 font-medium text-white shadow-sm transition hover:bg-[#123d77] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:bg-columbia dark:text-navy dark:hover:bg-white"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
              <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
            </svg>
            Continue with Google
          </button>
        </form>
        <p className="mt-6 text-xs text-subtle">
          Access is granted per account by a database administrator. Signing in with Google
          alone does not grant admin access.
        </p>
      </div>
    </main>
  );
}
