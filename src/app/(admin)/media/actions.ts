"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMedia, imageUrl } from "@/lib/admin-data";
import { AdminAuthError, requireAdminAction } from "@/lib/auth";
import { getDailyPrompt, isVibe } from "@/lib/captions";
import { finishCaptionRequest, PipelineError, QUOTA_MESSAGE, runCaptionPipeline } from "@/lib/pipeline";
import { isUuid } from "@/lib/validate";

// Every action here is reachable by a direct POST, so each one re-checks
// superadmin status (requireAdminAction) and validates its own input. The
// database functions they call check is_superadmin a third time.

export type ActionResult = { error?: string; success?: string };

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const IMAGE_PATH_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/i;

const DB_ERRORS: Record<string, string> = {
  forbidden: "Superadmin access required.",
  not_signed_in: "Sign in required.",
  not_found: "That item no longer exists. Refresh the page.",
  invalid_length: "Captions must be 1–300 characters.",
  invalid_context: "Context must be 200 characters or fewer.",
  duplicate: "This photo already has a caption with that text.",
  human_caption: "Human-written captions can't be reworded by admins. Delete it instead if it breaks the rules.",
  invalid_captions: "Gemini didn't return any usable captions. Try again.",
  invalid_image_path: "The upload path was rejected.",
  invalid_vibe: "Pick a caption voice.",
  invalid_scene: "Describe the photo in 3–300 characters.",
};

function pipelineError(error: unknown) {
  if (!(error instanceof PipelineError)) return "Gemini couldn't caption that photo. Try again in a moment.";
  if (error.userMessage === QUOTA_MESSAGE) {
    return "Gemini is over its usage quota (HTTP 429), so nothing was generated or saved. Try again after the quota resets, or check the plan for GEMINI_API_KEY.";
  }
  return `Nothing was saved: ${error.message}`;
}

function dbError(error: { message: string } | null, fallback: string) {
  if (!error) return fallback;
  return DB_ERRORS[error.message] ?? fallback;
}

async function guard<T extends ActionResult>(run: () => Promise<T>): Promise<T | ActionResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AdminAuthError) return { error: error.message };
    throw error;
  }
}

function revalidateMedia(generationId?: string) {
  revalidatePath("/media");
  revalidatePath("/");
  revalidatePath("/analytics");
  if (generationId) revalidatePath(`/media/${generationId}`);
}

// CREATE: upload a photo as the signed-in admin and caption it with Gemini.
export async function createPost(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { supabase, user } = await requireAdminAction();

    const vibe = formData.get("vibe");
    const contextRaw = formData.get("context");
    const context = typeof contextRaw === "string" ? contextRaw.trim().replace(/\s+/g, " ") || null : null;
    const image = formData.get("image");

    if (!isVibe(vibe)) return { error: "Pick a caption voice." };
    if (context && context.length > 200) return { error: "Context must be 200 characters or fewer." };
    if (!(image instanceof File) || image.size === 0) return { error: "Choose a photo to upload." };
    if (!IMAGE_EXTENSIONS[image.type]) return { error: "Upload a PNG, JPEG, or WEBP image." };
    if (image.size > MAX_IMAGE_BYTES) return { error: "Images must be smaller than 4 MB." };

    const bytes = await image.arrayBuffer();
    const dailyPrompt = getDailyPrompt();
    const chainRaw = formData.get("chain");
    const chainId = isUuid(chainRaw) ? chainRaw : undefined;

    let run: Awaited<ReturnType<typeof runCaptionPipeline>>;
    try {
      run = await runCaptionPipeline(
        supabase,
        { vibe, context, dailyPrompt, image: bytes, mimeType: image.type },
        { source: "admin", chainId }
      );
    } catch (error) {
      console.error("Caption generation failed", error);
      return { error: pipelineError(error) };
    }
    const { captions, model, prompt, requestId } = run;

    const imagePath = `${user.id}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[image.type]}`;
    const { error: uploadError } = await supabase.storage
      .from("generations")
      .upload(imagePath, bytes, { contentType: image.type });
    if (uploadError) {
      await finishCaptionRequest(supabase, requestId, false, uploadError.message);
      return { error: `Upload failed: ${uploadError.message}` };
    }

    const { data: id, error } = await supabase.rpc("admin_create_generation", {
      p_image_path: imagePath,
      p_context: context,
      p_vibe: vibe,
      p_daily_prompt: dailyPrompt,
      p_model: model,
      p_prompt: prompt,
      p_captions: captions,
    });

    if (error || !isUuid(id)) {
      await supabase.storage.from("generations").remove([imagePath]);
      await finishCaptionRequest(supabase, requestId, false, error?.message ?? "save failed");
      return { error: dbError(error, "Couldn't save the post.") };
    }
    await finishCaptionRequest(supabase, requestId, true, undefined, id);

    revalidateMedia();
    redirect(`/media/${id}?created=1`);
  });
}

