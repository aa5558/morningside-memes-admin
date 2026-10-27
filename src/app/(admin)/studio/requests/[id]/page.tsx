import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, Score } from "@/components/ui";
import { imageUrl } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getRequest } from "@/lib/studio-data";
import { isUuid } from "@/lib/validate";
import { seconds, StatusPill } from "@/components/studio";

export const metadata: Metadata = { title: "Generation run" };

export default async function RequestPage(props: PageProps<"/studio/requests/[id]">) {
  const { id } = await props.params;
  const { supabase } = await requireAdmin(`/studio/requests/${id}`);
  if (!isUuid(id)) notFound();
  const run = await getRequest(supabase, id);
  if (!run) notFound();

  const totalMs = run.finished_at ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime() : null;
  const maxLatency = Math.max(1, ...run.responses.map((r) => r.latency_ms ?? 0));

  return (
    <>
      <PageHeader
        title={run.chain_name ?? run.chain_slug}
        description={
          <>
            <StatusPill status={run.status} /> Run by {run.user_name ?? "a deleted user"} from the {run.source === "admin" ? "admin console" : "main app"} ·{" "}
            {formatDateTime(run.started_at)} · {seconds(totalMs)} total
          </>
        }
        actions={
          <Link href="/studio/requests" className="btn btn-ghost">
            ← All runs
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Timeline" description="Each model call in order, with exactly what was sent and what came back.">
          {run.responses.length === 0 && <p className="text-sm text-muted">No model calls were logged for this run.</p>}
          <ol className="relative flex flex-col gap-4 border-l-2 border-dashed border-ice pl-5">
            {run.responses.map((r) => (
              <li key={r.id} className="relative">
                <span aria-hidden className={`absolute -left-[29px] top-1 h-4 w-4 rounded-full ring-4 ring-white ${r.status === "ok" ? "bg-human" : "bg-down"}`} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    Step {r.step_position ?? "?"} · {r.step_name ?? "deleted step"}
                  </span>
                  <StatusPill status={r.status} />
                  <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[11px] ring-1 ring-line">{r.model_key}</span>
                  {r.http_status !== null && <span className="text-xs text-subtle">HTTP {r.http_status}</span>}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <span className="h-1.5 rounded-full bg-sky" style={{ width: `${Math.max(4, ((r.latency_ms ?? 0) / maxLatency) * 160)}px` }} aria-hidden />
                  {seconds(r.latency_ms)} · {r.input_tokens === null ? "—" : formatNumber(r.input_tokens)} in / {r.output_tokens === null ? "—" : formatNumber(r.output_tokens)} out tokens
                </div>
                {r.error_message && <p className="mt-2 rounded-[14px] bg-[#ffede6] px-3 py-2 text-xs text-down-ink">{r.error_message}</p>}
                <details className="mt-2 rounded-[14px] ring-1 ring-line">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Prompt sent</summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-relaxed text-muted">{r.prompt_text}</pre>
                </details>
                <details open className="mt-2 rounded-[14px] ring-1 ring-line">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Response</summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-relaxed text-ink">{r.response_text ?? "(empty)"}</pre>
                </details>
              </li>
            ))}
          </ol>
          {run.error_message && <p className="mt-4 rounded-[16px] bg-[#ffede6] px-4 py-3 text-sm text-down-ink">Run failed: {run.error_message}</p>}
        </Card>

        <div className="flex flex-col gap-5">
          {run.image_path && (
            <Card title="The photo" bodyClassName="p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(run.image_path)} alt="" className="w-full rounded-[18px] bg-powder object-cover" />
              {run.generation_id && (
                <Link href={`/media/${run.generation_id}`} className="mt-3 block text-center text-xs font-medium text-human hover:underline">
                  Open the post →
                </Link>
              )}
            </Card>
          )}
          <Card title="Captions saved" description="How they're doing in the battle.">
            {run.captions.length === 0 ? (
              <p className="text-sm text-muted">{run.status === "failed" ? "None: the run failed." : "None linked to this run."}</p>
            ) : (
              <ul className="space-y-2">
                {run.captions.map((c) => (
                  <li key={c.id} className="rounded-[16px] bg-background p-3 text-sm ring-1 ring-line">
                    <p>{c.text}</p>
                    <div className="mt-1">
                      <Score score={c.score} up={c.upvotes} down={c.downvotes} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
