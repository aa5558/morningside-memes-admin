import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCaptionPrompt, VIBES, type Vibe } from "@/lib/captions";
import { generateCaptionsWithGemini } from "@/lib/gemini";

// The caption pipeline. The database decides which prompt chain runs (the
// mix an admin sets in the AI Studio), which model each step uses, and which
// terms and examples go into the prompts; this file runs the steps against
// Gemini and logs every call. Shared with the main app: keep in sync with
// hello-world-nextjs/src/lib/pipeline.ts.
//
// If the AI Studio tables aren't there yet (migration not applied) or no
// chain can run, it falls back to the original one-shot prompt, so posting
// never breaks because of the pipeline.

type Step = {
  id: string;
  position: number;
  name: string;
  kind: "analyze" | "caption";
  include_image: boolean;
  instructions: string;
  temperature: number | null;
  max_output_tokens: number | null;
  model_key: string;
  api_key_env_var: string;
};

type Plan = {
  request_id: string;
  chain: { id: string; slug: string; name: string };
  steps: Step[];
  terms: { term: string; definition: string }[];
  examples: { scene: string; caption: string }[];
};

export type PipelineInput = {
  vibe: Vibe;
  context: string | null;
  dailyPrompt: string;
  imagePrompt?: string | null;
  image: ArrayBuffer;
  mimeType: string;
};

export type PipelineResult = {
  captions: string[];
  model: string;
  prompt: string;
  chain: string;
  requestId: string | null;
};

// Shown when the model provider says we're out of quota (HTTP 429).
export const QUOTA_MESSAGE =
  "The AI has hit its usage limit for now, so it can't write captions at the moment. Your photo wasn't posted. Try again later. In the meantime you can still caption and vote on other posts.";
const BUSY_MESSAGE = "The AI is overloaded right now. Your photo wasn't posted. Give it a minute and try again.";

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly userMessage: string
  ) {
    super(message);
  }
}

// A key variable must look like FOO_API_KEY, so a provider record can never
// make the server send some other secret to the model API.
const KEY_VAR = /^[A-Z][A-Z0-9_]{0,50}_API_KEY$/;
// Overridable only from server env, so tests can point at a local stand-in.
const GEMINI_BASE = process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta/models";
// A whole run must finish inside the 60s server function limit, with time
// left to save the post; one call never gets more than CALL_TIMEOUT_MS.
const RUN_BUDGET_MS = 48_000;
const CALL_TIMEOUT_MS = 30_000;
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

type GeminiBody = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  modelVersion?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string };
};

async function callGemini(step: Step, prompt: string, input: PipelineInput, deadline: number) {
  const key = KEY_VAR.test(step.api_key_env_var) ? process.env[step.api_key_env_var] : undefined;
  if (!key) throw new Error(`${step.api_key_env_var} is not configured on this server.`);
  if (!MODEL_KEY.test(step.model_key)) throw new Error("Invalid model key.");

  const parts: object[] = [];
  if (step.include_image) {
    parts.push({ inline_data: { mime_type: input.mimeType, data: Buffer.from(input.image).toString("base64") } });
  }
  parts.push({ text: prompt });

  const generationConfig: Record<string, unknown> = {};
  if (step.temperature !== null) generationConfig.temperature = Number(step.temperature);
  if (step.max_output_tokens) generationConfig.maxOutputTokens = step.max_output_tokens;
  if (step.kind === "caption") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = { type: "ARRAY", items: { type: "STRING" } };
  }

  const started = Date.now();
  let response: Response | undefined;
  // Gemini's free tier often answers 503 ("high demand") for a few seconds;
  // retry twice while there's time left. 429 means a quota is used up, which
  // won't clear in seconds, so it isn't retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 2_000) throw new Error("Ran out of time waiting for the model.");
    try {
      response = await fetch(`${GEMINI_BASE}/${step.model_key}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts }], generationConfig }),
        signal: AbortSignal.timeout(Math.min(CALL_TIMEOUT_MS, remaining)),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new Error(`The model didn't answer within ${Math.round((Date.now() - started) / 1000)}s.`);
      }
      throw e;
    }
    if (response.status !== 503) break;
    if (attempt < 2 && deadline - Date.now() > 6_000) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    else break;
  }
  const body = (await response!.json().catch(() => ({}))) as GeminiBody;
  const usage = body.usageMetadata ?? {};
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("")
    .trim();

  return {
    ok: response!.ok && text.length > 0,
    text,
    httpStatus: response!.status,
    latencyMs: Date.now() - started,
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens:
      usage.candidatesTokenCount === undefined && usage.thoughtsTokenCount === undefined
        ? null
        : (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    error: response!.ok ? (text ? null : "Empty response") : (body.error?.message ?? `HTTP ${response!.status}`),
    model: body.modelVersion ?? step.model_key,
  };
}

function parseCaptions(text: string, max: number) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return (Array.isArray(parsed) ? parsed : [])
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim().replace(/^["“]|["”]$/g, "").slice(0, 300))
    .filter(Boolean)
    .slice(0, max);
}