// CREATE: new Gemini captions for any existing photo, using its original
// voice, context, and challenge prompt. With a chain id, runs that chain
// (handy for comparing chains on the same photo); otherwise the mix picks.
export async function generateMoreCaptions(generationId: string, chainId?: string | null): Promise<ActionResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isUuid(generationId)) return { error: "Invalid post." };
    if (chainId !== undefined && chainId !== null && !isUuid(chainId)) return { error: "Invalid chain." };

    const post = await getMedia(supabase, generationId);
    if (!post) return { error: DB_ERRORS.not_found };
    if (!IMAGE_PATH_PATTERN.test(post.image_path)) return { error: "This post's photo path looks wrong." };
    if (!isVibe(post.vibe)) return { error: "This post has an unknown caption voice." };

    const photo = await fetch(imageUrl(post.image_path));
    const mimeType = photo.headers.get("content-type")?.split(";")[0] ?? "";
    if (!photo.ok || !IMAGE_EXTENSIONS[mimeType]) return { error: "Couldn't load the photo from storage." };
    const bytes = await photo.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) return { error: "The stored photo is too large to caption." };

    let run: Awaited<ReturnType<typeof runCaptionPipeline>>;
    try {
      run = await runCaptionPipeline(
        supabase,
        {
          vibe: post.vibe,
          context: post.context,
          dailyPrompt: post.daily_prompt ?? getDailyPrompt(post.challenge_date),
          imagePrompt: post.image_source === "ai" ? post.image_prompt : null,
          image: bytes,
          mimeType,
        },
        { source: "admin", chainId: chainId ?? undefined, generationId }
      );
    } catch (error) {
      console.error("Caption generation failed", error);
      return { error: pipelineError(error) };
    }

    const { data: added, error } = await supabase.rpc("admin_add_ai_captions", {
      p_generation: generationId,
      p_captions: run.captions,
      p_model: run.model,
      p_prompt: run.prompt,
    });
    if (error) {
      await finishCaptionRequest(supabase, run.requestId, false, error.message);
      return { error: dbError(error, "Couldn't save the captions.") };
    }
    await finishCaptionRequest(supabase, run.requestId, true, undefined, generationId);

    revalidateMedia(generationId);
    revalidatePath("/studio");
    return {
      success: `Added ${added} new caption${added === 1 ? "" : "s"} with the “${run.chain}” chain.${
        added < run.captions.length ? " Duplicates of existing captions were skipped." : ""
      }`,
    };
  });
}

// UPDATE: reword an AI caption.
export async function updateCaption(captionId: string, generationId: string, text: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isUuid(captionId) || !isUuid(generationId)) return { error: "Invalid caption." };
    const trimmed = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
    if (trimmed.length < 1 || trimmed.length > 300) return { error: DB_ERRORS.invalid_length };

    const { error } = await supabase.rpc("admin_update_caption", { p_caption: captionId, p_text: trimmed });
    if (error) return { error: dbError(error, "Couldn't save the caption.") };

    revalidateMedia(generationId);
    return { success: "Caption updated." };
  });
}

// UPDATE: a post's context line.
export async function updateContext(generationId: string, context: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isUuid(generationId)) return { error: "Invalid post." };
    const trimmed = typeof context === "string" ? context.trim().replace(/\s+/g, " ") : "";
    if (trimmed.length > 200) return { error: DB_ERRORS.invalid_context };

    const { error } = await supabase.rpc("admin_update_generation", {
      p_generation: generationId,
      p_context: trimmed || null,
    });
    if (error) return { error: dbError(error, "Couldn't save the context.") };

    revalidateMedia(generationId);
    return { success: "Context updated." };
  });
}

// DELETE: one caption and the votes on it.
export async function deleteCaption(captionId: string, generationId: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isUuid(captionId) || !isUuid(generationId)) return { error: "Invalid caption." };

    const { error } = await supabase.rpc("admin_delete_caption", { p_caption: captionId });
    if (error) return { error: dbError(error, "Couldn't delete the caption.") };

    revalidateMedia(generationId);
    return { success: "Caption deleted." };
  });
}

// DELETE: a whole post, its captions and votes, and its photo file.
export async function deletePost(generationId: string): Promise<ActionResult> {
  const result = await guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isUuid(generationId)) return { error: "Invalid post." };

    const { data: imagePath, error } = await supabase.rpc("admin_delete_generation", {
      p_generation: generationId,
    });
    if (error) return { error: dbError(error, "Couldn't delete the post.") };

    if (typeof imagePath === "string" && IMAGE_PATH_PATTERN.test(imagePath)) {
      const { error: storageError } = await supabase.storage.from("generations").remove([imagePath]);
      if (storageError) console.error("Photo cleanup failed", imagePath, storageError.message);
    }

    revalidateMedia(generationId);
    return { success: "deleted" };
  });

  if (result.success === "deleted") redirect("/media?deleted=1");
  return result;
}

// CREATE an AI generation example from a real caption.
export async function promoteToExample(captionId: string, generationId: string, scene: string): Promise<ActionResult> {
  return guard(async () => {
    const { supabase } = await requireAdminAction();
    if (!isUuid(captionId) || !isUuid(generationId)) return { error: "Invalid caption." };
    const trimmed = typeof scene === "string" ? scene.trim().replace(/\s+/g, " ") : "";
    if (trimmed.length < 3 || trimmed.length > 300) return { error: DB_ERRORS.invalid_scene };

    const { error } = await supabase.rpc("admin_promote_caption_to_example", { p_caption: captionId, p_scene: trimmed });
    if (error) return { error: dbError(error, "Couldn't save the example.") };

    revalidatePath("/studio/examples");
    revalidatePath("/audit");
    return { success: "Saved as an example. The model will see it on posts in this voice." };
  });
}
