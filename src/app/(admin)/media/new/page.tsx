import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { listChains } from "@/lib/studio-data";
import { VIBES, getDailyPrompt } from "@/lib/captions";
import { CreatePostForm } from "./CreatePostForm";

// Server actions on this page run a prompt chain, which can take a while.
export const maxDuration = 60;

export const metadata: Metadata = { title: "New AI post" };

export default async function NewMediaPage() {
  const { supabase } = await requireAdmin("/media/new");
  const chains = (await listChains(supabase)).filter((c) => c.runnable);
  return (
    <>
      <Link href="/media" className="mb-4 inline-block text-sm text-muted hover:text-foreground">
        ← All media
      </Link>
      <PageHeader title="New AI post" description="Upload a photo and let a prompt chain write four captions for it." />
      <Card className="max-w-4xl">
        <CreatePostForm
          vibes={Object.entries(VIBES).map(([value, v]) => ({ value, label: v.label }))}
          dailyPrompt={getDailyPrompt()}
          chains={chains.map((c) => ({ id: c.id, name: c.name, weight: c.weight }))}
        />
      </Card>
    </>
  );
}
