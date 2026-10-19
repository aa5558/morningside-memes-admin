import type { Metadata } from "next";
import Link from "next/link";
import { Avatar, Card, EmptyState, Field, FilterBar, PageHeader, Pagination, fieldClass } from "@/components/ui";
import { listUsers } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatNumber, timeAgo } from "@/lib/format";
import { oneOf, pageNumber, param, textOrNull, type SearchParams } from "@/lib/validate";

export const metadata: Metadata = { title: "Users" };

const PAGE_SIZE = 25;
const SORTS = ["joined", "name", "activity", "last_seen"] as const;

export default async function UsersPage(props: PageProps<"/users">) {
  const { supabase } = await requireAdmin("/users");
  const searchParams = (await props.searchParams) as SearchParams;
  const q = textOrNull(param(searchParams, "q"));
  const sort = oneOf(param(searchParams, "sort"), SORTS, "joined");
  const page = pageNumber(param(searchParams, "page"));

  const users = await listUsers(supabase, {
    p_search: q,
    p_sort: sort,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const total = users[0]?.total_count ?? 0;

  const href = (p: number) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (sort !== "joined") qs.set("sort", sort);
    qs.set("page", String(p));
    return `/users?${qs}`;
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with a Morningside Memes account. Read-only: profiles are edited by their owners in the main app."
      />

      <FilterBar resetHref="/users">
        <Field label="Search by name or email">
          <input name="q" defaultValue={q ?? ""} placeholder="e.g. Alex" className={`${fieldClass} w-64 max-w-full`} />
        </Field>
        <Field label="Sort by">
          <select name="sort" defaultValue={sort} className={fieldClass}>
            <option value="joined">Newest members</option>
            <option value="name">Name</option>
            <option value="activity">Most active</option>
            <option value="last_seen">Last sign-in</option>
          </select>
        </Field>
      </FilterBar>

      <Card bodyClassName="p-0">
        {users.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No users match">Try a different name.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line text-left text-xs font-medium text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-3 py-3 font-medium">Joined</th>
                  <th className="px-3 py-3 font-medium">Last sign-in</th>
                  <th className="px-3 py-3 text-right font-medium">Photos</th>
                  <th className="px-3 py-3 text-right font-medium">Captions</th>
                  <th className="px-5 py-3 text-right font-medium">Votes cast</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id} className="transition hover:bg-background">
                    <td className="px-5 py-3">
                      <Link href={`/users/${u.id}`} className="flex items-center gap-3">
                        <Avatar src={u.avatar_url} name={u.display_name} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 font-medium hover:underline">
                            {u.display_name}
                            {u.is_superadmin && (
                              <span className="orb rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
                                Admin
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted">{u.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted">{formatDate(u.joined_at)}</td>
                    <td className="px-3 py-3 text-muted">{u.last_sign_in_at ? timeAgo(u.last_sign_in_at) : "—"}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(u.photos)}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(u.human_captions)}</td>
                    <td className="px-5 py-3 text-right">
                      {formatNumber(u.votes_cast)}
                      <span className="ml-2 text-xs text-subtle">
                        ▲{u.upvotes_cast} ▼{u.downvotes_cast}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} href={href} />
    </>
  );
}
