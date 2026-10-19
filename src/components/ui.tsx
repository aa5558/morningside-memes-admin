import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthorType } from "@/lib/admin-data";
import { formatNumber } from "@/lib/format";

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
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
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
    <section className={`min-w-0 rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(11,45,91,0.04)] ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
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
  const bar = {
    human: "bg-human",
    ai: "bg-ai",
    up: "bg-up",
    down: "bg-down",
  } as const;
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(11,45,91,0.04)]">
      {accent && <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bar[accent]}`} />}
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export function AuthorBadge({ type }: { type: AuthorType }) {
  return type === "human" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-human/12 px-2 py-0.5 text-[11px] font-semibold text-human">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-human" />
      Human
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-ai/12 px-2 py-0.5 text-[11px] font-semibold text-ai">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ai" />
      Gemini
    </span>
  );
}

export function VoteBadge({ vote }: { vote: 1 | -1 }) {
  return vote === 1 ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-up/12 px-2 py-0.5 text-xs font-semibold text-up">▲ Upvote</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-down/12 px-2 py-0.5 text-xs font-semibold text-down">▼ Downvote</span>
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
    <img src={src} alt={alt} loading="lazy" className={`shrink-0 rounded-lg bg-black/5 object-cover ${className}`} />
  );
}

export function Avatar({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  const style = { width: size, height: size };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={style} className="flex shrink-0 items-center justify-center rounded-full bg-columbia text-xs font-bold text-navy">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
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
  const btn = "rounded-lg border border-line px-3 py-1.5 text-sm font-medium";
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-muted">
      <span className="tabular">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={`${btn} hover:bg-black/5 dark:hover:bg-white/5`}>
            Previous
          </Link>
        ) : (
          <span className={`${btn} opacity-40`}>Previous</span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={`${btn} hover:bg-black/5 dark:hover:bg-white/5`}>
            Next
          </Link>
        ) : (
          <span className={`${btn} opacity-40`}>Next</span>
        )}
      </div>
    </div>
  );
}

// Filters are a plain GET form, so every filtered view is a shareable URL
// and works without JavaScript.
export function FilterBar({ children, resetHref }: { children: ReactNode; resetHref: string }) {
  return (
    <form method="get" className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
      {children}
      <div className="flex gap-2">
        <button type="submit" className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-[#123d77] dark:bg-columbia dark:text-navy">
          Apply
        </button>
        <Link href={resetHref} className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-black/5 dark:hover:bg-white/5">
          Reset
        </Link>
      </div>
    </form>
  );
}

export const fieldClass =
  "rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-human focus:ring-2 focus:ring-human/20";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

export function RangeTabs({ days, base }: { days: number; base: string }) {
  return (
    <div role="tablist" aria-label="Date range" className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
      {[7, 30, 90].map((d) => (
        <Link
          key={d}
          role="tab"
          aria-selected={d === days}
          href={`${base}?days=${d}`}
          className={`rounded-md px-3 py-1.5 font-medium ${
            d === days ? "bg-navy text-white dark:bg-columbia dark:text-navy" : "text-muted hover:text-foreground"
          }`}
        >
          {d}d
        </Link>
      ))}
    </div>
  );
}
