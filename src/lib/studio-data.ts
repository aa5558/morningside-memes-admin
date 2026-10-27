import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Typed wrappers for the AI Studio, model, access and image-library data
// (see supabase/migrations/20261026000000_ai_studio_access_images.sql).
// Lists that need people's names go through admin_* functions; plain
// tables are read directly, where RLS returns rows only to superadmins.

function unwrap<T>({ data, error }: { data: unknown; error: { message: string } | null }, what: string): T {
  if (error) throw new Error(`Couldn't load ${what}: ${error.message}`);
  return data as T;
}

export type ChainStep = {
  id: string;
  position: number;
  name: string;
  purpose: string | null;
  kind: "analyze" | "caption";
  include_image: boolean;
  temperature: number | null;
  instructions: string;
  model_id: string;
  model_key: string;
  model_name: string;
  model_active: boolean;
  model_temperature: number;
  provider_name: string;
  provider_active: boolean;
  provider_adapter: string;
};

export type Chain = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  weight: number;
  runnable: boolean;
  steps: ChainStep[];
  runs: { requests: number; succeeded: number; failed: number; avg_seconds: number | null; last_run: string | null };
  caption_stats: { captions: number; voted: number; avg_score: number | null; upvotes: number; downvotes: number };
  battles: { battles: number; ai_wins: number; human_wins: number };
};

export async function listChains(supabase: SupabaseClient) {
  return unwrap<Chain[]>(await supabase.rpc("admin_list_prompt_chains"), "prompt chains") ?? [];
}

export type RequestRow = {
  id: string;
  status: "running" | "succeeded" | "failed";
  source: "main_app" | "admin";
  chain_id: string | null;
  chain_slug: string;
  chain_name: string | null;
  vibe: string | null;
  user_id: string | null;
  user_name: string | null;
  generation_id: string | null;
  image_path: string | null;
  captions: number;
  calls: number;
  tokens: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  total_count: number;
};

export async function listRequests(
  supabase: SupabaseClient,
  args: { p_status: string | null; p_chain: string | null; p_source: string | null; p_limit: number; p_offset: number }
) {
  return unwrap<RequestRow[]>(await supabase.rpc("admin_list_generation_requests", args), "generation requests") ?? [];
}

export type ResponseDetail = {
  id: string;
  step_position: number | null;
  step_name: string | null;
  model_key: string;
  provider_slug: string | null;
  prompt_text: string;
  response_text: string | null;
  status: "ok" | "error";
  http_status: number | null;
  error_message: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

export type RequestDetail = Omit<RequestRow, "captions" | "calls" | "tokens" | "total_count" | "duration_ms"> & {
  captions: { id: string; text: string; score: number; upvotes: number; downvotes: number }[];
  responses: ResponseDetail[];
};

export async function getRequest(supabase: SupabaseClient, id: string) {
  return unwrap<RequestDetail | null>(await supabase.rpc("admin_get_generation_request", { p_request: id }), "generation request");
}

export type ResponseRow = Omit<ResponseDetail, "prompt_text"> & {
  request_id: string;
  chain_slug: string;
  prompt_preview: string;
  total_count: number;
};

export async function listResponses(
  supabase: SupabaseClient,
  args: { p_status: string | null; p_model: string | null; p_search: string | null; p_limit: number; p_offset: number }
) {
  return unwrap<ResponseRow[]>(await supabase.rpc("admin_list_llm_responses", args), "LLM responses") ?? [];
}

export type AiStats = {
  range_days: number;
  requests: number;
  succeeded: number;
  failed: number;
  running: number;
  calls: number;
  call_errors: number;
  input_tokens: number;
  output_tokens: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  last_request_at: string | null;
  daily: { day: string; succeeded: number; failed: number }[];
  models: { model_key: string; calls: number; errors: number; avg_latency_ms: number | null; input_tokens: number; output_tokens: number }[];
  sources: Record<string, number>;
};

export async function getAiStats(supabase: SupabaseClient, days: number) {
  return unwrap<AiStats>(await supabase.rpc("admin_ai_stats", { p_days: days }), "AI usage");
}

export type Provider = {
  id: string;
  slug: string;
  name: string;
  adapter: "gemini" | "none";
  api_key_env_var: string | null;
  website_url: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Model = {
  id: string;
  provider_id: string;
  model_key: string;
  display_name: string;
  supports_vision: boolean;
  temperature: number;
  max_output_tokens: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export async function listProvidersAndModels(supabase: SupabaseClient) {
  const [providers, models] = await Promise.all([
    supabase.from("llm_providers").select("*").order("name"),
    supabase.from("llm_models").select("*").order("display_name"),
  ]);
  return {
    providers: unwrap<Provider[]>(providers, "providers") ?? [],
    models: unwrap<Model[]>(models, "models") ?? [],
  };
}

// Whether this server has the named key set. Only a yes/no ever leaves the
// server; the value is never read into a response.
export function keyConfigured(envVar: string | null) {
  return Boolean(envVar && /^[A-Z][A-Z0-9_]{0,50}_API_KEY$/.test(envVar) && process.env[envVar]);
}

export type Term = {
  id: string;
  term: string;
  definition: string;
  example: string | null;
  category: "campus" | "nyc" | "internet" | "general";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listTerms(supabase: SupabaseClient) {
  return unwrap<Term[]>(await supabase.from("terms").select("*").order("term"), "terms") ?? [];
}

export type Example = {
  id: string;
  vibe: string | null;
  scene: string;
  caption: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listExamples(supabase: SupabaseClient) {
  return (
    unwrap<Example[]>(await supabase.from("ai_generation_examples").select("*").order("created_at", { ascending: false }), "examples") ?? []
  );
}

export type Domain = { id: string; domain: string; include_subdomains: boolean; note: string | null; created_at: string; updated_at: string };
export type WhitelistedEmail = { id: string; email: string; note: string | null; created_at: string; updated_at: string };

export async function getAccess(supabase: SupabaseClient) {
  const [settings, domains, emails] = await Promise.all([
    supabase.from("signup_settings").select("restrict_signups, updated_at").maybeSingle(),
    supabase.from("allowed_signup_domains").select("*").order("domain"),
    supabase.from("whitelisted_emails").select("*").order("email"),
  ]);
  return {
    restricted: Boolean(unwrap<{ restrict_signups: boolean } | null>(settings, "signup settings")?.restrict_signups),
    settingsUpdatedAt: (settings.data as { updated_at?: string } | null)?.updated_at ?? null,
    domains: unwrap<Domain[]>(domains, "signup domains") ?? [],
    emails: unwrap<WhitelistedEmail[]>(emails, "whitelisted emails") ?? [],
  };
}

export type LibraryImage = {
  id: string;
  storage_path: string;
  title: string;
  alt_text: string;
  tags: string[];
  mime_type: string;
  byte_size: number;
  is_active: boolean;
  featured_on: string | null;
  created_at: string;
  updated_at: string;
};

export async function listImages(supabase: SupabaseClient) {
  const [images, usage] = await Promise.all([
    supabase.from("images").select("*").order("created_at", { ascending: false }),
    supabase.rpc("admin_image_usage"),
  ]);
  const counts = new Map(
    (unwrap<{ image_id: string; posts: number; captions: number }[]>(usage, "image usage") ?? []).map((u) => [u.image_id, u])
  );
  return (unwrap<LibraryImage[]>(images, "images") ?? []).map((image) => ({
    ...image,
    posts: counts.get(image.id)?.posts ?? 0,
    captions: counts.get(image.id)?.captions ?? 0,
  }));
}

export function libraryUrl(path: string) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/images/${encodeURIComponent(path)}`;
}
