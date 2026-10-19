import type { Metadata } from "next";
import Link from "next/link";
import { TrendChart } from "@/components/charts";
import { CaptionList, HumanVsAi } from "@/components/sections";
import { Avatar, Card, EmptyState, PageHeader, RangeTabs, Thumb } from "@/components/ui";
import { getDashboardStats, imageUrl } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import { oneOf } from "@/lib/validate";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage(props: PageProps<"/analytics">) {
  const { supabase } = await requireAdmin("/analytics");
  const searchParams = await props.searchParams;
  const days = Number(oneOf(searchParams.days, ["7", "30", "90"] as const, "30"));

  const stats = await getDashboardStats(supabase, days);
  const daily = stats.daily;
  const peak = daily.reduce((best, d) => (d.active_users > best.active_users ? d : best), daily[0]);
  const avgActive = daily.length ? daily.reduce((sum, d) => sum + d.active_users, 0) / daily.length : 0;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Engagement trends for the last ${days} days, plus all-time leaderboards. Every number is computed live from the database.`}
        actions={<RangeTabs days={days} base="/analytics" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card
          title="Daily active users"
          description={`Avg ${avgActive.toFixed(1)}/day · peak ${formatNumber(peak?.active_users ?? 0)}${
            peak?.active_users ? ` on ${formatDate(`${peak.day}T12:00:00Z`)}` : ""
          }`}
        >
          <TrendChart data={daily} series={[{ key: "active_users", label: "Active users", color: "var(--series-1)" }]} />
        </Card>
        <Card title="New users over time" description={`${formatNumber(stats.period.new_users)} sign-ups in ${days} days`}>
          <TrendChart kind="bar" data={daily} series={[{ key: "new_users", label: "New users", color: "var(--series-1)" }]} />
        </Card>
        <Card title="Posts created per day" description={`${formatNumber(stats.period.photos)} photos · ${formatNumber(stats.period.human_captions)} human captions`}>
          <TrendChart
            kind="bar"
            data={daily}
            series={[{ key: "photos", label: "Photos", color: "var(--series-1)" }]}
          />
        </Card>
        <Card title="Votes per day" description={`${formatNumber(stats.period.votes)} votes in ${days} days`}>
          <TrendChart
            kind="bar"
            stacked
            data={daily}
            series={[
              { key: "upvotes", label: "▲ Upvotes", color: "var(--series-up)" },
              { key: "downvotes", label: "▼ Downvotes", color: "var(--series-down)" },
            ]}
          />
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Humans vs. Gemini</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Head to head" description="All time">
          <HumanVsAi stats={stats.human_vs_ai} detailed />
        </Card>
        <Card title="Top human captions" description="By score">
          <CaptionList captions={stats.top_human_captions} empty="No voted human captions yet" />
        </Card>
        <Card title="Top Gemini captions" description="By score">
          <CaptionList captions={stats.top_ai_captions} empty="No voted Gemini captions yet" />
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Leaderboards</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Most active users" description="Photos + human captions + votes, all time" bodyClassName="p-0">
          {stats.active_users.length ? (
            <ul className="divide-y divide-line">
              {stats.active_users.map((u, i) => (
                <li key={u.id}>
                  <Link href={`/users/${u.id}`} className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-background">
                    <span className="tabular w-4 text-right text-xs font-semibold text-subtle">{i + 1}</span>
                    <Avatar src={u.avatar_url} name={u.name} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.name}</span>
                    <span className="tabular flex gap-3 text-right text-xs text-muted">
                      <span title="Photos"><span className="font-semibold text-foreground">{u.photos}</span> photos</span>
                      <span title="Human captions"><span className="font-semibold text-foreground">{u.captions}</span> capt.</span>
                      <span title="Votes cast"><span className="font-semibold text-foreground">{u.votes}</span> votes</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyState title="No activity yet" />
            </div>
          )}
        </Card>
        <Card title="Most popular posts" description="Most votes across all captions" bodyClassName="p-0">
          {stats.popular_posts.length ? (
            <ul className="divide-y divide-line">
              {stats.popular_posts.map((p) => (
                <li key={p.id}>
                  <Link href={`/media/${p.id}`} className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-background">
                    <Thumb src={imageUrl(p.image_path)} alt="" className="h-10 w-10" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.context || p.daily_prompt || "Untitled post"}</span>
                      <span className="block truncate text-xs text-muted">
                        {p.owner_name} · {formatDate(p.created_at)}
                      </span>
                    </span>
                    <span className="tabular text-right text-xs text-muted">
                      <span className="block text-sm font-semibold text-foreground">{formatNumber(p.votes)}</span>
                      votes
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyState title="No voted posts yet" />
            </div>
          )}
        </Card>
        <Card title="Highest-rated captions" description="Human or Gemini">
          <CaptionList captions={stats.top_captions.slice(0, 6)} empty="No voted captions yet" />
        </Card>
      </div>

      <Card className="mt-8" title="How these numbers are calculated">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>
            <strong className="text-foreground">Daily active users</strong> counts distinct users who posted a photo,
            wrote a caption, or cast/changed a vote that day. The app doesn&apos;t record page views or sign-ins per
            day (Supabase keeps only each user&apos;s <em>last</em> sign-in), so people who only browsed aren&apos;t
            counted.
          </li>
          <li>
            <strong className="text-foreground">Votes per day</strong> uses when each vote was first cast. If someone
            later flips a vote, only its current direction is stored, so earlier days show today&apos;s direction.
          </li>
          <li>
            <strong className="text-foreground">AI captions</strong> are attributed to the photo&apos;s poster in the
            database; they&apos;re counted separately from human captions everywhere here.
          </li>
          <li>Days are New York calendar days, matching the main app&apos;s daily challenge.</li>
        </ul>
      </Card>
    </>
  );
}
