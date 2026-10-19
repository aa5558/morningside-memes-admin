import type { Metadata } from "next";
import Link from "next/link";
import { AuthorBadge, Card, EmptyState, Field, FilterBar, PageHeader, Pagination, Score, Thumb, fieldClass } from "@/components/ui";
import { getUserOptions, imageUrl, listCaptions, listMedia } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import { dateOrNull, oneOf, pageNumber, param, textOrNull, uuidOrNull, type SearchParams } from "@/lib/validate";

export const metadata: Metadata = { title: "Media" };

const POST_SORTS = ["newest", "oldest", "popular", "score"] as const;
const CAPTION_SORTS = ["newest", "oldest", "score", "lowest", "popular"] as const;
const POSTS_PAGE = 24;
const CAPTIONS_PAGE = 50;

export default async function MediaPage(props: PageProps<"/media">) {
  const { supabase } = await requireAdmin("/media");
  const sp = (await props.searchParams) as SearchParams;

  const view = oneOf(param(sp, "view"), ["posts", "captions"] as const, "posts");
  const q = textOrNull(param(sp, "q"));
  const user = uuidOrNull(param(sp, "user"));
  const from = dateOrNull(param(sp, "from"));
  const to = dateOrNull(param(sp, "to"));
  const page = pageNumber(param(sp, "page"));
  const deleted = param(sp, "deleted") === "1";

  const postType = oneOf(param(sp, "type"), ["", "human", "ai_only"] as const, "");
  const captionType = oneOf(param(sp, "type"), ["", "ai", "human"] as const, "");
  const sort =
    view === "posts"
      ? oneOf(param(sp, "sort"), POST_SORTS, "newest")
      : oneOf(param(sp, "sort"), CAPTION_SORTS, "newest");

  const users = await getUserOptions(supabase);

  const qs = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = {
      view,
      q,
      user,
      from,
      to,
      type: view === "posts" ? postType : captionType,
      sort,
      ...overrides,
    };
    for (const [k, v] of Object.entries(base)) if (v) params.set(k, v);
    return `/media?${params}`;
  };

  const tabs = (
    <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
      {(["posts", "captions"] as const).map((v) => (
        <Link
          key={v}
          role="tab"
          aria-selected={view === v}
          href={`/media?view=${v}`}
          className={`rounded-md px-3 py-1.5 font-medium capitalize ${
            view === v ? "bg-navy text-white dark:bg-columbia dark:text-navy" : "text-muted hover:text-foreground"
          }`}
        >
          {v}
        </Link>
      ))}
    </div>
  );

  const filters = (
    <FilterBar resetHref={`/media?view=${view}`}>
      <input type="hidden" name="view" value={view} />
      <Field label={view === "posts" ? "Search context, prompts & captions" : "Search caption text"}>
        <input name="q" defaultValue={q ?? ""} placeholder="Search…" className={`${fieldClass} w-56 max-w-full`} />
      </Field>
      <Field label={view === "posts" ? "Posted by" : "User"}>
        <select name="user" defaultValue={user ?? ""} className={`${fieldClass} max-w-48`}>
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="From">
        <input type="date" name="from" defaultValue={from ?? ""} className={fieldClass} />
      </Field>
      <Field label="To">
        <input type="date" name="to" defaultValue={to ?? ""} className={fieldClass} />
      </Field>
      <Field label="Caption type">
        {view === "posts" ? (
          <select name="type" defaultValue={postType} className={fieldClass}>
            <option value="">All posts</option>
            <option value="human">Has human captions (battles)</option>
            <option value="ai_only">Gemini captions only</option>
          </select>
        ) : (
          <select name="type" defaultValue={captionType} className={fieldClass}>
            <option value="">Human & Gemini</option>
            <option value="ai">Gemini only</option>
            <option value="human">Human only</option>
          </select>
        )}
      </Field>
      <Field label="Sort">
        {view === "posts" ? (
          <select name="sort" defaultValue={sort} className={fieldClass}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="popular">Most votes</option>
            <option value="score">Best caption score</option>
          </select>
        ) : (
          <select name="sort" defaultValue={sort} className={fieldClass}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="score">Highest score</option>
            <option value="lowest">Lowest score</option>
            <option value="popular">Most votes</option>
          </select>
        )}
      </Field>
    </FilterBar>
  );

  return (
    <>
      <PageHeader
        title="Media"
        description="Every photo and caption in Morningside Memes. Open a post to edit, generate, or delete."
        actions={
          <>
            {tabs}
            <Link
              href="/media/new"
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-[#123d77] dark:bg-columbia dark:text-navy"
            >
              + New AI post
            </Link>
          </>
        }
      />
      {deleted && (
        <p role="status" className="mb-4 rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
          Post deleted, along with its captions, votes, and photo file.
        </p>
      )}
      {filters}
      {view === "posts" ? (
        <PostsGrid
          rows={await listMedia(supabase, {
            p_search: q,
            p_user: user,
            p_from: from,
            p_to: to,
            p_caption_type: postType || null,
            p_sort: sort,
            p_limit: POSTS_PAGE,
            p_offset: (page - 1) * POSTS_PAGE,
          })}
          page={page}
          href={(p) => qs({ page: String(p) })}
        />
      ) : (
        <CaptionsTable
          rows={await listCaptions(supabase, {
            p_search: q,
            p_user: user,
            p_from: from,
            p_to: to,
            p_author_type: captionType || null,
            p_sort: sort,
            p_limit: CAPTIONS_PAGE,
            p_offset: (page - 1) * CAPTIONS_PAGE,
          })}
          page={page}
          href={(p) => qs({ page: String(p) })}
        />
      )}
    </>
  );
}

