"use client";

import { useMemo, useState, useTransition } from "react";
import { updateChainMix, type MixResult } from "./actions";

const COLORS = ["#3d8ff0", "#e5539a", "#69b5ff", "#7a5600", "#1f6fd1", "#b42d72"];

type MixChain = { id: string; name: string; weight: number; runnable: boolean };

// Sliders for each chain's share of new posts, with a live stacked bar.
// Saving is all-or-nothing and only allowed when the total is 100%.
export function MixEditor({ chains }: { chains: MixChain[] }) {
  const initial = useMemo(() => Object.fromEntries(chains.map((c) => [c.id, c.weight])), [chains]);
  const [weights, setWeights] = useState<Record<string, number>>(initial);
  const [result, setResult] = useState<MixResult | null>(null);
  const [pending, start] = useTransition();

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const dirty = chains.some((c) => weights[c.id] !== initial[c.id]);

  function set(id: string, value: number) {
    setResult(null);
    setWeights((w) => ({ ...w, [id]: Math.max(0, Math.min(100, Math.round(value))) }));
  }

  // Gives whatever is left (or over) to/from the other runnable chains.
  function balance() {
    const runnable = chains.filter((c) => c.runnable);
    if (!runnable.length) return;
    const next = { ...weights };
    let diff = 100 - total;
    for (const c of [...runnable].sort((a, b) => next[b.id] - next[a.id])) {
      const change = diff > 0 ? diff : Math.max(diff, -next[c.id]);
      next[c.id] += change;
      diff -= change;
      if (diff === 0) break;
    }
    setWeights(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <div aria-hidden className="flex h-4 overflow-hidden rounded-full bg-powder">
        {chains.map((c, i) =>
          weights[c.id] > 0 ? (
            <div key={c.id} className="h-full transition-all duration-300" style={{ width: `${(weights[c.id] / Math.max(total, 100)) * 100}%`, background: COLORS[i % COLORS.length] }} />
          ) : null
        )}
      </div>

      <ul className="flex flex-col gap-4">
        {chains.map((c, i) => (
          <li key={c.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <div className="min-w-0">
              <label htmlFor={`mix-${c.id}`} className="flex items-center gap-2 text-sm font-semibold text-ink">
                {c.name}
                {!c.runnable && <span className="rounded-full bg-[#ffede6] px-2 py-0.5 text-[10px] font-semibold text-down-ink">can&apos;t run</span>}
              </label>
              <input
                id={`mix-${c.id}`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={weights[c.id]}
                disabled={!c.runnable && weights[c.id] === 0}
                onChange={(e) => set(c.id, Number(e.target.value))}
                className="mt-1 w-full accent-[#1f6fd1]"
              />
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                aria-label={`${c.name} share in percent`}
                min={0}
                max={100}
                value={weights[c.id]}
                onChange={(e) => set(c.id, Number(e.target.value))}
                className="tabular w-16 rounded-full border border-[rgba(22,38,61,0.12)] bg-white px-3 py-1.5 text-right text-sm outline-none focus:border-sky focus:ring-4 focus:ring-sky/25"
              />
              <span className="text-sm text-muted">%</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <span className={`tabular rounded-full px-3 py-1 text-sm font-semibold ${total === 100 ? "bg-powder text-human-ink" : "bg-[#ffede6] text-down-ink"}`} aria-live="polite">
          Total {total}%
        </span>
        {total !== 100 && (
          <button type="button" onClick={balance} className="btn btn-ghost btn-sm">
            Balance to 100
          </button>
        )}
        <div className="ml-auto flex gap-2">
          {dirty && (
            <button type="button" onClick={() => { setWeights(initial); setResult(null); }} className="btn btn-ghost btn-sm">
              Reset
            </button>
          )}
          <button
            type="button"
            disabled={!dirty || total !== 100 || pending}
            onClick={() => start(async () => setResult(await updateChainMix(weights)))}
            className="btn btn-primary btn-sm"
          >
            {pending ? "Saving…" : "Save mix"}
          </button>
        </div>
      </div>
      {result && (
        <p role={result.error ? "alert" : "status"} className={`text-sm ${result.error ? "text-danger" : "text-success"}`}>
          {result.error ?? result.success}
        </p>
      )}
    </div>
  );
}
