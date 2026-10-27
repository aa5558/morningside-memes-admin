"use server";

import { revalidatePath } from "next/cache";
import type { FormResult } from "@/app/(admin)/resources/actions";
import { AdminAuthError, requireAdminAction } from "@/lib/auth";
import { dateOrNull, isUuid } from "@/lib/validate";

// The image library. Files go to the public "images" bucket (storage
// policies: superadmins only), rows to public.images (RLS: superadmins
// only for writes). Each action re-checks superadmin status and validates
// its input; the trigger on images writes the audit log.

const MAX_BYTES = 5 * 1024 * 1024;
const PATH = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

// Checks the file's actual bytes, not the type the browser claims.
function sniff(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

function text(formData: FormData, name: string, max: number) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max + 1) : "";
}

function parseFields(formData: FormData): { row?: Record<string, unknown>; fieldErrors?: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const title = text(formData, "title", 80);
  const alt = text(formData, "alt_text", 300);
  const tags = [...new Set(text(formData, "tags", 300).toLowerCase().split(/[,\s]+/).map((t) => t.replace(/^#/, "")).filter(Boolean))];
  const featuredRaw = text(formData, "featured_on", 10);
  const featured = featuredRaw ? dateOrNull(featuredRaw) : null;

  if (!title || title.length > 80) fieldErrors.title = "Give it a title (up to 80 characters).";
  if (alt.length < 3 || alt.length > 300) fieldErrors.alt_text = "Describe the photo for screen readers (3–300 characters).";
  if (tags.length > 8 || tags.some((t) => !/^[a-z0-9-]{1,24}$/.test(t))) fieldErrors.tags = "Up to 8 tags: lowercase letters, numbers, dashes.";
  if (featuredRaw && !featured) fieldErrors.featured_on = "Use a valid date.";

  if (Object.keys(fieldErrors).length) return { fieldErrors };
  return {
    row: {
      title,
      alt_text: alt,
      tags,
      featured_on: featured,
      is_active: formData.get("is_active") === "on",
    },
  };
}

function friendly(error: { code?: string; message: string }) {
  if (error.code === "23505") return "Another image is already the Daily Drop on that date.";
  if (error.code === "42501") return "Superadmin access required.";
  return "Couldn't save the image.";
}

function revalidate() {
  revalidatePath("/images");
  revalidatePath("/audit");
}

async function guard(run: () => Promise<FormResult>): Promise<FormResult> {
  try {
    return { ...(await run()), at: Date.now() };
  } catch (error) {
    if (error instanceof AdminAuthError) return { error: error.message, at: Date.now() };
    throw error;
  }
}

// CREATE: upload a new image with its details.
export async function uploadImage(_prev: FormResult, formData: FormData): Promise<FormResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload.", fieldErrors: { file: "Required." } };
    if (file.size > MAX_BYTES) return { error: "Images must be 5 MB or smaller.", fieldErrors: { file: "Too large." } };

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) return { error: "That file isn't a PNG, JPEG, or WEBP image.", fieldErrors: { file: "Unsupported file." } };

    const { row, fieldErrors } = parseFields(formData);
    if (!row) return { error: "Fix the highlighted fields.", fieldErrors };

    const path = `${crypto.randomUUID()}.${kind.ext}`;
    const { error: uploadError } = await supabase.storage.from("images").upload(path, bytes, { contentType: kind.mime });
    if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

    const { error } = await supabase
      .from("images")
      .insert({ ...row, storage_path: path, mime_type: kind.mime, byte_size: bytes.byteLength })
      .select("id");
    if (error) {
      await supabase.storage.from("images").remove([path]);
      return { error: friendly(error) };
    }

    revalidate();
    return { success: "Uploaded." };
  });
}

// UPDATE: title, alt text, tags, Daily Drop date, active.
export async function updateImage(id: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isUuid(id)) return { error: "Invalid image." };
    const { row, fieldErrors } = parseFields(formData);
    if (!row) return { error: "Fix the highlighted fields.", fieldErrors };

    const { data, error } = await supabase.from("images").update(row).eq("id", id).select("id");
    if (error) return { error: friendly(error) };
    if (!data?.length) return { error: "That image no longer exists." };

    revalidate();
    return { success: "Saved." };
  });
}

// DELETE: the row, then the file. Posts made from it keep their own copy.
export async function deleteImage(id: string): Promise<FormResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isUuid(id)) return { error: "Invalid image." };

    const { data, error } = await supabase.from("images").delete().eq("id", id).select("storage_path");
    if (error) return { error: friendly(error) };
    const path = (data?.[0] as { storage_path?: string } | undefined)?.storage_path;
    if (!path) return { error: "That image no longer exists." };

    if (PATH.test(path)) {
      const { error: storageError } = await supabase.storage.from("images").remove([path]);
      if (storageError) console.error("Library image cleanup failed", path, storageError.message);
    }
    revalidate();
    return { success: "Deleted." };
  });
}
