// The admin-editable tables and their fields. Shared by the server actions
// (which validate every field against these rules before the database
// checks them again) and the forms (which render from them). Keep the
// patterns and limits in step with the CHECK constraints in
// supabase/migrations/20261026000000_ai_studio_access_images.sql.

export type Field =
  | {
      name: string;
      label: string;
      type: "text" | "textarea";
      required?: boolean;
      max: number;
      min?: number;
      pattern?: string;
      patternHint?: string;
      placeholder?: string;
      help?: string;
      mono?: boolean;
    }
  | { name: string; label: string; type: "number"; required?: boolean; min: number; max: number; step?: number; integer?: boolean; help?: string; placeholder?: string }
  | { name: string; label: string; type: "checkbox"; help?: string; defaultValue?: boolean }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; help?: string; nullValue?: string };

export type ResourceKey = "terms" | "examples" | "providers" | "models" | "domains" | "emails";

export type Resource = {
  table: string;
  noun: string;
  path: string;
  fields: Field[];
};

export const VIBE_OPTIONS = [
  { value: "midwest", label: "🌽 Midwest kid in NYC" },
  { value: "online", label: "📱 Chronically online" },
  { value: "columbia", label: "🦁 Columbia core" },
  { value: "newyorker", label: "🗽 Jaded New Yorker" },
];

export const TERM_CATEGORIES = [
  { value: "campus", label: "Campus" },
  { value: "nyc", label: "NYC" },
  { value: "internet", label: "Internet" },
  { value: "general", label: "General" },
];

export const RESOURCES: Record<ResourceKey, Resource> = {
  terms: {
    table: "terms",
    noun: "term",
    path: "/terms",
    fields: [
      { name: "term", label: "Term", type: "text", required: true, max: 60, placeholder: "e.g. Butler" },
      { name: "definition", label: "What it means", type: "textarea", required: true, max: 300, help: "Written for the model: plain, factual, one or two sentences." },
      { name: "example", label: "Example (optional)", type: "text", max: 200 },
      { name: "category", label: "Category", type: "select", options: TERM_CATEGORIES, required: true, help: "Decides which caption voices see it: Campus → Columbia core, NYC → Jaded New Yorker, Internet → Chronically online, General → all." },
      { name: "is_active", label: "Active (sent to the model)", type: "checkbox", defaultValue: true },
    ],
  },
  examples: {
    table: "ai_generation_examples",
    noun: "example",
    path: "/studio/examples",
    fields: [
      { name: "vibe", label: "Voice", type: "select", options: [{ value: "", label: "Any voice" }, ...VIBE_OPTIONS], nullValue: "" },
      { name: "scene", label: "The photo", type: "textarea", required: true, min: 3, max: 300, help: "Describe the photo so the model knows what the caption was reacting to." },
      { name: "caption", label: "The caption", type: "textarea", required: true, max: 200 },
      { name: "notes", label: "Notes (admin only)", type: "text", max: 300 },
      { name: "is_active", label: "Active (sent to the model)", type: "checkbox", defaultValue: true },
    ],
  },
  providers: {
    table: "llm_providers",
    noun: "provider",
    path: "/models",
    fields: [
      { name: "name", label: "Name", type: "text", required: true, max: 80, placeholder: "e.g. Google Gemini API" },
      { name: "slug", label: "Slug", type: "text", required: true, max: 40, pattern: "^[a-z0-9][a-z0-9-]{1,39}$", patternHint: "lowercase letters, numbers and dashes", mono: true },
      {
        name: "adapter",
        label: "Runtime adapter",
        type: "select",
        required: true,
        options: [
          { value: "gemini", label: "Gemini API (callable)" },
          { value: "none", label: "None: catalog only, can't run" },
        ],
        help: "Only Gemini has a runtime adapter in the apps today. Models under a catalog-only provider can't be used by a running chain.",
      },
      {
        name: "api_key_env_var",
        label: "API key environment variable",
        type: "text",
        max: 60,
        pattern: "^[A-Z][A-Z0-9_]{0,50}_API_KEY$",
        patternHint: "an env var NAME ending in _API_KEY, e.g. GEMINI_API_KEY",
        mono: true,
        help: "The name of the server environment variable that holds the key. Never paste the key itself: it isn't stored in the database.",
      },
      { name: "website_url", label: "Website", type: "text", max: 200, pattern: "^https://\\S{3,200}$", patternHint: "an https:// URL" },
      { name: "notes", label: "Notes", type: "textarea", max: 500 },
      { name: "is_active", label: "Active", type: "checkbox", defaultValue: true },
    ],
  },
  models: {
    table: "llm_models",
    noun: "model",
    path: "/models",
    fields: [
      { name: "provider_id", label: "Provider", type: "select", required: true, options: [] },
      { name: "display_name", label: "Display name", type: "text", required: true, max: 80, placeholder: "e.g. Gemini Flash (latest)" },
      { name: "model_key", label: "Model id (as the API expects it)", type: "text", required: true, max: 100, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$", patternHint: "letters, numbers and . _ : / -", mono: true, placeholder: "gemini-flash-latest" },
      { name: "temperature", label: "Default temperature", type: "number", required: true, min: 0, max: 2, step: 0.05, help: "0 = predictable, 2 = chaotic. Steps can override it." },
      { name: "max_output_tokens", label: "Max output tokens (optional)", type: "number", min: 64, max: 65536, integer: true, help: "Leave empty for the provider default. Thinking models spend output tokens on reasoning, so low caps can cut captions off." },
      { name: "supports_vision", label: "Can see images", type: "checkbox", defaultValue: true },
      { name: "is_active", label: "Active", type: "checkbox", defaultValue: true },
      { name: "notes", label: "Notes", type: "textarea", max: 500 },
    ],
  },
  domains: {
    table: "allowed_signup_domains",
    noun: "domain",
    path: "/access",
    fields: [
      { name: "domain", label: "Email domain", type: "text", required: true, max: 253, pattern: "^@?([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,24}$", patternHint: "a domain like columbia.edu", mono: true, placeholder: "columbia.edu" },
      { name: "include_subdomains", label: "Also allow subdomains (e.g. cs.columbia.edu)", type: "checkbox", defaultValue: false },
      { name: "note", label: "Note", type: "text", max: 200 },
    ],
  },
  emails: {
    table: "whitelisted_emails",
    noun: "email",
    path: "/access",
    fields: [
      { name: "email", label: "Email address", type: "text", required: true, max: 254, pattern: "^[A-Za-z0-9._%+-]+@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,24}$", patternHint: "a full email address", mono: true, placeholder: "guest.speaker@gmail.com" },
      { name: "note", label: "Note", type: "text", max: 200, placeholder: "Why they're allowed in" },
    ],
  },
};

export function isResourceKey(value: unknown): value is ResourceKey {
  return typeof value === "string" && value in RESOURCES;
}
