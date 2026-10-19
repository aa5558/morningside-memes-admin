import type { VoteFilters } from "@/lib/admin-data";
import { dateOrNull, oneOf, textOrNull, uuidOrNull } from "@/lib/validate";

// Shared by the /votes page and the CSV export so both apply identical,
// validated filters.
export function parseVoteFilters(get: (key: string) => string | undefined | null): VoteFilters {
  const type = oneOf(get("type") ?? "", ["", "up", "down"] as const, "");
  return {
    p_user: uuidOrNull(get("user")),
    p_caption: uuidOrNull(get("caption")),
    p_vote: type === "up" ? 1 : type === "down" ? -1 : null,
    p_from: dateOrNull(get("from")),
    p_to: dateOrNull(get("to")),
    p_search: textOrNull(get("q")),
  };
}

export function voteFiltersToQuery(f: VoteFilters) {
  const params = new URLSearchParams();
  if (f.p_user) params.set("user", f.p_user);
  if (f.p_caption) params.set("caption", f.p_caption);
  if (f.p_vote) params.set("type", f.p_vote === 1 ? "up" : "down");
  if (f.p_from) params.set("from", f.p_from);
  if (f.p_to) params.set("to", f.p_to);
  if (f.p_search) params.set("q", f.p_search);
  return params;
}
