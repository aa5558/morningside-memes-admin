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
    <main className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-5 py-12 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="flex flex-col gap-5">
        <div className="flex items-center gap-2.5">
          <span className="orb flex h-10 w-10 items-center justify-center rounded-full">
            <span className="display text-base text-ink">mm</span>
          </span>
          <span className="display text-lg text-ink">
            morningside memes<span className="text-sky">.</span>
          </span>
        </div>
        <p className="eyebrow mt-6">admin console</p>
        <h1 className="display text-5xl text-ink sm:text-7xl">
          Behind the
          <br />
          <span className="serif text-[#1f6fd1]">scenes.</span>
        </h1>
        <p className="max-w-md text-[17px] leading-relaxed text-muted">
          Stats, moderation, and every caption battle in one place. Restricted to Morningside Memes
          superadmins.
        </p>
      </section>

      <section className="glass relative overflow-hidden rounded-[36px] p-8 sm:p-10">
        <span aria-hidden className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-ice/70 blur-3xl" />
        <div className="relative flex flex-col gap-5">
          <div>
            <h2 className="display text-3xl text-ink">Admin Console</h2>
            <p className="mt-1 text-sm text-muted">
              Restricted area. Sign in with the Google account linked to a Morningside Memes superadmin profile.
            </p>
          </div>
          {error && (
            <p role="alert" className="rounded-[18px] bg-[#ffede6] px-4 py-3 text-sm text-danger">
              {ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."}
            </p>
          )}
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <button type="submit" className="btn btn-primary w-full !py-3.5 !text-base">
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5">
                <path fill="#fff" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
              </svg>
              Continue with Google
            </button>
          </form>
          <p className="text-xs leading-relaxed text-subtle">
            Access is granted per account by a database administrator. Signing in with Google alone does not
            grant admin access.
          </p>
        </div>
      </section>
    </main>
  );
}
