"use client";

import { useActionState, useState } from "react";
import { createPost, type ActionResult } from "@/app/(admin)/media/actions";

export function CreatePostForm({ vibes, dailyPrompt }: { vibes: { value: string; label: string }[]; dailyPrompt: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createPost, {});
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <form action={action} className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <label className="flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[26px] border-2 border-dashed border-ice bg-background transition hover:border-sky hover:bg-powder/50 text-center text-sm text-muted hover:border-human">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Selected photo preview" className="h-full w-full object-cover" />
        ) : (
          <span className="p-6">
            <span aria-hidden className="mb-2 block text-3xl">📷</span>
            Choose a photo
            <span className="mt-1 block text-xs text-subtle">PNG, JPEG or WEBP · up to 4 MB</span>
          </span>
        )}
        <input
          type="file"
          name="image"
          accept="image/png,image/jpeg,image/webp"
          required
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPreview((old) => {
              if (old) URL.revokeObjectURL(old);
              return file ? URL.createObjectURL(file) : null;
            });
          }}
        />
      </label>

      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">Caption voice</legend>
          <div className="grid gap-2">
            {vibes.map((v, i) => (
              <label key={v.value} className="flex cursor-pointer items-center gap-2 rounded-full bg-background px-3 py-2.5 text-sm font-medium ring-1 ring-line transition hover:ring-sky has-[:checked]:bg-ice has-[:checked]:ring-2 has-[:checked]:ring-sky">
                <input type="radio" name="vibe" value={v.value} defaultChecked={i === 0} className="accent-[var(--series-human)]" />
                {v.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-xs font-medium text-muted">
          Context (optional)
          <textarea
            name="context"
            maxLength={200}
            rows={3}
            placeholder="Anything Gemini should know about the photo"
            className="mt-1 w-full rounded-[18px] border border-[rgba(22,38,61,0.12)] bg-white px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-sky focus:ring-4 focus:ring-sky/25"
          />
        </label>
        <p className="rounded-[18px] bg-powder p-3 text-xs text-muted">
          Posts into today&apos;s challenge (“{dailyPrompt}”) as you, using the same prompt and model as the main app.
          The full prompt is saved with the post.
        </p>
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-auto btn btn-primary"
        >
          {pending ? "Uploading & asking Gemini…" : "Upload & generate captions"}
        </button>
      </div>
    </form>
  );
}
