import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorBadge, Avatar, Card, EmptyState, Score, StatCard, Thumb, VoteBadge } from "@/components/ui";
import { getUser, imageUrl } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { isUuid } from "@/lib/validate";

export const metadata: Metadata = { title: "User profile" };

export default async function UserDetailPage(props: PageProps<"/users/[id]">) {
  const { id } = await props.params;
  const { supabase } = await requireAdmin(`/users/${id}`);
  if (!isUuid(id)) notFound();

  const user = await getUser(supabase, id);
  if (!user) notFound();
  const s = user.stats;

  return (
    <>
      <Link href="/users" className="mb-4 inline-block text-sm text-muted hover:text-foreground">
        ← All users
      </Link>

      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-center">
        <Avatar src={user.avatar_url} name={user.display_name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {user.display_name}
            {user.is_superadmin && (
              <span className="rounded bg-navy px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-columbia">
                Superadmin
              </span>
            )}
          </h1>
          <p className="text-sm text-muted">{user.email}</p>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <div>
              <dt className="inline">Joined </dt>
              <dd className="inline font-medium text-foreground">{formatDate(user.joined_at)}</dd>
            </div>
            <div>
              <dt className="inline">Last sign-in </dt>
              <dd className="inline font-medium text-foreground">{formatDateTime(user.last_sign_in_at)}</dd>
            </div>
            <div>
              <dt className="inline">Sign-in method </dt>
              <dd className="inline font-medium capitalize text-foreground">{user.provider ?? "—"}</dd>
            </div>
            {!user.first_name && !user.last_name && (
              <div className="text-subtle">No name set on profile</div>
            )}
          </dl>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Photos posted" value={s.photos} />
        <StatCard label="Human captions" value={s.human_captions} accent="human" hint={`total score ${s.human_caption_score}`} />
        <StatCard label="Votes cast" value={s.votes_cast} hint={`▲${s.upvotes_cast} ▼${s.downvotes_cast}`} />
        <StatCard label="Votes received" value={s.votes_received} hint="on their human captions" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Photos" description={`${s.photos} total${s.photos > 24 ? " · latest 24" : ""}`}>
          {user.photos.length ? (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {user.photos.map((p) => (
                <li key={p.id}>
                  <Link href={`/media/${p.id}`} className="group block">
                    <Thumb src={imageUrl(p.image_path)} alt={p.context ?? ""} className="aspect-square w-full" />
                    <span className="mt-1 block text-[11px] text-muted group-hover:underline">
                      {formatDate(p.created_at)} · {p.votes} votes
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No photos posted" />
          )}
        </Card>

        <Card title="Captions written" description={`${s.human_captions} total${s.human_captions > 50 ? " · latest 50" : ""}`}>
          {user.captions.length ? (
            <ul className="divide-y divide-line">
              {user.captions.map((c) => (
                <li key={c.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Link href={`/media/${c.generation_id}`} className="min-w-0 flex-1 text-sm hover:underline">
                    “{c.text}”
                  </Link>
                  <Score score={c.score} up={c.upvotes} down={c.downvotes} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No captions written" />
          )}
        </Card>

        <Card
          className="lg:col-span-2"
          title="Voting activity"
          description={`${s.votes_cast} votes${s.votes_cast > 50 ? " · latest 50" : ""}`}
          action={
            <Link href={`/votes?user=${user.id}`} className="text-xs font-medium text-human hover:underline">
              All votes →
            </Link>
          }
          bodyClassName="p-0"
        >
          {user.votes.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <tbody className="divide-y divide-line">
                  {user.votes.map((v) => (
                    <tr key={v.caption_id}>
                      <td className="px-5 py-2.5">
                        <VoteBadge vote={v.vote} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/media/${v.generation_id}`} className="line-clamp-1 hover:underline">
                          “{v.text}”
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <AuthorBadge type={v.author_type} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right text-xs text-muted">
                        {formatDateTime(v.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5">
              <EmptyState title="No votes cast" />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