// Fills {{placeholders}}. Optional lines collapse away when empty.
export function renderTemplate(template: string, vars: Record<string, string>) {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => vars[name] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function templateVars(input: PipelineInput, plan?: Pick<Plan, "terms" | "examples">, previous = "") {
  const terms = plan?.terms ?? [];
  const examples = plan?.examples ?? [];
  return {
    voice: VIBES[input.vibe].description,
    context: input.context ? `The poster added this context: "${input.context}"` : "",
    image_prompt: input.imagePrompt
      ? `This image was AI-generated from the description "${input.imagePrompt}". Caption it as if it were a real photo.`
      : "",
    daily_prompt: input.dailyPrompt,
    terms: terms.length
      ? `Local terms you can use if they fit (don't force them):\n${terms.map((t) => `- ${t.term}: ${t.definition}`).join("\n")}`
      : "",
    examples: examples.length
      ? `Captions in this style that landed well with students:\n${examples
          .map((e) => `- Photo: ${e.scene}\n  Caption: "${e.caption}"`)
          .join("\n")}`
      : "",
    previous,
  };
}

class StepError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
  }
}

async function legacy(input: PipelineInput): Promise<PipelineResult> {
  const prompt = buildCaptionPrompt(input);
  try {
    const { captions, model } = await generateCaptionsWithGemini({ image: input.image, mimeType: input.mimeType, prompt });
    return { captions, model, prompt, chain: "built-in", requestId: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Caption generation failed";
    throw new PipelineError(message, /quota|rate limit/i.test(message) ? QUOTA_MESSAGE : "The AI couldn't caption that one. Your photo wasn't posted. Try again in a moment.");
  }
}

const START_ERRORS: Record<string, string> = {
  rate_limited: "You've hit today's AI limit. Come back tomorrow, or go vote on some captions!",
  not_signed_in: "Sign in to post.",
};

// Runs one caption request end to end. `options` is for the admin app.
export async function runCaptionPipeline(
  supabase: SupabaseClient,
  input: PipelineInput,
  options: { source?: "main_app" | "admin"; chainId?: string; generationId?: string } = {}
): Promise<PipelineResult> {
  const { data, error } = await supabase.rpc("begin_caption_request", {
    p_vibe: input.vibe,
    p_source: options.source ?? "main_app",
    p_chain: options.chainId ?? null,
    p_generation: options.generationId ?? null,
  });

  if (error) {
    if (START_ERRORS[error.message]) throw new PipelineError(error.message, START_ERRORS[error.message]);
    // Missing function (migration not applied yet) or nothing runnable:
    // keep the app working with the original prompt.
    if (error.code === "PGRST202" || error.message === "no_chain_available") {
      if (options.chainId) throw new PipelineError(error.message, "That chain can't run right now.");
      return legacy(input);
    }
    throw new PipelineError(error.message, "The AI couldn't get started. Try again in a moment.");
  }

  const plan = data as Plan;
  const deadline = Date.now() + RUN_BUDGET_MS;
  let previous = "";
  let finalPrompt = "";
  let model = "";
  let captions: string[] = [];

  try {
    for (const [index, step] of plan.steps.entries()) {
      const isLast = index === plan.steps.length - 1;
      const prompt = renderTemplate(step.instructions, templateVars(input, plan, previous));
      let result: Awaited<ReturnType<typeof callGemini>>;
      const callStarted = Date.now();
      try {
        result = await callGemini(step, prompt, input, deadline);
      } catch (e) {
        result = {
          ok: false, text: "", httpStatus: 0, latencyMs: Date.now() - callStarted, inputTokens: null, outputTokens: null,
          error: e instanceof Error ? e.message : "Request failed", model: step.model_key,
        };
      }
      const parsed = step.kind === "caption" && result.ok ? parseCaptions(result.text, isLast ? 4 : 12) : [];
      const ok = result.ok && (step.kind === "analyze" || parsed.length > 0);

      await supabase.rpc("log_llm_response", {
        p_request: plan.request_id,
        p_step: step.id,
        p_prompt: prompt,
        p_response: result.text || null,
        p_status: ok ? "ok" : "error",
        p_http_status: result.httpStatus || null,
        p_error: ok ? null : (result.error ?? "Unparseable response"),
        p_latency_ms: result.latencyMs,
        p_input_tokens: result.inputTokens,
        p_output_tokens: result.outputTokens,
      });

      if (!ok) {
        throw new StepError(`Step ${step.position} (${step.name}) failed: ${result.error ?? "unparseable response"}`, result.httpStatus);
      }
      previous = step.kind === "caption" ? parsed.map((c, i) => `${i + 1}. ${c}`).join("\n") : result.text;
      if (isLast) {
        captions = parsed;
        finalPrompt = prompt;
        model = result.model;
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pipeline failed";
    await finishCaptionRequest(supabase, plan.request_id, false, message);
    const status = e instanceof StepError ? e.httpStatus : 0;
    throw new PipelineError(
      message,
      status === 429 ? QUOTA_MESSAGE : status === 503 ? BUSY_MESSAGE : "The AI couldn't caption that one. Your photo wasn't posted. Try again in a moment."
    );
  }

  return { captions, model, prompt: finalPrompt, chain: plan.chain.slug, requestId: plan.request_id };
}

export async function finishCaptionRequest(
  supabase: SupabaseClient,
  requestId: string | null,
  succeeded: boolean,
  errorMessage?: string,
  generationId?: string
) {
  if (!requestId) return;
  const { error } = await supabase.rpc("finish_caption_request", {
    p_request: requestId,
    p_succeeded: succeeded,
    p_error: errorMessage ?? null,
    p_generation: generationId ?? null,
  });
  if (error) console.error("finish_caption_request failed", error.message);
}
