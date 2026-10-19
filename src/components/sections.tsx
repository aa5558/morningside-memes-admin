import Link from "next/link";
import { CompareBars, SplitBar } from "@/components/charts";
import { AuthorBadge, EmptyState, Score, Thumb } from "@/components/ui";
import { imageUrl, type AuditRow, type CaptionHighlight, type DashboardStats } from "@/lib/admin-data";
import { formatNumber, timeAgo } from "@/lib/format";

export function HumanVsAi({ stats, detailed = false }: { stats: DashboardStats["human_vs_ai"]; detailed?: boolean }) {
  const decided = stats.human_wins + stats.ai_wins;
  const ties = stats.battles - decided;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-[18px] bg-powder p-3">
          <p className="tabular display text-3xl text-human-ink">{formatNumber(stats.human_wins)}</p>
          <p className="text-xs text-muted">Human wins</p>
        </div>
        <div className="rounded-[18px] bg-background p-3 ring-1 ring-line">
          <p className="tabular display text-3xl text-muted">{formatNumber(ties)}</p>
          <p className="text-xs text-muted">Undecided</p>
        </div>
        <div className="rounded-[18px] bg-[#ffe8f3] p-3">
          <p className="tabular display text-3xl text-ai-ink">{formatNumber(stats.ai_wins)}</p>
          <p className="text-xs text-muted">Gemini wins</p>
        </div>
      </div>
      <p className="-mt-2 text-xs text-subtle">
        {formatNumber(stats.battles)} battles: photos with at least one human caption. The side with the
        single highest-scoring caption (above 0) wins, same rule as the main app&apos;s scoreboard.
      </p>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Share of all votes</p>
        <SplitBar
          left={{ label: "Human", value: Number(stats.human_votes), color: "var(--series-human)" }}
          right={{ label: "Gemini", value: Number(stats.ai_votes), color: "var(--series-ai)" }}
        />
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Share of upvotes</p>
        <SplitBar
          left={{ label: "Human", value: Number(stats.human_upvotes), color: "var(--series-human)" }}
          right={{ label: "Gemini", value: Number(stats.ai_upvotes), color: "var(--series-ai)" }}
        />
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Average caption score</p>
        <CompareBars
          height={detailed ? 170 : 96}
          rows={[
            { label: "Human", value: Number(stats.human_avg_score ?? 0), color: "var(--series-human)" },
            { label: "Gemini", value: Number(stats.ai_avg_score ?? 0), color: "var(--series-ai)" },
            ...(detailed
              ? [
                  { label: "Human (voted)", value: Number(stats.human_avg_score_voted ?? 0), color: "var(--series-human)" },
                  { label: "Gemini (voted)", value: Number(stats.ai_avg_score_voted ?? 0), color: "var(--series-ai)" },
                ]
              : []),
          ]}
        />
        {detailed && (
          <p className="mt-1 text-xs text-subtle">
            Score = upvotes − downvotes. &quot;Voted&quot; averages only captions with at least one vote, since
            Gemini writes four captions per photo and many never get voted on.
          </p>
        )}
      </div>
    </div>
  );
}

export function CaptionList({ captions, empty }: { captions: CaptionHighlight[]; empty: string }) {
  if (!captions.length) return <EmptyState title={empty}>Captions appear here once they receive votes.</EmptyState>;
  return (
    <ol className="divide-y divide-line">
      {captions.map((c, i) => (
        <li key={c.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span className="tabular w-5 pt-0.5 text-right text-xs font-semibold text-subtle">{i + 1}</span>
          <Link href={`/media/${c.generation_id}`} className="shrink-0">
            <Thumb src={imageUrl(c.image_path)} alt="" className="h-10 w-10" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/media/${c.generation_id}`} className="line-clamp-2 text-sm hover:underline">
              “{c.text}”
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              {c.author_type && <AuthorBadge type={c.author_type} />}
              {c.author_name && <span>{c.author_name}</span>}
              {c.vibe && <span>voice: {c.vibe}</span>}
            </div>
          </div>
          <Score score={c.score} up={c.upvotes} down={c.downvotes} />
        </li>
      ))}
    </ol>
  );
}

const ACTIVITY_ICON = { photo: "📸", caption: "✍️", upvote: "▲", downvote: "▼" } as const;
const ACTIVITY_VERB = {
  photo: "posted a photo",
  caption: "wrote a caption",
  upvote: "upvoted",
  downvote: "downvoted",
} as const;

export function RecentActivity({ items }: { items: DashboardStats["recent_activity"] }) {
  if (!items.length) return <EmptyState title="No activity yet" />;
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span
            aria-hidden
            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
              item.kind === "upvote"
                ? "bg-powder text-human-ink"
                : item.kind === "downvote"
                  ? "bg-[#ffede6] text-down-ink"
                  : "bg-powder"
            }`}
          >
            {ACTIVITY_ICON[item.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <p>
              <span className="font-medium">{item.who}</span>{" "}
              <span className="text-muted">{ACTIVITY_VERB[item.kind]}</span>
            </p>
            {item.what && (
              <Link href={`/media/${item.generation_id}`} className="line-clamp-1 text-xs text-muted hover:underline">
                {item.what}
              </Link>
            )}
          </div>
          <time className="shrink-0 text-xs text-subtle" dateTime={item.happened_at}>
            {timeAgo(item.happened_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  create_post: "created a post",
  add_ai_captions: "generated AI captions",
  edit_caption: "edited a caption",
  edit_post: "edited a post's context",
  delete_caption: "deleted a caption",
  delete_post: "deleted a post",
};

export function auditLabel(action: string) {
  return AUDIT_LABEL[action] ?? action.replace(/_/g, " ");
}

export function auditLink(row: Pick<AuditRow, "action" | "target_type" | "target_id" | "details">) {
  if (row.action === "delete_post") return null;
  const generationId =
    row.target_type === "generation" ? row.target_id : (row.details.generation_id as string | undefined);
  return generationId ? `/media/${generationId}` : null;
}

export function AuditList({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <EmptyState title="No admin changes yet">Edits and deletions made here are logged.</EmptyState>;
  return (
    <ul className="space-y-2.5 text-sm">
      {rows.map((row) => {
        const href = auditLink(row);
        return (
          <li key={row.id} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{row.admin_name ?? "Deleted admin"}</span>{" "}
              {href ? (
                <Link href={href} className="text-muted hover:underline">
                  {auditLabel(row.action)}
                </Link>
              ) : (
                <span className="text-muted">{auditLabel(row.action)}</span>
              )}
            </span>
            <time className="shrink-0 text-xs text-subtle" dateTime={row.created_at}>
              {timeAgo(row.created_at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
