import "server-only";

import sharp from "sharp";

// Reliable Gemini calls, shared by AFTERTHOUGHT, Morningside Memes and the
// admin app (keep the three copies identical).
//
// Why: on Gemini's free tier Google sheds load per model. Measured from
// Vercel on 2026-11-03: gemini-flash-latest and gemini-3.1-flash-lite
// answered "503 high demand" (or never answered) while gemini-3.5-flash-lite
// answered in ~1s. Which model has capacity changes minute to minute.
//
// How: one call tries the step's own model first, then other callable
// Gemini models, each attempt with a short timeout. A model that answers 503
// or hangs is benched for a while (per server instance) so the next request
// goes straight to a healthy one; 429 (quota) and 404 (retired) take a model
// out for longer. Several passes with backoff run inside a fixed time budget.
// Every attempt is returned so the caller can log exactly what happened.

export type ModelOption = { id: string; model_key: string; api_key_env_var: string; supports_vision: boolean };

export type Outcome = "ok" | "busy" | "timeout" | "network" | "quota" | "gone" | "rejected" | "bad_output";
export type Attempt = { model: string; outcome: Outcome; http: number | null; ms: number; error?: string };

export type GenerateResult = {
  ok: boolean;
  text: string;
  model: ModelOption | null;
  attempts: Attempt[];
  httpStatus: number;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  // Why it failed, in one word, when it did.
  failure: "quota" | "busy" | "rejected" | "bad_output" | null;
};

const KEY_VAR = /^[A-Z][A-Z0-9_]{0,50}_API_KEY$/;
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
// Overridable only from server env, so tests can point at a local stand-in.
const GEMINI_BASE = process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta/models";

// Healthy answers came back in 1-20s in every measurement; a request that
// hasn't answered in 20s is treated as hung and abandoned.
const ATTEMPT_TIMEOUT_MS = 20_000;
const MIN_ATTEMPT_MS = 6_000;
const MAX_PASSES = 3;
const BENCH_MS: Partial<Record<Outcome, number>> = {
  busy: 90_000,
  timeout: 90_000,
  network: 30_000,
  quota: 15 * 60_000,
  gone: 60 * 60_000,
};
// Fallback order when the step's own model can't answer (fastest and most
// available first, per the measurements above). Models not listed come last.
const PREFERENCE = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-flash-latest"];

// model_key -> benched until (ms). Lives as long as the server instance.
const bench = new Map<string, number>();

function log(event: string, data: Record<string, unknown>) {
  // One JSON line per event, for Vercel's runtime logs.
  console.warn(JSON.stringify({ event, ...data }));
}

// The models to try, in order: the step's model, then the other callable
// models that can do the job, healthy ones first.
export function candidatesFor(primary: ModelOption | null, options: ModelOption[], needsVision: boolean) {
  const rank = (m: ModelOption) => {
    const i = PREFERENCE.indexOf(m.model_key);
    return i === -1 ? PREFERENCE.length : i;
  };
  const others = options
    .filter((o) => o.id !== primary?.id && o.model_key !== primary?.model_key && (!needsVision || o.supports_vision))
    .sort((a, b) => rank(a) - rank(b));
  const list = primary ? [primary, ...others] : others;
  const now = Date.now();
  const healthy = (m: ModelOption) => (bench.get(m.model_key) ?? 0) <= now;
  return [...list.filter(healthy), ...list.filter((m) => !healthy(m))];
}

// Shrinks a photo for the model (longest side 1024px, EXIF rotation
// applied). Measured: a 6.3 MB photo took 13.2s; the same image at 1024px
// took 7.3s for the same answer. Falls back to the original on any error.
export async function prepareImage(bytes: ArrayBuffer, mimeType: string) {
  try {
    const out = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: new Uint8Array(out).buffer as ArrayBuffer, mimeType: "image/jpeg" };
  } catch {
    return { bytes, mimeType };
  }
}

