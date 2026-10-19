import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { VIBES, getDailyPrompt } from "@/lib/captions";
import { CreatePostForm } from "./CreatePostForm";

export const metadata: Metadata = { title: "New AI post" };

export default async function NewMediaPage() {
  await requireAdmin("/media/new");
  return (
    <>
      <Link href="/media" className="mb-4 inline-block text-sm text-muted hover:text-foreground">
        ← All media
      </Link>
      <PageHeader title="New AI post" description="Upload a photo and let Gemini write four captions for it." />
      <Card className="max-w-4xl">
        <CreatePostForm
          vibes={Object.entries(VIBES).map(([value, v]) => ({ value, label: v.label }))}
          dailyPrompt={getDailyPrompt()}
        />
      </Card>
    </>
  );
}
