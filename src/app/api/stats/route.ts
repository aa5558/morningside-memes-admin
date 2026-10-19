import { NextResponse, type NextRequest } from "next/server";
import { getDashboardStats } from "@/lib/admin-data";
import { requireAdminApi } from "@/lib/auth";
import { oneOf } from "@/lib/validate";

export const dynamic = "force-dynamic";

// GET /api/stats?days=7|30|90 — the dashboard numbers as JSON, superadmins only.
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const days = Number(oneOf(request.nextUrl.searchParams.get("days"), ["7", "30", "90"] as const, "30"));
  try {
    return NextResponse.json(await getDashboardStats(auth.supabase, days), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Couldn't load stats." }, { status: 500 });
  }
}
