import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthorType } from "@/lib/admin-data";
import { formatNumber } from "@/lib/format";

const CARD_SHADOW = "shadow-[0_1px_2px_rgba(22,38,61,0.04),0_16px_36px_-24px_rgba(22,38,61,0.18)]";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">admin console</p>
        <h1 className="display mt-1.5 text-4xl text-ink sm:text-5xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  className = "",
  bodyClassName = "p-5",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`min-w-0 rounded-[26px] border border-line bg-surface ${CARD_SHADOW} ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pb-1 pt-5">
          <div>
            {title && <h2 className="display text-lg text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number | string;
  hint?: ReactNode;
  accent?: "human" | "ai" | "up" | "down";
}) {
  const dot = {
    human: "bg-human",
    ai: "bg-ai",
    up: "bg-up",
    down: "bg-down",
  } as const;
  return (
    <div className={`relative flex min-w-0 flex-col justify-between gap-3 overflow-hidden rounded-[24px] border border-line bg-surface p-4 ${CARD_SHADOW}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {accent && <span aria-hidden className={`h-2 w-2 rounded-full ${dot[accent]}`} />}
        {label}
      </p>
      <div>
        <p className="display text-[2rem] text-ink">{typeof value === "number" ? formatNumber(value) : value}</p>
        {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
      </div>
    </div>
  );
}

export function AuthorBadge({ type }: { type: AuthorType }) {
  return type === "human" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-powder px-2 py-0.5 text-[11px] font-semibold text-human-ink">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-human" />
      Human
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#ffe8f3] px-2 py-0.5 text-[11px] font-semibold text-ai-ink">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ai" />
      Gemini
    </span>
  );
}

export function VoteBadge({ vote }: { vote: 1 | -1 }) {
  return vote === 1 ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-powder px-2 py-0.5 text-xs font-semibold text-human-ink">▲ Upvote</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#ffede6] px-2 py-0.5 text-xs font-semibold text-down-ink">▼ Downvote</span>
  );
}

export function Score({ score, up, down }: { score: number; up?: number; down?: number }) {
  const color = score > 0 ? "text-success" : score < 0 ? "text-danger" : "text-muted";
  return (
    <span className="tabular inline-flex items-baseline gap-1.5 whitespace-nowrap text-sm">
      <span className={`font-semibold ${color}`}>{score > 0 ? `+${score}` : score}</span>
      {up !== undefined && down !== undefined && (
        <span className="text-xs text-subtle">
          ▲{up} ▼{down}
        </span>
      )}
    </span>
  );
}

export function Thumb({ src, alt, className = "h-12 w-12" }: { src: string; alt: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" className={`shrink-0 rounded-[14px] bg-powder object-cover ${className}`} />
  );
}

export function Avatar({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  const style = { width: size, height: size };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={style} className="orb flex shrink-0 items-center justify-center rounded-full text-xs font-bold text-ink">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[22px] bg-background px-6 py-10 text-center ring-1 ring-line">
      <p className="display text-base text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-xs text-muted">{children}</p>}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  href,
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-muted">
      <span className="tabular">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="btn btn-ghost btn-sm">
            Previous
          </Link>
        ) : (
          <span className="btn btn-ghost btn-sm opacity-40">Previous</span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className="btn btn-ghost btn-sm">
            Next
          </Link>
        ) : (
          <span className="btn btn-ghost btn-sm opacity-40">Next</span>
        )}
      </div>
    </div>
  );
}

// Filters are a plain GET form, so every filtered view is a shareable URL
// and works without JavaScript.
export function FilterBar({ children, resetHref }: { children: ReactNode; resetHref: string }) {
  return (
    <form method="get" className={`mb-6 flex flex-wrap items-end gap-3 rounded-[26px] border border-line bg-surface p-4 ${CARD_SHADOW}`}>
      {children}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary">
          Apply
        </button>
        <Link href={resetHref} className="btn btn-ghost">
          Reset
        </Link>
      </div>
    </form>
  );
}

export const fieldClass =
  "rounded-full border border-[rgba(22,38,61,0.12)] bg-white px-4 py-2 text-sm text-ink outline-none transition placeholder:text-subtle focus:border-sky focus:ring-4 focus:ring-sky/25";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-muted">
      <span className="px-1">{label}</span>
      {children}
    </label>
  );
}

export function RangeTabs({ days, base }: { days: number; base: string }) {
  return (
    <div role="tablist" aria-label="Date range" className="inline-flex rounded-full bg-powder p-1 text-sm">
      {[7, 30, 90].map((d) => (
        <Link
          key={d}
          role="tab"
          aria-selected={d === days}
          href={`${base}?days=${d}`}
          className={`rounded-full px-3.5 py-1.5 font-semibold transition ${
            d === days ? "bg-white text-ink shadow-[0_2px_8px_-2px_rgba(22,38,61,0.2)]" : "text-muted hover:text-ink"
          }`}
        >
          {d}d
        </Link>
      ))}
    </div>
  );
}
