import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatNumber, formatPercent, timeAgo } from "@/lib/format";
import { getAiStats, listChains, type Chain, type ChainStep } from "@/lib/studio-data";
import { MixEditor } from "./MixEditor";

export const metadata: Metadata = { title: "Prompt chains" };

// Highlights {{placeholders}} in a step's instructions.
function Template({ text }: { text: string }) {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-[18px] bg-[#0f1b2d] p-4 font-mono text-[12px] leading-relaxed text-[#cfe3ff]">
      {text.split(/(\{\{\s*[a-z_]+\s*\}\})/g).map((part, i) =>
        /^\{\{/.test(part) ? (
          <mark key={i} className="rounded bg-[#69b5ff]/25 px-1 text-[#9fd0ff]">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </pre>
  );
}

function StepNode({ step }: { step: ChainStep }) {
  const healthy = step.model_active && step.provider_active && step.provider_adapter === "gemini";
  return (
    <div className="relative flex min-w-[200px] flex-1 flex-col gap-2 rounded-[20px] bg-white p-3.5 ring-1 ring-line">
      <div className="flex items-center gap-2">
        <span className="orb flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-ink">{step.position}</span>
        <span className="text-sm font-semibold text-ink">{step.name}</span>
      </div>
      {step.purpose && <p className="text-xs leading-snug text-muted">{step.purpose}</p>}
      <div className="mt-auto flex flex-wrap gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${step.kind === "caption" ? "bg-[#ffe8f3] text-ai-ink" : "bg-powder text-human-ink"}`}>
          {step.kind === "caption" ? "→ JSON captions" : "→ notes"}
        </span>
        <span
          title={healthy ? `${step.provider_name}` : "This model or its provider is inactive or not callable"}
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${healthy ? "bg-background text-ink ring-1 ring-line" : "bg-[#ffede6] text-down-ink"}`}
        >
          {step.model_key}
        </span>
        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted ring-1 ring-line">
          temp {step.temperature ?? step.model_temperature}
          {step.temperature === null && " (model)"}
        </span>
        {step.include_image && <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted ring-1 ring-line">👁 sees photo</span>}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center text-subtle max-md:rotate-90">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M4 12h15M14 7l5 5-5 5" />
      </svg>
    </span>
  );
}

function ChainCard({ chain }: { chain: Chain }) {
  const { runs, caption_stats: cs, battles } = chain;
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {chain.name}
          <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[11px] font-medium text-muted ring-1 ring-line">{chain.slug}</span>
        </span>
      }
      description={chain.description ?? undefined}
      action={
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="display text-2xl text-ink">{chain.weight}%</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chain.runnable ? "bg-powder text-human-ink" : "bg-[#ffede6] text-down-ink"}`}>
            {chain.runnable ? "● runnable" : "● can't run"}
          </span>
        </span>
      }
    >
      {/* Pipeline */}
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-stretch">
        <div className="flex shrink-0 flex-col justify-center rounded-[20px] bg-ice/60 px-4 py-3 text-xs text-ink md:w-32">
          <span className="text-lg" aria-hidden>📷</span>
          <span className="font-semibold">Photo + brief</span>
          <span className="text-muted">voice, context, terms, examples</span>
        </div>
        {chain.steps.map((step) => (
          <Fragment key={step.id}>
            <Arrow />
            <StepNode step={step} />
          </Fragment>
        ))}
        <Arrow />
        <div className="flex shrink-0 flex-col justify-center rounded-[20px] bg-[#ffe8f3] px-4 py-3 text-xs text-ink md:w-28">
          <span className="text-lg" aria-hidden>💬</span>
          <span className="font-semibold">4 captions</span>
          <span className="text-muted">into the battle</span>
        </div>
      </div>

      {/* Performance */}
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Runs", formatNumber(runs.requests), runs.last_run ? `last ${timeAgo(runs.last_run)}` : "never run"],
          ["Success rate", formatPercent(runs.succeeded, runs.requests), `${formatNumber(runs.failed)} failed${runs.avg_seconds ? ` · ~${runs.avg_seconds}s` : ""}`],
          ["Avg caption score", cs.avg_score === null ? "—" : (cs.avg_score > 0 ? "+" : "") + cs.avg_score, `${formatNumber(cs.voted)} of ${formatNumber(cs.captions)} captions voted`],
          ["vs. humans", battles.battles ? `${battles.ai_wins}–${battles.human_wins}` : "—", battles.battles ? `AI–human wins in ${battles.battles} battles` : "no human challengers yet"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-[18px] bg-background px-3 py-2.5 ring-1 ring-line">
            <dt className="text-[11px] font-medium text-muted">{label}</dt>
            <dd className="display text-xl text-ink">{value}</dd>
            <dd className="text-[11px] text-subtle">{hint}</dd>
          </div>
        ))}
      </dl>

      {/* Templates */}
      <div className="mt-4 flex flex-col gap-2">
        {chain.steps.map((step) => (
          <details key={step.id} className="group rounded-[18px] ring-1 ring-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[18px] px-4 py-2.5 text-sm font-medium hover:bg-background">
              <span>
                Step {step.position} prompt template <span className="text-muted">· {step.name}</span>
              </span>
              <span className="text-xs text-muted group-open:hidden">show</span>
              <span className="hidden text-xs text-muted group-open:inline">hide</span>
            </summary>
            <div className="px-3 pb-3">
              <Template text={step.instructions} />
            </div>
          </details>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Link href={`/studio/requests?chain=${chain.id}`} className="text-xs font-medium text-human hover:underline">
          See this chain&apos;s runs →
        </Link>
      </div>
    </Card>
  );
}

export default async function StudioPage() {
  const { supabase } = await requireAdmin("/studio");
  const [chains, stats] = await Promise.all([listChains(supabase), getAiStats(supabase, 30)]);

  return (
    <>
      <PageHeader
        title="Prompt chains"
        description="How a photo becomes four AI captions. Every post runs one chain, picked by the mix below; each step is one model call, logged with its prompt, response, latency, and tokens."
        actions={
          <Link href="/studio/requests" className="btn btn-ghost">
            Generation runs →
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Runs (30d)" value={stats.requests} hint={`${formatNumber(stats.failed)} failed · ${formatNumber(stats.running)} running`} />
        <StatCard label="Success rate" value={formatPercent(stats.succeeded, stats.requests)} hint="runs that produced captions" />
        <StatCard label="Model calls" value={stats.calls} hint={`${formatNumber(stats.call_errors)} errors`} />
        <StatCard
          label="Avg call latency"
          value={stats.avg_latency_ms === null ? "—" : `${(stats.avg_latency_ms / 1000).toFixed(1)}s`}
          hint={stats.p95_latency_ms === null ? "no calls yet" : `p95 ${(stats.p95_latency_ms / 1000).toFixed(1)}s`}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          {chains.length === 0 ? <EmptyState title="No prompt chains">Run the AI Studio migration to add the default chains.</EmptyState> : chains.map((chain) => <ChainCard key={chain.id} chain={chain} />)}
        </div>
        <div className="flex flex-col gap-5 xl:sticky xl:top-6 xl:self-start">
          <Card title="The mix" description="Share of new posts each chain captions. Must total 100%.">
            <MixEditor chains={chains.map((c) => ({ id: c.id, name: c.name, weight: c.weight, runnable: c.runnable }))} />
          </Card>
          <Card title="Template variables">
            <dl className="space-y-2 text-xs">
              {[
                ["{{voice}}", "the caption voice the poster picked"],
                ["{{context}}", "the poster's context line, if any"],
                ["{{daily_prompt}}", "today's challenge prompt"],
                ["{{image_prompt}}", "the description, for AI-generated photos"],
                ["{{terms}}", "up to 20 active terms for that voice"],
                ["{{examples}}", "up to 4 active examples for that voice"],
                ["{{previous}}", "the previous step's output"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="shrink-0 font-mono font-semibold text-human-ink">{k}</dt>
                  <dd className="text-muted">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-subtle">
              Chains and steps are read-only here: they&apos;re versioned in the database migration so every caption stays traceable to the exact prompt that wrote it.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
