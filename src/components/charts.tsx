"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

export type Series = { key: string; label: string; color: string };

const AXIS = { fontSize: 11, fill: "var(--subtle)" };

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(`${day}T00:00:00Z`)
  );
}

function ChartTooltip({ active, payload, label, series }: TooltipContentProps & { series: Series[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold">{dayLabel(String(label))}</p>
      {series.map((s) => {
        const item = payload.find((p) => p.dataKey === s.key);
        return (
          <p key={s.key} className="flex items-center gap-2 text-muted">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="tabular ml-auto pl-3 font-semibold text-foreground">
              {Number(item?.value ?? 0).toLocaleString("en-US")}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

// Change over time, one or more series on a single axis.
export function TrendChart({
  data,
  series,
  kind = "area",
  stacked = false,
  height = 240,
}: {
  data: Record<string, string | number>[];
  series: Series[];
  kind?: "area" | "bar";
  stacked?: boolean;
  height?: number;
}) {
  const tickInterval = data.length > 40 ? Math.ceil(data.length / 8) : data.length > 14 ? 3 : 0;
  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: -16 },
    accessibilityLayer: true,
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--grid)" />
      <XAxis
        dataKey="day"
        tickFormatter={dayLabel}
        tick={AXIS}
        tickLine={false}
        axisLine={{ stroke: "var(--grid)" }}
        interval={tickInterval}
        minTickGap={8}
      />
      <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={44} />
      <Tooltip
        cursor={kind === "bar" ? { fill: "var(--grid)", opacity: 0.5 } : { stroke: "var(--subtle)", strokeWidth: 1 }}
        content={(props) => <ChartTooltip {...(props as TooltipContentProps)} series={series} />}
      />
    </>
  );

  return (
    <div>
      <Legend series={series} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart {...common} barCategoryGap="20%">
              {axes}
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  stackId={stacked ? "stack" : undefined}
                  stroke="var(--surface)"
                  strokeWidth={stacked ? 1 : 0}
                  radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={28}
                />
              ))}
            </BarChart>
          ) : (
            <AreaChart {...common}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              {axes}
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#fill-${s.key})`}
                  stackId={stacked ? "stack" : undefined}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// One card, several metrics: tabs swap which daily series is plotted.
export function MetricExplorer({
  data,
  metrics,
}: {
  data: Record<string, string | number>[];
  metrics: { key: string; label: string; total: number; description: string; series: Series[]; kind?: "area" | "bar"; stacked?: boolean }[];
}) {
  const [active, setActive] = useState(metrics[0].key);
  const metric = metrics.find((m) => m.key === active) ?? metrics[0];
  return (
    <div>
      <div role="tablist" aria-label="Metric" className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1">
        {metrics.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={m.key === active}
            onClick={() => setActive(m.key)}
            className={`min-w-[120px] flex-1 rounded-lg border px-3 py-2 text-left transition ${
              m.key === active
                ? "border-human/50 bg-human/8 shadow-[inset_0_-2px_0_var(--series-human)]"
                : "border-line hover:bg-black/3 dark:hover:bg-white/3"
            }`}
          >
            <span className="block text-xs font-medium text-muted">{m.label}</span>
            <span className="tabular block text-lg font-semibold">{m.total.toLocaleString("en-US")}</span>
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-muted">{metric.description}</p>
      <TrendChart data={data} series={metric.series} kind={metric.kind} stacked={metric.stacked} height={300} />
    </div>
  );
}

// Part-to-whole for exactly two sides (Humans vs. Gemini). A labeled bar
// reads better than a 2-slice pie.
export function SplitBar({
  left,
  right,
  format = (n: number) => n.toLocaleString("en-US"),
}: {
  left: { label: string; value: number; color: string };
  right: { label: string; value: number; color: string };
  format?: (n: number) => string;
}) {
  const total = left.value + right.value;
  const leftPct = total ? (left.value / total) * 100 : 50;
  const [hover, setHover] = useState<"left" | "right" | null>(null);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs font-medium">
        <span style={{ color: left.color }}>
          {left.label} · {total ? `${Math.round(leftPct)}%` : "—"}
        </span>
        <span style={{ color: right.color }}>
          {total ? `${Math.round(100 - leftPct)}%` : "—"} · {right.label}
        </span>
      </div>
      <div className="relative flex h-3 gap-[2px] overflow-hidden rounded-full bg-[var(--grid)]" onMouseLeave={() => setHover(null)}>
        {total > 0 && (
          <>
            <div
              className="h-full rounded-l-full transition-opacity"
              style={{ width: `${leftPct}%`, background: left.color, opacity: hover === "right" ? 0.45 : 1 }}
              onMouseEnter={() => setHover("left")}
              title={`${left.label}: ${format(left.value)}`}
            />
            <div
              className="h-full flex-1 rounded-r-full transition-opacity"
              style={{ background: right.color, opacity: hover === "left" ? 0.45 : 1 }}
              onMouseEnter={() => setHover("right")}
              title={`${right.label}: ${format(right.value)}`}
            />
          </>
        )}
      </div>
      <div className="tabular mt-1.5 flex justify-between text-xs text-muted">
        <span>{format(left.value)}</span>
        <span>{format(right.value)}</span>
      </div>
    </div>
  );
}

// Grouped comparison of a few named values (e.g. average score by author).
export function CompareBars({
  rows,
  height = 160,
}: {
  rows: { label: string; value: number; color: string }[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals />
          <YAxis type="category" dataKey="label" tick={{ ...AXIS, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={110} />
          <Tooltip
            cursor={{ fill: "var(--grid)", opacity: 0.5 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                  <span className="font-semibold">{String(payload[0].payload.label)}</span>:{" "}
                  <span className="tabular">{Number(payload[0].value).toFixed(2)}</span>
                </div>
              ) : null
            }
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            label={{ position: "right", fontSize: 11, fill: "var(--muted)", formatter: (v: unknown) => Number(v).toFixed(2) }}
          >
            {rows.map((row) => (
              <Cell key={row.label} fill={row.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
