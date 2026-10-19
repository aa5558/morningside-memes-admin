"use client";

import { useState, useTransition } from "react";
import {
  deleteCaption,
  deletePost,
  generateMoreCaptions,
  updateCaption,
  updateContext,
  type ActionResult,
} from "@/app/(admin)/media/actions";
import { ConfirmButton } from "@/components/ConfirmButton";

function Message({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return result.error ? (
    <p role="alert" className="mt-2 text-xs text-danger">
      {result.error}
    </p>
  ) : result.success ? (
    <p role="status" className="mt-2 text-xs text-success">
      {result.success}
    </p>
  ) : null;
}

const smallBtn =
  "rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5";

export function CaptionActions({
  captionId,
  generationId,
  text,
  editable,
  votes,
}: {
  captionId: string;
  generationId: string;
  text: string;
  editable: boolean;
  votes: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (editing) {
    return (
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateCaption(captionId, generationId, draft);
            setResult(r);
            if (!r.error) setEditing(false);
          });
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={300}
          rows={2}
          autoFocus
          className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-human"
        />
        {votes > 0 && (
          <p className="mt-1 text-xs text-ai">
            This caption already has {votes} vote{votes === 1 ? "" : "s"}. Rewording it changes what people voted on;
            the original text is kept in the audit log.
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button type="submit" disabled={pending} className="rounded-md bg-navy px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-columbia dark:text-navy">
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(text);
              setEditing(false);
              setResult(null);
            }}
            className={smallBtn}
          >
            Cancel
          </button>
          <span className="tabular ml-auto text-xs text-subtle">{draft.trim().length}/300</span>
        </div>
        <Message result={result} />
      </form>
    );
  }

  return (
    <div>
      <div className="mt-1.5 flex gap-1">
        {editable && (
          <button type="button" onClick={() => setEditing(true)} className={smallBtn}>
            Edit
          </button>
        )}
        <ConfirmButton
          label="Delete"
          className={`${smallBtn} hover:!text-danger`}
          title="Delete this caption?"
          body={
            <>
              <p className="rounded-lg bg-black/4 p-2 italic dark:bg-white/5">“{text}”</p>
              <p className="mt-2">
                {votes > 0
                  ? `Its ${votes} vote${votes === 1 ? "" : "s"} will be removed with it. `
                  : ""}
                The deletion is recorded in the audit log. This can&apos;t be undone.
              </p>
            </>
          }
          confirmLabel="Delete caption"
          onConfirm={async () => {
            setResult(await deleteCaption(captionId, generationId));
          }}
        />
      </div>
      <Message result={result} />
    </div>
  );
}

export function ContextEditor({ generationId, context }: { generationId: string; context: string | null }) {
  const [draft, setDraft] = useState(context ?? "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = draft.trim() !== (context ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await updateContext(generationId, draft)));
      }}
    >
      <label htmlFor="context" className="text-xs font-medium text-muted">
        Photo context (shown under the photo in the main app)
      </label>
      <textarea
        id="context"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setResult(null);
        }}
        maxLength={200}
        rows={2}
        placeholder="No context"
        className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-human"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="submit"
          disabled={!dirty || pending}
          className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-columbia dark:text-navy"
        >
          {pending ? "Saving…" : "Save context"}
        </button>
        <span className="tabular ml-auto text-xs text-subtle">{draft.trim().length}/200</span>
      </div>
      <Message result={result} />
    </form>
  );
}

export function GenerateCaptions({ generationId }: { generationId: string }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await generateMoreCaptions(generationId)))}
        className="inline-flex items-center gap-2 rounded-lg border border-ai/40 bg-ai/8 px-3 py-1.5 text-sm font-medium text-ai hover:bg-ai/12 disabled:opacity-60"
      >
        <span aria-hidden>✨</span>
        {pending ? "Asking Gemini…" : "Generate more AI captions"}
      </button>
      <Message result={result} />
    </div>
  );
}

export function DeletePost({ generationId, captions, votes }: { generationId: string; captions: number; votes: number }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div>
      <ConfirmButton
        label="Delete post"
        className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/8"
        title="Delete this entire post?"
        body={
          <p>
            This permanently deletes the photo, its {captions} caption{captions === 1 ? "" : "s"}, and the {votes} vote
            {votes === 1 ? "" : "s"} on them, and removes the image file from storage. A record of what was deleted is
            kept in the audit log.
          </p>
        }
        confirmLabel="Delete post"
        confirmWord="DELETE"
        onConfirm={async () => {
          const r = await deletePost(generationId);
          if (r?.error) setResult(r);
        }}
      />
      <Message result={result} />
    </div>
  );
}
