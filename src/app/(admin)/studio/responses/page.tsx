import type { Metadata } from "next";
import Link from "next/link";
import { seconds, StatusPill } from "@/components/studio";
import { Card, EmptyState, Field, FilterBar, PageHeader, Pagination, fieldClass } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getAiStats, listResponses } from "@/lib/studio-data";
import { oneOf, pageNumber, param, textOrNull } from "@/lib/validate";

export const metadata: Metadata = { title: "LLM responses" };

const PAGE_SIZE = 30;

export default async function ResponsesPage(props: PageProps<"/studio/responses">) {
  const { supabase } = await requireAdmin("/studio/responses");
  const sp = await props.searchParams;
  const status = oneOf(param(sp, "status"), ["", "ok", "error"] as const, "");
  const search = textOrNull(param(sp, "q"));
  const stats = await getAiStats(supabase, 90);
  const modelKeys = stats.models.map((m) => m.model_key);
  const model = oneOf(param(sp, "model"), ["", ...modelKeys], "");
  const page = pageNumber(param(sp, "page"));

  const rows = await listResponses(supabase, {
    p_status: status || null,
    p_model: model || null,
    p_search: search,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const total = rows[0]?.total_count ?? 0;
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (model) q.set("model", model);
    if (search) q.set("q", search);
    if (p > 1) q.set("page", String(p));
    return `/studio/responses${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <PageHeader title="LLM responses" description="The raw output of every model call, newest first. Search inside prompts and responses." />

      {stats.models.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stats.models.map((m) => (
            <div key={m.model_key} className="rounded-[22px] border border-line bg-surface p-4">
              <p className="font-mono text-xs font-semibold text-ink">{m.model_key}</p>
              <p className="display mt-1 text-2xl">{formatNumber(m.calls)} calls</p>
              <p className="text-xs text-muted">
                {m.errors} errors · avg {seconds(m.avg_latency_ms)} · {formatNumber(m.input_tokens + m.output_tokens)} tokens (90d)
              </p>
            </div>
          ))}
        </div>
      )}

      <FilterBar resetHref="/studio/responses">
        <Field label="Search">
          <input name="q" defaultValue={search ?? ""} placeholder="text in prompt or response" className={fieldClass} />
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={status} className={fieldClass}>
            <option value="">Any</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
          </select>
        </Field>
        <Field label="Model">
          <select name="model" defaultValue={model} className={fieldClass}>
            <option value="">Any</option>
            {modelKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState title="No responses match">Model calls are logged here as soon as the caption pipeline runs.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.id} bodyClassName="p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill status={r.status} />
                <span className="rounded-full bg-background px-2 py-0.5 font-mono ring-1 ring-line">{r.model_key}</span>
                <span className="text-muted">
                  {r.chain_slug} · step {r.step_position ?? "?"} {r.step_name ? `(${r.step_name})` : ""}
                </span>
                <span className="text-subtle">
                  {seconds(r.latency_ms)} · {r.input_tokens ?? "—"} in / {r.output_tokens ?? "—"} out
                </span>
                <span className="ml-auto text-subtle">{formatDateTime(r.created_at)}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-subtle">
                <span className="font-semibold text-muted">Prompt:</span> {r.prompt_preview}
              </p>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-[14px] bg-background p-3 font-mono text-[12px] leading-relaxed text-ink ring-1 ring-line">
                {r.error_message ? `⚠ ${r.error_message}\n` : ""}
                {r.response_text ?? "(empty)"}
              </pre>
              <Link href={`/studio/requests/${r.request_id}`} className="mt-2 inline-block text-xs font-medium text-human hover:underline">
                Open the run →
              </Link>
            </Card>
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} href={href} />
    </>
  );
}
