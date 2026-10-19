import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Typed wrappers for the admin_* database functions (see
// supabase/migrations/20261019000000_admin_dashboard.sql). Each function
// checks is_superadmin itself, so these only ever return data to admins.

export type AuthorType = "ai" | "human";

export type DailyPoint = {
  day: string;
  active_users: number;
  new_users: number;
  photos: number;
  human_captions: number;
  upvotes: number;
  downvotes: number;
};

export type CaptionHighlight = {
  id: string;
  text: string;
  author_type?: AuthorType;
  author_name?: string | null;
  vibe?: string;
  score: number;
  upvotes: number;
  downvotes: number;
  generation_id: string;
  image_path: string;
};

export type DashboardStats = {
  range_days: number;
  range_start: string;
  today: string;
  totals: {
    users: number;
    photos: number;
    ai_captions: number;
    human_captions: number;
    votes: number;
    upvotes: number;
    downvotes: number;
    superadmins: number;
  };
  period: {
    new_users: number;
    photos: number;
    human_captions: number;
    votes: number;
    active_users: number;
  };
  daily: DailyPoint[];
  human_vs_ai: {
    human_votes: number;
    ai_votes: number;
    human_upvotes: number;
    ai_upvotes: number;
    human_avg_score: number | null;
    ai_avg_score: number | null;
    human_avg_score_voted: number | null;
    ai_avg_score_voted: number | null;
    battles: number;
    human_wins: number;
    ai_wins: number;
  };
  top_captions: CaptionHighlight[];
  top_human_captions: CaptionHighlight[];
  top_ai_captions: CaptionHighlight[];
  popular_posts: {
    id: string;
    image_path: string;
    context: string | null;
    daily_prompt: string | null;
    created_at: string;
    owner_name: string;
    captions: number;
    votes: number;
    upvotes: number;
  }[];
  active_users: {
    id: string;
    name: string;
    avatar_url: string | null;
    photos: number;
    captions: number;
    votes: number;
  }[];
  recent_activity: {
    kind: "photo" | "caption" | "upvote" | "downvote";
    happened_at: string;
    who: string;
    what: string | null;
    generation_id: string;
  }[];
};

export type UserRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  is_superadmin: boolean;
  joined_at: string;
  last_sign_in_at: string | null;
  photos: number;
  human_captions: number;
  votes_cast: number;
  upvotes_cast: number;
  downvotes_cast: number;
  total_count: number;
};

export type UserDetail = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  is_superadmin: boolean;
  joined_at: string;
  last_sign_in_at: string | null;
  provider: string | null;
  stats: {
    photos: number;
    human_captions: number;
    human_caption_score: number;
    votes_cast: number;
    upvotes_cast: number;
    downvotes_cast: number;
    votes_received: number;
  };
  photos: {
    id: string;
    image_path: string;
    context: string | null;
    daily_prompt: string | null;
    created_at: string;
    captions: number;
    votes: number;
  }[];
  captions: {
    id: string;
    text: string;
    score: number;
    upvotes: number;
    downvotes: number;
    created_at: string;
    generation_id: string;
  }[];
  votes: {
    caption_id: string;
    vote: 1 | -1;
    created_at: string;
    updated_at: string;
    text: string;
    author_type: AuthorType;
    generation_id: string;
  }[];
};

export type MediaRow = {
  id: string;
  image_path: string;
  image_source: "upload" | "ai";
  context: string | null;
  vibe: string;
  daily_prompt: string | null;
  model: string;
  challenge_date: string;
  created_at: string;
  owner_id: string;
  owner_name: string;
  ai_captions: number;
  human_captions: number;
  votes: number;
  upvotes: number;
  best_score: number | null;
  total_count: number;
};

export type CaptionRow = {
  id: string;
  generation_id: string;
  text: string;
  author_type: AuthorType;
  author_id: string;
  author_name: string;
  upvotes: number;
  downvotes: number;
  score: number;
  created_at: string;
  image_path: string;
  total_count: number;
};

