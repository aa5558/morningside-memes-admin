"use server";

import { revalidatePath } from "next/cache";
import { AdminAuthError, requireAdminAction } from "@/lib/auth";
import { isResourceKey, RESOURCES, type Field, type ResourceKey } from "@/lib/resources";
import { isUuid } from "@/lib/validate";

// Create / update / delete for the admin-managed tables in lib/resources.ts.
// Reachable by a direct POST, so each action re-checks superadmin status,
// accepts only known resources and fields, and validates every value. The
// database then enforces the same rules (RLS: superadmins only; CHECK
// constraints; column grants) and writes the audit log entry.

export type FormResult = { error?: string; success?: string; fieldErrors?: Record<string, string>; at?: number };

function friendly(error: { code?: string; message: string; details?: string | null }, noun: string) {
  switch (error.code) {
    case "23505":
      return `That ${noun} already exists.`;
    case "23514":
      return "One of the values isn't allowed. Check the format and length.";
    case "23503":
    case "23001":
      return `This ${noun} is still in use (for example by a prompt chain step or a model), so it can't be deleted. Remove what uses it first, or mark it inactive instead.`;
    case "42501":
      return "Superadmin access required.";
    default:
      return `Couldn't save the ${noun}.`;
  }
}

function readField(field: Field, formData: FormData, providerIds: string[]): { value?: unknown; error?: string } {
  const raw = formData.get(field.name);
  switch (field.type) {
    case "checkbox":
      return { value: raw === "on" || raw === "true" };
    case "select": {
      const value = typeof raw === "string" ? raw : "";
      if (field.nullValue !== undefined && value === field.nullValue) return { value: null };
      const allowed = field.name === "provider_id" ? providerIds : field.options.map((o) => o.value);
      if (!allowed.includes(value)) return { error: "Pick one of the options." };
      return { value };
    }
    case "number": {
      const text = typeof raw === "string" ? raw.trim() : "";
      if (!text) return field.required ? { error: "Required." } : { value: null };
      const n = Number(text);
      if (!Number.isFinite(n) || n < field.min || n > field.max) return { error: `Must be between ${field.min} and ${field.max}.` };
      if (field.integer && !Number.isInteger(n)) return { error: "Must be a whole number." };
      return { value: n };
    }
    default: {
      const text = typeof raw === "string" ? raw.trim().replace(field.type === "text" ? /\s+/g : /[ \t]+/g, " ") : "";
      if (!text) return field.required ? { error: "Required." } : { value: null };
      if (text.length > field.max) return { error: `Keep it under ${field.max} characters.` };
      if (field.min && text.length < field.min) return { error: `At least ${field.min} characters.` };
      if (field.pattern && !new RegExp(field.pattern).test(text)) return { error: `Use ${field.patternHint ?? "the expected format"}.` };
      return { value: text };
    }
  }
}

function revalidate(resource: ResourceKey) {
  revalidatePath(RESOURCES[resource].path);
  revalidatePath("/studio");
  revalidatePath("/audit");
}

async function guard(run: () => Promise<FormResult>): Promise<FormResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AdminAuthError) return { error: error.message };
    throw error;
  }
}

// CREATE when id is null, otherwise UPDATE. Bound per form:
// saveRecord.bind(null, "terms", id).
export async function saveRecord(
  resource: ResourceKey,
  id: string | null,
  _prev: FormResult,
  formData: FormData
): Promise<FormResult> {
  // Every result is timestamped so the form can tell a new result from an
  // old one.
  const result = await guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isResourceKey(resource)) return { error: "Unknown resource." };
    if (id !== null && !isUuid(id)) return { error: "Invalid record." };
    const config = RESOURCES[resource];

    let providerIds: string[] = [];
    if (resource === "models") {
      const { data } = await supabase.from("llm_providers").select("id");
      providerIds = (data ?? []).map((p: { id: string }) => p.id);
    }

    const row: Record<string, unknown> = {};
    const fieldErrors: Record<string, string> = {};
    for (const field of config.fields) {
      const { value, error } = readField(field, formData, providerIds);
      if (error) fieldErrors[field.name] = error;
      else row[field.name] = value;
    }
    if (resource === "providers" && row.adapter === "gemini" && !row.api_key_env_var) {
      fieldErrors.api_key_env_var = "A callable provider needs the name of its key variable.";
    }
    if (Object.keys(fieldErrors).length) return { error: "Fix the highlighted fields.", fieldErrors };

    const query = id
      ? supabase.from(config.table).update(row).eq("id", id).select("id")
      : supabase.from(config.table).insert(row).select("id");
    const { data, error } = await query;
    if (error) return { error: friendly(error, config.noun) };
    if (!data?.length) return { error: `That ${config.noun} no longer exists. Refresh the page.` };

    revalidate(resource);
    return { success: id ? "Saved." : `Added the ${config.noun}.` };
  });
  return { ...result, at: Date.now() };
}

export async function deleteRecord(resource: ResourceKey, id: string): Promise<FormResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isResourceKey(resource) || !isUuid(id)) return { error: "Invalid record." };
    const config = RESOURCES[resource];

    const { data, error } = await supabase.from(config.table).delete().eq("id", id).select("id");
    if (error) return { error: friendly(error, config.noun) };
    if (!data?.length) return { error: `That ${config.noun} no longer exists.` };

    revalidate(resource);
    return { success: "Deleted." };
  });
}

// Quick on/off switch for rows with an is_active column.
export async function setActive(resource: ResourceKey, id: string, active: boolean): Promise<FormResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isResourceKey(resource) || !isUuid(id) || typeof active !== "boolean") return { error: "Invalid record." };
    const config = RESOURCES[resource];
    if (!config.fields.some((f) => f.name === "is_active")) return { error: "This record can't be switched off." };

    const { data, error } = await supabase.from(config.table).update({ is_active: active }).eq("id", id).select("id");
    if (error) return { error: friendly(error, config.noun) };
    if (!data?.length) return { error: `That ${config.noun} no longer exists.` };

    revalidate(resource);
    return { success: active ? "Activated." : "Deactivated." };
  });
}
