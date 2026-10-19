import type { Metadata } from "next";
import Link from "next/link";
import { auditLabel, auditLink } from "@/components/sections";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listAudit } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

function summary(details: Record<string, unknown>) {
  if ("old_text" in details) return `“${details.old_text}” → “${details.new_text}”`;
  if ("old_context" in details) return `${details.old_context ?? "(none)"} → ${details.new_context ?? "(none)"}`;
  if ("text" in details) return `“${details.text}” (${details.author_type}, ▲${details.upvotes} ▼${details.downvotes})`;
  if ("captions" in details && "votes" in details) return `${details.captions} captions, ${details.votes} votes removed`;
  if ("caption_ids" in details) return `${(details.caption_ids as unknown[]).length} captions · ${details.model}`;
  if ("captions" in details) return `${details.captions} captions · ${details.model}`;
  return "";
}

export default async function AuditPage() {
  const { supabase } = await requireAdmin("/audit");
  const rows = await listAudit(supabase, 200);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every create, edit, and delete made through this dashboard, with the previous values. Written by the database itself; it can't be edited or cleared from the app."
      />
      <Card bodyClassName="p-0">
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Nothing logged yet" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-3 py-3 font-medium">Admin</th>
                  <th className="px-3 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const href = auditLink(row);
                  return (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">{formatDateTime(row.created_at)}</td>
                      <td className="px-3 py-2.5">{row.admin_name ?? "Deleted admin"}</td>
                      <td className="px-3 py-2.5">
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {auditLabel(row.action)}
                          </Link>
                        ) : (
                          auditLabel(row.action)
                        )}
                      </td>
                      <td className="max-w-md px-5 py-2.5 text-xs text-muted">
                        <span className="line-clamp-2">{summary(row.details)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
