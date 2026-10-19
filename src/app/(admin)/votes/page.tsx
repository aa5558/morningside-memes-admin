import type { Metadata } from "next";
import Link from "next/link";
import { SplitBar, TrendChart } from "@/components/charts";
import { AuthorBadge, Card, EmptyState, Field, FilterBar, PageHeader, Pagination, StatCard, Thumb, VoteBadge, fieldClass } from "@/components/ui";
import { getUserOptions, getVoteStats, imageUrl, listVotes } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatPercent } from "@/lib/format";
import { pageNumber, param, type SearchParams } from "@/lib/validate";
import { parseVoteFilters, voteFiltersToQuery } from "@/lib/vote-filters";

export const metadata: Metadata = { title: "Votes" };

const PAGE_SIZE = 50;

// Fills in days with no votes so the trend has no misleading gaps.
function fillDays(daily: { day: string; upvotes: number; downvotes: number }[]) {
  if (daily.length < 2) return daily;
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out = [];
  for (let t = Date.parse(daily[0].day); t <= Date.parse(daily[daily.length - 1].day); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, upvotes: 0, downvotes: 0 });
  }
  return out.slice(-120);
}

export default async function VotesPage(props: PageProps<"/votes">) {
  const { supabase } = await requireAdmin("/votes");
  const sp = (await props.searchParams) as SearchParams;
  const filters = parseVoteFilters((k) => param(sp, k));
  const page = pageNumber(param(sp, "page"));
  const query = voteFiltersToQuery(filters);

  const [votes, stats, users] = await Promise.all([
    listVotes(supabase, filters, { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    getVoteStats(supabase, filters),
    getUserOptions(supabase),
  ]);

  const href = (p: number) => {
    const q = new URLSearchParams(query);
    q.set("page", String(p));
    return `/votes?${q}`;
  };
  const daily = fillDays(stats.daily);
  const type = filters.p_vote === 1 ? "up" : filters.p_vote === -1 ? "down" : "";

  return (
    <>
      <PageHeader
        title="Votes"
        description="Every vote cast in Morningside Memes. Read-only: votes can only be changed by the people who cast them."
        actions={
          <a
            href={`/api/votes/export?${query}`}
            className="btn btn-ghost"
          >
            Export CSV
          </a>
        }
      />

      <FilterBar resetHref="/votes">
        {filters.p_caption && <input type="hidden" name="caption" value={filters.p_caption} />}
        <Field label="Caption text">
          <input name="q" defaultValue={filters.p_search ?? ""} placeholder="Search…" className={`${fieldClass} w-52 max-w-full`} />
        </Field>
        <Field label="Voter">
          <select name="user" defaultValue={filters.p_user ?? ""} className={`${fieldClass} max-w-48`}>
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vote type">
          <select name="type" defaultValue={type} className={fieldClass}>
            <option value="">Up & down</option>
            <option value="up">▲ Upvotes</option>
            <option value="down">▼ Downvotes</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" name="from" defaultValue={filters.p_from ?? ""} className={fieldClass} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={filters.p_to ?? ""} className={fieldClass} />
        </Field>
      </FilterBar>

      {filters.p_caption && (
        <p className="mb-4 text-sm text-muted">
          Showing votes on one caption.{" "}
          <Link href="/votes" className="text-human hover:underline">
            Clear
          </Link>
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Votes" value={stats.total} hint={`${stats.changed} changed after casting`} />
        <StatCard label="Upvotes" value={stats.upvotes} accent="up" hint={formatPercent(stats.upvotes, stats.total)} />
        <StatCard label="Downvotes" value={stats.downvotes} accent="down" hint={formatPercent(stats.downvotes, stats.total)} />
        <StatCard label="Voters" value={stats.voters} hint={`on ${stats.captions} captions`} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Votes over time" description="By the day each vote was first cast">
          {daily.length ? (
            <TrendChart
              kind="bar"
              stacked
              data={daily}
              height={200}
              series={[
                { key: "upvotes", label: "▲ Upvotes", color: "var(--series-up)" },
                { key: "downvotes", label: "▼ Downvotes", color: "var(--series-down)" },
              ]}
            />
          ) : (
            <EmptyState title="No votes match" />
          )}
        </Card>
        <Card title="Where votes went">
          <SplitBar
            left={{ label: "Human captions", value: stats.on_human, color: "var(--series-human)" }}
            right={{ label: "Gemini captions", value: stats.on_ai, color: "var(--series-ai)" }}
          />
          <p className="mt-4 text-xs text-subtle">
            Vote totals on captions are maintained by a database trigger from these rows; admins can&apos;t edit them.
          </p>
        </Card>
      </div>

      <Card bodyClassName="p-0">
        {votes.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No votes match these filters" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Vote</th>
                  <th className="px-3 py-3 font-medium">Caption</th>
                  <th className="px-3 py-3 font-medium">Voter</th>
                  <th className="px-5 py-3 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {votes.map((v) => (
                  <tr key={`${v.voter_id}-${v.caption_id}`} className="transition hover:bg-background">
                    <td className="px-5 py-2.5">
                      <VoteBadge vote={v.vote} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <Thumb src={imageUrl(v.image_path)} alt="" className="h-9 w-9" />
                        <div className="min-w-0">
                          <Link href={`/media/${v.generation_id}`} className="line-clamp-1 hover:underline">
                            “{v.caption_text}”
                          </Link>
                          <div className="mt-0.5 flex gap-2">
                            <AuthorBadge type={v.author_type} />
                            <Link href={`/votes?caption=${v.caption_id}`} className="text-xs text-muted hover:underline">
                              all votes on this caption
                            </Link>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/users/${v.voter_id}`} className="hover:underline">
                        {v.voter_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right text-xs text-muted">
                      {formatDateTime(v.created_at)}
                      {new Date(v.updated_at).getTime() - new Date(v.created_at).getTime() > 1000 && (
                        <span className="block text-subtle">changed {formatDateTime(v.updated_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={votes[0]?.total_count ?? 0} href={href} />
    </>
  );
}