type GeminiBody = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generate({
  candidates,
  parts,
  generationConfig,
  validate,
  budgetMs,
  label,
}: {
  candidates: ModelOption[];
  parts: object[];
  generationConfig: Record<string, unknown>;
  // Whether a 200 answer is usable (e.g. parses as a list of captions).
  validate: (text: string) => boolean;
  budgetMs: number;
  // Identifies the call in logs, e.g. "studio run 1234 star 2".
  label: string;
}): Promise<GenerateResult> {
  const started = Date.now();
  const deadline = started + budgetMs;
  const attempts: Attempt[] = [];
  const excluded = new Set<string>();
  const body = JSON.stringify({ contents: [{ parts }], generationConfig });

  const result = (partial: Partial<GenerateResult>): GenerateResult => ({
    ok: false, text: "", model: null, attempts, httpStatus: 0, latencyMs: Date.now() - started,
    inputTokens: null, outputTokens: null, error: null, failure: null, ...partial,
  });
  const note = (model: ModelOption, outcome: Outcome, http: number | null, ms: number, error?: string) => {
    attempts.push({ model: model.model_key, outcome, http, ms, ...(error ? { error: error.slice(0, 160) } : {}) });
    const benchFor = BENCH_MS[outcome];
    if (benchFor) bench.set(model.model_key, Date.now() + benchFor);
    if (outcome === "quota" || outcome === "gone" || outcome === "rejected") excluded.add(model.id);
    if (outcome !== "ok") log("gemini_attempt_failed", { label, model: model.model_key, outcome, http, ms, error: error?.slice(0, 160) });
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    for (const model of candidates) {
      if (excluded.has(model.id)) continue;
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) break;

      const key = KEY_VAR.test(model.api_key_env_var) ? process.env[model.api_key_env_var] : undefined;
      if (!key || !MODEL_KEY.test(model.model_key)) {
        note(model, "rejected", null, 0, key ? "invalid model key" : `${model.api_key_env_var} is not configured on this server`);
        continue;
      }

      const t0 = Date.now();
      let response: Response;
      try {
        response = await fetch(`${GEMINI_BASE}/${model.model_key}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body,
          signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)),
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        note(model, timedOut ? "timeout" : "network", null, Date.now() - t0, timedOut ? "no answer in time" : "couldn't reach Gemini");
        continue;
      }
      const ms = Date.now() - t0;
      const json = (await response.json().catch(() => ({}))) as GeminiBody;
      const message = json.error?.message;

      if (response.ok) {
        const text = (json.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => !p.thought && p.text)
          .map((p) => p.text)
          .join("")
          .trim();
        if (text && validate(text)) {
          attempts.push({ model: model.model_key, outcome: "ok", http: response.status, ms });
          bench.delete(model.model_key);
          if (attempts.length > 1) log("gemini_recovered", { label, model: model.model_key, attempts: attempts.length, totalMs: Date.now() - started });
          const usage = json.usageMetadata ?? {};
          return result({
            ok: true, text, model, httpStatus: response.status,
            inputTokens: usage.promptTokenCount ?? null,
            outputTokens:
              usage.candidatesTokenCount === undefined && usage.thoughtsTokenCount === undefined
                ? null
                : (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          });
        }
        note(model, "bad_output", response.status, ms, text ? "answer wasn't in the expected format" : "empty answer");
        continue;
      }
      const outcome: Outcome =
        response.status === 429 ? "quota"
        : response.status === 404 ? "gone"
        : response.status >= 500 ? "busy"
        : "rejected";
      note(model, outcome, response.status, ms, message ?? `HTTP ${response.status}`);
    }
    if (candidates.every((m) => excluded.has(m.id))) break;
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS + 1_000) break;
    await sleep(Math.min(1_500 * (pass + 1) + Math.random() * 500, remaining - MIN_ATTEMPT_MS));
  }

  const outcomes = new Set(attempts.map((a) => a.outcome));
  const failure: GenerateResult["failure"] =
    attempts.length && attempts.every((a) => a.outcome === "quota") ? "quota"
    : outcomes.has("busy") || outcomes.has("timeout") || outcomes.has("network") ? "busy"
    : outcomes.has("bad_output") ? "bad_output"
    : "rejected";
  const last = attempts[attempts.length - 1];
  log("gemini_gave_up", { label, attempts: attempts.length, totalMs: Date.now() - started, failure });
  return result({
    httpStatus: last?.http ?? 0,
    error: last ? `${attempts.length} attempt${attempts.length === 1 ? "" : "s"} on ${new Set(attempts.map((a) => a.model)).size} model(s) failed; last: ${last.model} ${last.outcome}${last.error ? ` (${last.error})` : ""}` : "no model available",
    failure,
  });
}

// What to tell a person when generation failed after every retry.
export function failureMessage(failure: GenerateResult["failure"]) {
  switch (failure) {
    case "quota":
      return "Gemini's free daily quota is used up on every model we can use. It resets daily; nothing is wrong with your setup.";
    case "busy":
      return "Every Gemini model we tried was overloaded, even after retrying, so we stopped. Nothing is wrong with your setup; try again in a few minutes.";
    case "bad_output":
      return "The models answered, but not in the expected format, even after retries.";
    default:
      return "Gemini rejected the request. Check the server's Gemini API key and model settings.";
  }
}
