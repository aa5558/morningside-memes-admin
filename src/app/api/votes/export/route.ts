import { NextResponse, type NextRequest } from "next/server";
import { listVotes } from "@/lib/admin-data";
import { requireAdminApi } from "@/lib/auth";
import { parseVoteFilters } from "@/lib/vote-filters";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

// Quotes a CSV cell and defuses spreadsheet formulas (=, +, -, @).
function cell(value: unknown) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// GET /api/votes/export?user=&caption=&type=&from=&to=&q= — superadmins only.
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const filters = parseVoteFilters((k) => request.nextUrl.searchParams.get(k));
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
    const page = await listVotes(auth.supabase, filters, { p_limit: 1000, p_offset: offset });
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const header = ["vote", "voter_id", "voter_name", "caption_id", "caption_text", "author_type", "generation_id", "created_at", "updated_at"];
  const lines = [
    header.join(","),
    ...rows.map((v) =>
      [v.vote === 1 ? "up" : "down", v.voter_id, v.voter_name, v.caption_id, v.caption_text, v.author_type, v.generation_id, v.created_at, v.updated_at]
        .map(cell)
        .join(",")
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="morningside-votes-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
