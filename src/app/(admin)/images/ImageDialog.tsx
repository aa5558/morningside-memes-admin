"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { FormResult } from "@/app/(admin)/resources/actions";

const input =
  "w-full rounded-[16px] border border-[rgba(22,38,61,0.12)] bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-subtle focus:border-sky focus:ring-4 focus:ring-sky/25";

type Values = { title: string; alt_text: string; tags: string[]; featured_on: string | null; is_active: boolean; url?: string };

// Upload (with a file) or edit (details only) a library image.
export function ImageDialog({
  mode,
  action,
  values,
  trigger,
  triggerClassName,
}: {
  mode: "upload" | "edit";
  action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  values?: Values;
  trigger: string;
  triggerClassName: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Every card has its own edit dialog, so ids must be unique per dialog.
  const uid = useId();
  const [state, formAction, pending] = useActionState(action, {});
  const [preview, setPreview] = useState<string | null>(values?.url ?? null);
  const handled = useRef<number | undefined>(undefined);
  const [openedAt, setOpenedAt] = useState(0);
  const fresh = (state.at ?? 0) > openedAt;

  useEffect(() => {
    if (state.success && state.at && state.at !== handled.current) {
      handled.current = state.at;
      dialog.current?.close();
    }
  }, [state.success, state.at]);

  const err = (name: string) =>
    fresh && state.fieldErrors?.[name] ? (
      <p role="alert" className="px-1 text-xs text-danger">
        {state.fieldErrors[name]}
      </p>
    ) : null;

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => {
          setOpenedAt(Date.now());
          if (mode === "upload") setPreview(null);
          dialog.current?.showModal();
        }}
      >
        {trigger}
      </button>
      <dialog
        ref={dialog}
        aria-label={mode === "upload" ? "Upload an image" : "Edit image"}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-[28px] border-0 bg-white p-0 text-ink shadow-[0_30px_80px_-20px_rgba(22,38,61,0.45)] backdrop:bg-ink/25 backdrop:backdrop-blur-sm"
      >
        <form action={formAction} key={openedAt} className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 className="display text-2xl">{mode === "upload" ? "Upload to the library" : "Edit image"}</h2>

          {mode === "upload" ? (
            <label className="group relative flex min-h-44 cursor-pointer items-center justify-center overflow-hidden rounded-[22px] border-2 border-dashed border-ice bg-background transition hover:border-sky">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Selected file preview" className="max-h-64 object-contain" />
              ) : (
                <span className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted">
                  <span className="orb flex h-12 w-12 items-center justify-center rounded-full text-xl">🖼️</span>
                  <span className="font-semibold text-ink">Choose an image</span>
                  PNG, JPEG or WEBP · up to 5 MB
                </span>
              )}
              <input
                name="file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                required
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
              />
            </label>
          ) : (
            preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="max-h-56 w-full rounded-[22px] bg-powder object-contain" />
            )
          )}
          {err("file")}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-img-title`} className="px-1 text-xs font-semibold text-muted">
              Title <span className="text-down">*</span>
            </label>
            <input id={`${uid}-img-title`} name="title" required maxLength={80} defaultValue={values?.title} placeholder="e.g. Low Steps, first snow" className={input} />
            {err("title")}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-img-alt`} className="px-1 text-xs font-semibold text-muted">
              Alt text <span className="text-down">*</span>
            </label>
            <textarea id={`${uid}-img-alt`} name="alt_text" required minLength={3} maxLength={300} rows={2} defaultValue={values?.alt_text} placeholder="What's in the photo, for people using screen readers" className={input} />
            {err("alt_text")}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-img-tags`} className="px-1 text-xs font-semibold text-muted">
                Tags
              </label>
              <input id={`${uid}-img-tags`} name="tags" defaultValue={values?.tags.join(", ")} placeholder="campus, snow" className={input} />
              {err("tags")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-img-day`} className="px-1 text-xs font-semibold text-muted">
                Daily Drop date
              </label>
              <input id={`${uid}-img-day`} name="featured_on" type="date" defaultValue={values?.featured_on ?? ""} className={input} />
              {err("featured_on")}
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-[16px] bg-background px-3.5 py-3 text-sm ring-1 ring-line">
            <input type="checkbox" name="is_active" defaultChecked={values?.is_active ?? true} className="mt-0.5 h-4 w-4 accent-[#1f6fd1]" />
            <span>
              <span className="font-medium">Visible in the main app</span>
              <span className="block text-xs text-muted">Shows up in Surprise Me and the Studio. A Daily Drop stays hidden until its day.</span>
            </span>
          </label>

          {fresh && state.error && <p role="alert" className="rounded-[16px] bg-[#ffede6] px-4 py-2.5 text-sm text-down-ink">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? (mode === "upload" ? "Uploading…" : "Saving…") : mode === "upload" ? "Upload" : "Save"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
