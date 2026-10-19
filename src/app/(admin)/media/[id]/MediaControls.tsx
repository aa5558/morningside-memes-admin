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
  "rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition hover:bg-powder hover:text-ink";

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
          className="w-full rounded-[18px] border border-[rgba(22,38,61,0.12)] bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky focus:ring-4 focus:ring-sky/25"
        />
        {votes > 0 && (
          <p className="mt-1 text-xs text-ai">
            This caption already has {votes} vote{votes === 1 ? "" : "s"}. Rewording it changes what people voted on;
            the original text is kept in the audit log.
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
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
              <p className="rounded-[14px] bg-background p-3 italic ring-1 ring-line">“{text}”</p>
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
        className="mt-1 w-full rounded-[18px] border border-[rgba(22,38,61,0.12)] bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky focus:ring-4 focus:ring-sky/25"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="submit"
          disabled={!dirty || pending}
          className="btn btn-primary btn-sm"
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
        className="btn btn-ice btn-sm"
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
        className="btn btn-ghost !text-danger"
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