function PostsGrid({
  rows,
  page,
  href,
}: {
  rows: Awaited<ReturnType<typeof listMedia>>;
  page: number;
  href: (page: number) => string;
}) {
  if (!rows.length) return <EmptyState title="No posts match these filters" />;
  return (
    <>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((m) => (
          <li key={m.id}>
            <Link
              href={`/media/${m.id}`}
              className="group block overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(11,45,91,0.04)] transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative">
                <Thumb src={imageUrl(m.image_path)} alt={m.context ?? ""} className="aspect-square w-full rounded-none" />
                {m.human_captions > 0 && (
                  <span className="absolute left-2 top-2 rounded-full bg-navy/85 px-2 py-0.5 text-[10px] font-semibold text-columbia">
                    ⚔️ Battle
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="line-clamp-1 text-sm font-medium">{m.context || m.daily_prompt || "Untitled post"}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {m.owner_name} · {formatDate(m.created_at)}
                </p>
                <div className="tabular mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  <span>
                    <span className="text-ai">●</span> {m.ai_captions} AI
                  </span>
                  <span>
                    <span className="text-human">●</span> {m.human_captions} human
                  </span>
                  <span>{formatNumber(m.votes)} votes</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageSize={POSTS_PAGE} total={rows[0]?.total_count ?? 0} href={href} />
    </>
  );
}

function CaptionsTable({
  rows,
  page,
  href,
}: {
  rows: Awaited<ReturnType<typeof listCaptions>>;
  page: number;
  href: (page: number) => string;
}) {
  if (!rows.length) return <EmptyState title="No captions match these filters" />;
  return (
    <>
      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Caption</th>
                <th className="px-3 py-3 font-medium">Author</th>
                <th className="px-3 py-3 font-medium">Created</th>
                <th className="px-5 py-3 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-black/2 dark:hover:bg-white/3">
                  <td className="px-5 py-2.5">
                    <Link href={`/media/${c.generation_id}`} className="flex items-center gap-3">
                      <Thumb src={imageUrl(c.image_path)} alt="" className="h-9 w-9" />
                      <span className="line-clamp-2 hover:underline">“{c.text}”</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <AuthorBadge type={c.author_type} />
                      <span className="text-xs text-muted">
                        {c.author_type === "human" ? c.author_name : `on ${c.author_name}'s photo`}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{formatDate(c.created_at)}</td>
                  <td className="px-5 py-2.5 text-right">
                    <Score score={c.score} up={c.upvotes} down={c.downvotes} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Pagination page={page} pageSize={CAPTIONS_PAGE} total={rows[0]?.total_count ?? 0} href={href} />
    </>
  );
}
