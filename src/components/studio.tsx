// Small shared pieces for the AI Studio pages.

export function StatusPill({ status }: { status: "running" | "succeeded" | "failed" | "ok" | "error" }) {
  const style = {
    succeeded: "bg-powder text-human-ink",
    ok: "bg-powder text-human-ink",
    failed: "bg-[#ffede6] text-down-ink",
    error: "bg-[#ffede6] text-down-ink",
    running: "bg-butter text-butter-ink",
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full bg-current ${status === "running" ? "animate-pulse" : ""}`} />
      {status}
    </span>
  );
}

export function seconds(ms: number | null) {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}
