import type { Metadata } from "next";
import { deleteRecord, saveRecord, setActive } from "@/app/(admin)/resources/actions";
import { ActiveSwitch, DeleteRecordButton, RecordDialog } from "@/components/RecordDialog";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { RESOURCES, VIBE_OPTIONS } from "@/lib/resources";
import { listExamples } from "@/lib/studio-data";

export const metadata: Metadata = { title: "AI generation examples" };

const fields = RESOURCES.examples.fields;

export default async function ExamplesPage() {
  const { supabase } = await requireAdmin("/studio/examples");
  const examples = await listExamples(supabase);
  const active = examples.filter((e) => e.is_active).length;

  return (
    <>
      <PageHeader
        title="Examples"
        description={`Captions that landed, shown to the model as few-shot examples ({{examples}}). Up to 4 active examples matching the post's voice go into each prompt. ${active} of ${examples.length} active.`}
        actions={
          <RecordDialog title="New example" fields={fields} action={saveRecord.bind(null, "examples", null)} trigger="+ New example" submitLabel="Add example" />
        }
      />

      {examples.length === 0 ? (
        <EmptyState title="No examples yet">Add one here, or use “Save as example” on a top caption in Posts.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {examples.map((e) => {
            const vibe = VIBE_OPTIONS.find((v) => v.value === e.vibe)?.label ?? "Any voice";
            return (
              <Card key={e.id} bodyClassName="p-5" className={e.is_active ? "" : "opacity-70"}>
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-full bg-powder px-2.5 py-0.5 text-xs font-semibold text-ink">{vibe}</span>
                  <ActiveSwitch active={e.is_active} label={`Use this example`} action={setActive.bind(null, "examples", e.id)} />
                </div>
                <p className="mt-3 text-xs uppercase tracking-wider text-subtle">Photo</p>
                <p className="text-sm text-muted">{e.scene}</p>
                <p className="mt-3 text-xs uppercase tracking-wider text-subtle">Caption</p>
                <p className="serif text-xl leading-snug text-ink">“{e.caption}”</p>
                {e.notes && <p className="mt-2 text-xs text-subtle">{e.notes}</p>}
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="text-xs text-subtle">updated {timeAgo(e.updated_at)}</span>
                  <span className="flex gap-1">
                    <RecordDialog
                      title="Edit example"
                      fields={fields}
                      values={e}
                      action={saveRecord.bind(null, "examples", e.id)}
                      trigger="Edit"
                      triggerClassName="rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition hover:bg-powder hover:text-ink"
                    />
                    <DeleteRecordButton
                      action={deleteRecord.bind(null, "examples", e.id)}
                      title="Delete this example?"
                      body={<p>The model will stop seeing “{e.caption}”. The deletion is recorded in the audit log.</p>}
                    />
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