export type MediaDetail = {
  id: string;
  image_path: string;
  image_source: "upload" | "ai";
  image_prompt: string | null;
  context: string | null;
  vibe: string;
  daily_prompt: string | null;
  challenge_date: string;
  model: string;
  prompt: string;
  created_at: string;
  owner_id: string;
  owner_name: string;
  captions: {
    id: string;
    text: string;
    author_type: AuthorType;
    author_id: string;
    author_name: string;
    upvotes: number;
    downvotes: number;
    score: number;
    created_at: string;
    extra_prompt: string | null;
    extra_model: string | null;
    generated_by: string | null;
  }[];
  history: {
    action: string;
    details: Record<string, unknown>;
    created_at: string;
    admin_name: string | null;
  }[];
};

export type VoteRow = {
  voter_id: string;
  voter_name: string;
  caption_id: string;
  caption_text: string;
  author_type: AuthorType;
  generation_id: string;
  image_path: string;
  vote: 1 | -1;
  created_at: string;
  updated_at: string;
  total_count: number;
};

export type VoteStats = {
  total: number;
  upvotes: number;
  downvotes: number;
  voters: number;
  captions: number;
  on_human: number;
  on_ai: number;
  changed: number;
  daily: { day: string; upvotes: number; downvotes: number }[];
};

export type AuditRow = {
  id: number;
  admin_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type VoteFilters = {
  p_user: string | null;
  p_caption: string | null;
  p_vote: 1 | -1 | null;
  p_from: string | null;
  p_to: string | null;
  p_search: string | null;
};

// Errors are thrown (and shown by the error boundary) rather than rendered
// as empty data, so a failure never looks like "zero users".
function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Couldn't load ${what}: ${result.error.message}`);
  return result.data as T;
}

export async function getDashboardStats(supabase: SupabaseClient, days: number) {
  return unwrap<DashboardStats>(
    await supabase.rpc("admin_dashboard_stats", { p_days: days }),
    "dashboard stats"
  );
}

export async function listUsers(
  supabase: SupabaseClient,
  args: { p_search: string | null; p_sort: string; p_limit: number; p_offset: number }
) {
  return unwrap<UserRow[]>(await supabase.rpc("admin_list_users", args), "users") ?? [];
}

export async function getUser(supabase: SupabaseClient, id: string) {
  return unwrap<UserDetail | null>(await supabase.rpc("admin_get_user", { p_user: id }), "user");
}

export async function getUserOptions(supabase: SupabaseClient) {
  return (
    unwrap<{ id: string; display_name: string }[]>(
      await supabase.rpc("admin_user_options"),
      "user list"
    ) ?? []
  );
}

export async function listMedia(
  supabase: SupabaseClient,
  args: {
    p_search: string | null;
    p_user: string | null;
    p_from: string | null;
    p_to: string | null;
    p_caption_type: string | null;
    p_sort: string;
    p_limit: number;
    p_offset: number;
  }
) {
  return unwrap<MediaRow[]>(await supabase.rpc("admin_list_media", args), "media") ?? [];
}

export async function listCaptions(
  supabase: SupabaseClient,
  args: {
    p_search: string | null;
    p_user: string | null;
    p_from: string | null;
    p_to: string | null;
    p_author_type: AuthorType | null;
    p_sort: string;
    p_limit: number;
    p_offset: number;
  }
) {
  return unwrap<CaptionRow[]>(await supabase.rpc("admin_list_captions", args), "captions") ?? [];
}

export async function getMedia(supabase: SupabaseClient, id: string) {
  return unwrap<MediaDetail | null>(
    await supabase.rpc("admin_get_media", { p_generation: id }),
    "post"
  );
}

export async function listVotes(
  supabase: SupabaseClient,
  filters: VoteFilters,
  page: { p_limit: number; p_offset: number }
) {
  return (
    unwrap<VoteRow[]>(await supabase.rpc("admin_list_votes", { ...filters, ...page }), "votes") ??
    []
  );
}

export async function getVoteStats(supabase: SupabaseClient, filters: VoteFilters) {
  return unwrap<VoteStats>(await supabase.rpc("admin_vote_stats", filters), "vote stats");
}

export async function listAudit(supabase: SupabaseClient, limit: number) {
  return (
    unwrap<AuditRow[]>(await supabase.rpc("admin_list_audit", { p_limit: limit }), "audit log") ??
    []
  );
}

export function imageUrl(imagePath: string) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/generations/${imagePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export const MAIN_APP_URL =
  process.env.MAIN_APP_URL ?? "https://hello-world-nextjs-eight-blue.vercel.app";
