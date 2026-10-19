const TIME_ZONE = "America/New_York";

export function formatNumber(n: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Number(n ?? 0));
}

export function formatCompact(n: number | null | undefined) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    Number(n ?? 0)
  );
}

export function formatPercent(part: number, whole: number) {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

// "YYYY-MM-DD" day keys from the database are calendar days, not instants.
export function formatDay(day: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(`${day}T00:00:00Z`)
  );
}

export function timeAgo(value: string) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}
