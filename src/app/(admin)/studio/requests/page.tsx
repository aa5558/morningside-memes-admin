import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Field, FilterBar, PageHeader, Pagination, Thumb, fieldClass } from "@/components/ui";
import { imageUrl } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { listChains, listRequests } from "@/lib/studio-data";
import { oneOf, pageNumber, param, uuidOrNull } from "@/lib/validate";
import { seconds, StatusPill } from "@/components/studio";

export const metadata: Metadata = { title: "Generation runs" };

const PAGE_SIZE = 30;

export default async function RequestsPage(props: PageProps<"/studio/requests">) {
  const { supabase } = await requireAdmin("/studio/requests");
  const sp = await props.searchParams;
  const status = oneOf(param(sp, "status"), ["", "running", "succeeded", "failed"] as const, "");
  const source = oneOf(param(sp, "source"), ["", "main_app", "admin"] as const, "");
  const chain = uuidOrNull(param(sp, "chain"));
  const page = pageNumber(param(sp, "page"));

  const [rows, chains] = await Promise.all([
    listRequests(supabase, {
      p_status: status || null,
      p_chain: chain,
      p_source: source || null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    listChains(supabase),
  ]);
  const total = rows[0]?.total_count ?? 0;
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (source) q.set("source", source);
    if (chain) q.set("chain", chain);
    if (p > 1) q.set("page", String(p));
    return `/studio/requests${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Generation runs"
        description="Every attempt to caption a photo, from the main app and from this console, with the chain that ran it. Open one to see each model call."
      />
      <FilterBar resetHref="/studio/requests">
        <Field label="Status">
          <select name="status" defaultValue={status} className={fieldClass}>
            <option value="">Any</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </Field>
        <Field label="Chain">
          <select name="chain" defaultValue={chain ?? ""} className={fieldClass}>
            <option value="">Any</option>
            {chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source">
          <select name="source" defaultValue={source} className={fieldClass}>
            <option value="">Any</option>
            <option value="main_app">Main app</option>
            <option value="admin">Admin console</option>
          </select>
        </Field>
      </FilterBar>

      <Card bodyClassName="p-0">
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No runs match">Runs appear here as soon as someone posts a photo with the AI Studio migration applied.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Run</th>
                  <th className="px-3 py-3 font-medium">Chain</th>
                  <th className="px-3 py-3 font-medium">Who</th>
                  <th className="px-3 py-3 text-right font-medium">Calls</th>
                  <th className="px-3 py-3 text-right font-medium">Tokens</th>
                  <th className="px-3 py-3 text-right font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="transition hover:bg-background">
                    <td className="px-5 py-2.5">
                      <Link href={`/studio/requests/${r.id}`} className="flex items-center gap-3">
                        {r.image_path ? <Thumb src={imageUrl(r.image_path)} alt="" className="h-10 w-10" /> : <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-powder text-xs text-muted">—</span>}
                        <span>
                          <StatusPill status={r.status} />
                          <span className="mt-0.5 block text-xs text-subtle" title={formatDateTime(r.started_at)}>
                            {timeAgo(r.started_at)}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{r.chain_name ?? r.chain_slug}</span>
                      <span className="block text-xs text-subtle">{r.vibe ?? ""}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.user_name ?? "Deleted user"}
                      <span className="block text-xs text-subtle">{r.source === "admin" ? "admin console" : "main app"}</span>
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{r.calls}</td>
                    <td className="tabular px-3 py-2.5 text-right">{r.tokens ? formatNumber(r.tokens) : "—"}</td>
                    <td className="tabular px-3 py-2.5 text-right">{seconds(r.duration_ms)}</td>
                    <td className="max-w-xs px-5 py-2.5 text-xs">
                      {r.status === "failed" ? <span className="line-clamp-2 text-danger">{r.error_message}</span> : r.status === "succeeded" ? `${r.captions} captions` : "in progress"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} href={href} />
    </>
  );
}
