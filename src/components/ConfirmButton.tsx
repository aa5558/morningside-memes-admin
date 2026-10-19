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
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[28px] border-0 bg-white p-0 text-ink shadow-[0_30px_80px_-20px_rgba(22,38,61,0.45)] backdrop:bg-ink/25 backdrop:backdrop-blur-sm"
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
          <h2 className="display text-2xl">{title}</h2>
          <div className="mt-2 text-sm text-muted">{body}</div>
          {confirmWord && (
            <label className="mt-4 block text-xs font-medium text-muted">
              Type <span className="font-mono font-semibold text-foreground">{confirmWord}</span> to confirm
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="mt-1 w-full rounded-full border border-[rgba(22,38,61,0.12)] bg-white px-4 py-2 font-mono text-sm outline-none focus:border-down focus:ring-4 focus:ring-down/20"
              />
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="btn btn-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ready || pending}
              className="btn btn-danger"
            >
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
