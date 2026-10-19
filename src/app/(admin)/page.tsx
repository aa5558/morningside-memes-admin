import Link from "next/link";
import { MetricExplorer } from "@/components/charts";
import { AuditList, CaptionList, HumanVsAi, RecentActivity } from "@/components/sections";
import { Card, PageHeader, RangeTabs, StatCard } from "@/components/ui";
import { getDashboardStats, listAudit } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatNumber, formatPercent } from "@/lib/format";
import { oneOf } from "@/lib/validate";

export default async function OverviewPage(props: PageProps<"/">) {
  const { supabase } = await requireAdmin("/");
  const searchParams = await props.searchParams;
  const days = Number(oneOf(searchParams.days, ["7", "30", "90"] as const, "30"));

  const [stats, audit] = await Promise.all([getDashboardStats(supabase, days), listAudit(supabase, 6)]);
  const { totals, period } = stats;
  const daily = stats.daily.map((d) => ({ ...d, votes: d.upvotes + d.downvotes }));

  return (
    <>
      <PageHeader
        title="Overview"
        description={`How Morningside Memes is doing. Totals are all-time; trends cover the last ${days} days (New York time).`}
        actions={<RangeTabs days={days} base="/" />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        <StatCard label="Registered users" value={totals.users} hint={`+${formatNumber(period.new_users)} in ${days}d`} />
        <StatCard label="Photos uploaded" value={totals.photos} hint={`+${formatNumber(period.photos)} in ${days}d`} />
        <StatCard label="AI captions" value={totals.ai_captions} accent="ai" hint="written by Gemini" />
        <StatCard label="Human captions" value={totals.human_captions} accent="human" hint={`+${formatNumber(period.human_captions)} in ${days}d`} />
        <StatCard label="Total votes" value={totals.votes} hint={`+${formatNumber(period.votes)} in ${days}d`} />
        <StatCard label="Upvotes" value={totals.upvotes} accent="up" hint={`${formatPercent(totals.upvotes, totals.votes)} of votes`} />
        <StatCard label="Downvotes" value={totals.downvotes} accent="down" hint={`${formatPercent(totals.downvotes, totals.votes)} of votes`} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Activity"
          description={`Last ${days} days`}
          action={
            <Link href={`/analytics?days=${days}`} className="text-xs font-medium text-human hover:underline">
              Full analytics →
            </Link>
          }
        >
          <MetricExplorer
            data={daily}
            metrics={[
              {
                key: "active",
                label: "Active users",
                total: period.active_users,
                description: "Distinct users who posted, captioned, or voted each day.",
                series: [{ key: "active_users", label: "Active users", color: "var(--series-1)" }],
              },
              {
                key: "votes",
                label: "Votes",
                total: period.votes,
                description: "Votes cast per day, split into upvotes and downvotes.",
                kind: "bar",
                stacked: true,
                series: [
                  { key: "upvotes", label: "▲ Upvotes", color: "var(--series-up)" },
                  { key: "downvotes", label: "▼ Downvotes", color: "var(--series-down)" },
                ],
              },
              {
                key: "photos",
                label: "Photos",
                total: period.photos,
                description: "Photos posted per day.",
                kind: "bar",
                series: [{ key: "photos", label: "Photos", color: "var(--series-1)" }],
              },
              {
                key: "new_users",
                label: "New users",
                total: period.new_users,
                description: "Accounts created per day.",
                kind: "bar",
                series: [{ key: "new_users", label: "New users", color: "var(--series-1)" }],
              },
            ]}
          />
        </Card>

        <Card title="Humans vs. Gemini" description="All-time leaderboard">
          <HumanVsAi stats={stats.human_vs_ai} />
        </Card>

        <Card className="xl:col-span-2" title="Top captions" description="Highest score, all time">
          <CaptionList captions={stats.top_captions} empty="No voted captions yet" />
        </Card>

        <div className="space-y-5">
          <Card title="Recent activity">
            <RecentActivity items={stats.recent_activity.slice(0, 8)} />
          </Card>
          <Card
            title="Admin changes"
            action={
              <Link href="/audit" className="text-xs font-medium text-human hover:underline">
                Audit log →
              </Link>
            }
          >
            <AuditList rows={audit} />
          </Card>
        </div>
      </div>
    </>
  );
}
