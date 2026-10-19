"use client";

import { useRef, useState, type ReactNode } from "react";

// A destructive button that opens a modal and only runs `onConfirm` after the
// admin types the confirmation word (when `confirmWord` is set) and clicks
// the red button.
export function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  confirmWord,
  onConfirm,
  className,
}: {
  label: ReactNode;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  confirmWord?: string;
  onConfirm: () => Promise<void>;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const ready = !confirmWord || typed.trim().toUpperCase() === confirmWord;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          dialog.current?.showModal();
        }}
        className={className}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/50"
      >
        <form
          method="dialog"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready) return;
            setPending(true);
            try {
              await onConfirm();
              dialog.current?.close();
            } finally {
              setPending(false);
            }
          }}
          className="p-5"
        >
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="mt-2 text-sm text-muted">{body}</div>
          {confirmWord && (
            <label className="mt-4 block text-xs font-medium text-muted">
              Type <span className="font-mono font-semibold text-foreground">{confirmWord}</span> to confirm
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 font-mono text-sm outline-none focus:border-danger"
              />
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ready || pending}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
