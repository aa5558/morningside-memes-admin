import type { Metadata } from "next";
import { DeleteRecordButton } from "@/components/RecordDialog";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { libraryUrl, listImages } from "@/lib/studio-data";
import { deleteImage, updateImage, uploadImage } from "./actions";
import { ImageDialog } from "./ImageDialog";

export const metadata: Metadata = { title: "Image library" };

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export default async function ImagesPage() {
  const { supabase } = await requireAdmin("/images");
  const images = await listImages(supabase);
  const day = today();
  const drop = images.find((i) => i.featured_on === day);
  const upcoming = images.filter((i) => i.featured_on && i.featured_on > day).sort((a, b) => a.featured_on!.localeCompare(b.featured_on!));

  return (
    <>
      <PageHeader
        title="Image library"
        description="Hand-picked photos for the main app. Schedule one as the Daily Drop, and active images show up in Surprise Me and the Meme Studio for anyone to caption."
        actions={<ImageDialog mode="upload" action={uploadImage} trigger="+ Upload image" triggerClassName="btn btn-primary" />}
      />

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <span className={`rounded-full px-3.5 py-1.5 font-semibold ${drop ? "bg-butter text-butter-ink" : "bg-[#ffede6] text-down-ink"}`}>
          {drop ? `Today's drop: ${drop.title}` : "No Daily Drop today"}
        </span>
        <span className="rounded-full bg-powder px-3.5 py-1.5 font-semibold text-ink">
          {upcoming.length ? `${upcoming.length} scheduled · next ${formatDay(upcoming[0].featured_on!)}` : "Nothing scheduled"}
        </span>
        <span className="rounded-full bg-white px-3.5 py-1.5 text-muted ring-1 ring-line">
          {images.filter((i) => i.is_active).length} of {images.length} visible
        </span>
      </div>

      {images.length === 0 ? (
        <EmptyState title="The library is empty">Upload a photo to start scheduling Daily Drops.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {images.map((image) => {
            const url = libraryUrl(image.storage_path);
            const isDrop = image.featured_on === day;
            const future = image.featured_on && image.featured_on > day;
            return (
              <article key={image.id} className={`overflow-hidden rounded-[26px] border border-line bg-surface p-2 ${image.is_active ? "" : "opacity-60"}`}>
                <div className="relative overflow-hidden rounded-[20px] bg-powder">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={image.alt_text} loading="lazy" className="w-full" />
                  <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                    {isDrop && <span className="rounded-full bg-butter px-2.5 py-1 text-[11px] font-bold text-butter-ink">★ today&apos;s drop</span>}
                    {future && <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-ink">drops {formatDay(image.featured_on!)}</span>}
                    {!image.is_active && <span className="rounded-full bg-ink/80 px-2.5 py-1 text-[11px] font-semibold text-white">hidden</span>}
                  </div>
                </div>
                <div className="px-2.5 pb-2 pt-3">
                  <p className="display text-lg text-ink">{image.title}</p>
                  <p className="line-clamp-2 text-xs text-muted">{image.alt_text}</p>
                  {image.tags.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1">
                      {image.tags.map((t) => (
                        <span key={t} className="rounded-full bg-powder px-2 py-0.5 text-[11px] text-ink">
                          #{t}
                        </span>
                      ))}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
                    <span className="text-xs text-subtle">
                      {image.posts} {image.posts === 1 ? "post" : "posts"} · {image.captions} captions · {Math.round(image.byte_size / 1024)} KB
                    </span>
                    <span className="flex gap-1">
                      <ImageDialog
                        mode="edit"
                        action={updateImage.bind(null, image.id)}
                        values={{ ...image, url }}
                        trigger="Edit"
                        triggerClassName="rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition hover:bg-powder hover:text-ink"
                      />
                      <DeleteRecordButton
                        action={deleteImage.bind(null, image.id)}
                        title={`Delete “${image.title}”?`}
                        body={<p>Removes the file from storage. {image.posts ? `The ${image.posts} post(s) made from it keep their own copy. ` : ""}Recorded in the audit log.</p>}
                      />
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
