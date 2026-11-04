import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCaptionPrompt, VIBES, type Vibe } from "@/lib/captions";
import { generateCaptionsWithGemini } from "@/lib/gemini";
import { candidatesFor, generate, prepareImage, type ModelOption } from "@/lib/reliable-gemini";

// The caption pipeline. The database decides which prompt chain runs (the
// mix an admin sets in the AI Studio), which model each step uses, and which
// terms and examples go into the prompts; this file runs the steps against
// Gemini and logs every call. Shared with the main app: keep in sync with
// hello-world-nextjs/src/lib/pipeline.ts.
//
// Every model call goes through reliable-gemini.ts: short per-attempt
// timeouts, automatic failover to other Gemini models when one is
// overloaded, and bounded retries, all inside RUN_BUDGET_MS. Nothing is
// written to the post until captions exist, so retries can't duplicate a
// post; each step is logged once, with every attempt behind it.
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

// Shown when every model is out of quota (HTTP 429).
export const QUOTA_MESSAGE =
  "The AI has hit its usage limit for now, so it can't write captions at the moment. Your photo wasn't posted. Try again later. In the meantime you can still caption and vote on other posts.";
const BUSY_MESSAGE =
  "Every AI model we tried was overloaded, even after retrying, so we stopped. Your photo wasn't posted. Try again in a few minutes.";

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly userMessage: string
  ) {
    super(message);
  }
}

// The whole run (all steps, retries and failovers) must finish well inside
// the server function's 300s limit, with time left to save the post.
const RUN_BUDGET_MS = 150_000;

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
    readonly failure: "quota" | "busy" | "rejected" | "bad_output" | null
  ) {
    super(message);
  }
}

// The Gemini models this server may fail over to (from the database).
async function modelOptions(supabase: SupabaseClient): Promise<ModelOption[]> {
  const { data, error } = await supabase.rpc("caption_model_options");
  if (error) {
    console.warn(JSON.stringify({ event: "model_options_unavailable", error: error.message }));
    return [];
  }
  return (data ?? []) as ModelOption[];
}

// Logs one step. Older databases (before the reliability migration) don't
// know p_model / p_attempts; then the step is logged the old way.
async function logResponse(supabase: SupabaseClient, args: Record<string, unknown>) {
  const { error } = await supabase.rpc("log_llm_response", args);
  if (!error) return;
  if (error.code === "PGRST202") {
    const { p_model: _model, p_attempts: _attempts, ...old } = args;
    void _model;
    void _attempts;
    const retry = await supabase.rpc("log_llm_response", old);
    if (!retry.error) return;
    console.error(JSON.stringify({ event: "log_llm_response_failed", error: retry.error.message }));
    return;
  }
  console.error(JSON.stringify({ event: "log_llm_response_failed", error: error.message }));
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
  const models = await modelOptions(supabase);
  const photo = await prepareImage(input.image, input.mimeType);
  let previous = "";
  let finalPrompt = "";
  let model = "";
  let captions: string[] = [];

  try {
    for (const [index, step] of plan.steps.entries()) {
      const isLast = index === plan.steps.length - 1;
      const prompt = renderTemplate(step.instructions, templateVars(input, plan, previous));
      const parts: object[] = [];
      if (step.include_image) parts.push({ inline_data: { mime_type: photo.mimeType, data: Buffer.from(photo.bytes).toString("base64") } });
      parts.push({ text: prompt });
      const generationConfig: Record<string, unknown> = {};
      if (step.temperature !== null) generationConfig.temperature = Number(step.temperature);
      if (step.max_output_tokens) generationConfig.maxOutputTokens = step.max_output_tokens;
      if (step.kind === "caption") {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseSchema = { type: "ARRAY", items: { type: "STRING" } };
      }
      // Leave the remaining steps a fair share of the budget.
      const stepsLeft = plan.steps.length - index;
      const budget = Math.max(20_000, Math.floor((deadline - Date.now()) / stepsLeft));
      const primary: ModelOption = {
        id: models.find((o) => o.model_key === step.model_key)?.id ?? `step:${step.model_key}`,
        model_key: step.model_key,
        api_key_env_var: step.api_key_env_var,
        supports_vision: true,
      };
      const result = await generate({
        candidates: candidatesFor(primary, models, step.include_image),
        parts,
        generationConfig,
        validate: (text) => step.kind === "analyze" || parseCaptions(text, isLast ? 4 : 12).length > 0,
        budgetMs: Math.min(budget, deadline - Date.now()),
        label: `${models.length ? "caption" : "caption(no-fallback)"} ${plan.request_id.slice(0, 8)} step ${step.position}`,
      });
      const parsed = step.kind === "caption" && result.ok ? parseCaptions(result.text, isLast ? 4 : 12) : [];

      await logResponse(supabase, {
        p_request: plan.request_id,
        p_step: step.id,
        p_prompt: prompt,
        p_response: result.text || null,
        p_status: result.ok ? "ok" : "error",
        p_http_status: result.httpStatus || null,
        p_error: result.ok ? null : (result.error ?? "unusable response").slice(0, 500),
        p_latency_ms: result.latencyMs,
        p_input_tokens: result.inputTokens,
        p_output_tokens: result.outputTokens,
        // Only when a fallback answered; otherwise the step's model is logged.
        p_model: result.model && result.model.model_key !== step.model_key ? result.model.id : null,
        p_attempts: result.attempts.length ? result.attempts : null,
      });

      if (!result.ok) {
        throw new StepError(`Step ${step.position} (${step.name}) failed: ${result.error ?? "unusable response"}`, result.failure);
      }
      previous = step.kind === "caption" ? parsed.map((c, i) => `${i + 1}. ${c}`).join("\n") : result.text;
      if (isLast) {
        captions = parsed;
        finalPrompt = prompt;
        model = result.model?.model_key ?? step.model_key;
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Pipeline failed";
    await finishCaptionRequest(supabase, plan.request_id, false, message);
    const failure = e instanceof StepError ? e.failure : null;
    throw new PipelineError(
      message,
      failure === "quota"
        ? QUOTA_MESSAGE
        : failure === "busy"
          ? BUSY_MESSAGE
          : "The AI couldn't caption that one. Your photo wasn't posted. Try again in a moment."
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
