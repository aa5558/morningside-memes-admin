"use client";

import { useState, useTransition } from "react";
import {
  deleteCaption,
  deletePost,
  generateMoreCaptions,
  promoteToExample,
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
  scene,
}: {
  captionId: string;
  generationId: string;
  text: string;
  editable: boolean;
  votes: number;
  scene: string;
}) {
  const [editing, setEditing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [sceneDraft, setSceneDraft] = useState(scene);
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

  if (promoting) {
    return (
      <form
        className="mt-2 rounded-[16px] bg-background p-3 ring-1 ring-line"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await promoteToExample(captionId, generationId, sceneDraft);
            setResult(r);
            if (!r.error) setPromoting(false);
          });
        }}
      >
        <label htmlFor={`scene-${captionId}`} className="text-xs font-medium text-muted">
          Describe the photo for the model (it can&apos;t see this one)
        </label>
        <textarea
          id={`scene-${captionId}`}
          value={sceneDraft}
          onChange={(e) => setSceneDraft(e.target.value)}
          minLength={3}
          maxLength={300}
          rows={2}
          autoFocus
          placeholder="e.g. A student asleep on a pile of books in Butler"
          className="mt-1 w-full rounded-[14px] border border-[rgba(22,38,61,0.12)] bg-white px-3 py-2 text-sm outline-none focus:border-sky focus:ring-4 focus:ring-sky/25"
        />
        <div className="mt-2 flex gap-2">
          <button type="submit" disabled={pending || sceneDraft.trim().length < 3} className="btn btn-primary btn-sm">
            {pending ? "Saving…" : "Save as example"}
          </button>
          <button type="button" onClick={() => setPromoting(false)} className={smallBtn}>
            Cancel
          </button>
        </div>
        <Message result={result} />
      </form>
    );
  }

  return (
    <div>
      <div className="mt-1.5 flex gap-1">
        <button type="button" onClick={() => setPromoting(true)} className={smallBtn}>
          ★ Save as example
        </button>
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

export function GenerateCaptions({ generationId, chains }: { generationId: string; chains: { id: string; name: string }[] }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [chain, setChain] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <select
          aria-label="Prompt chain"
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          disabled={pending}
          className="rounded-full border border-[rgba(22,38,61,0.12)] bg-white px-3 py-1.5 text-xs outline-none focus:border-sky"
        >
          <option value="">Chain: use the mix</option>
          {chains.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setResult(await generateMoreCaptions(generationId, chain || null)))}
          className="btn btn-ice btn-sm"
        >
          <span aria-hidden>✨</span>
          {pending ? "Running the chain…" : "Generate more"}
        </button>
      </div>
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
