"use client";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        The dashboard couldn&apos;t load this data. {error.digest ? `(ref ${error.digest})` : ""}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white dark:bg-columbia dark:text-navy"
      >
        Try again
      </button>
    </div>
  );
}
