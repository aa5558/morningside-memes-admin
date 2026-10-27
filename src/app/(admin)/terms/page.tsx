import type { Metadata } from "next";
import { deleteRecord, saveRecord, setActive } from "@/app/(admin)/resources/actions";
import { ActiveSwitch, DeleteRecordButton, RecordDialog } from "@/components/RecordDialog";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { RESOURCES, TERM_CATEGORIES } from "@/lib/resources";
import { listTerms } from "@/lib/studio-data";
import { oneOf, param, textOrNull } from "@/lib/validate";

export const metadata: Metadata = { title: "Terms" };

const fields = RESOURCES.terms.fields;
const linkBtn = "rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition hover:bg-powder hover:text-ink";

export default async function TermsPage(props: PageProps<"/terms">) {
  const { supabase } = await requireAdmin("/terms");
  const sp = await props.searchParams;
  const category = oneOf(param(sp, "category"), ["", "campus", "nyc", "internet", "general"] as const, "");
  const q = textOrNull(param(sp, "q"), 60)?.toLowerCase() ?? null;

  const all = await listTerms(supabase);
  const terms = all.filter(
    (t) => (!category || t.category === category) && (!q || t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q))
  );

  return (
    <>
      <PageHeader
        title="Terms"
        description="A glossary of campus, city and internet terms. Active terms are sent to the model ({{terms}}) so captions get the references right, filtered to fit the post's voice."
        actions={<RecordDialog title="New term" fields={fields} action={saveRecord.bind(null, "terms", null)} trigger="+ New term" submitLabel="Add term" />}
      />

      <form method="get" className="mb-5 flex flex-wrap items-center gap-2">
        <nav aria-label="Category" className="flex flex-wrap gap-1 rounded-full bg-powder p-1 text-sm">
          {[{ value: "", label: "All" }, ...TERM_CATEGORIES].map((c) => (
            <a
              key={c.value}
              href={c.value ? `/terms?category=${c.value}` : "/terms"}
              aria-current={category === c.value ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 font-semibold transition ${category === c.value ? "bg-white text-ink shadow-[0_2px_8px_-2px_rgba(22,38,61,0.2)]" : "text-muted hover:text-ink"}`}
            >
              {c.label} <span className="tabular text-xs text-subtle">{c.value ? all.filter((t) => t.category === c.value).length : all.length}</span>
            </a>
          ))}
        </nav>
        {category && <input type="hidden" name="category" value={category} />}
        <input name="q" defaultValue={q ?? ""} placeholder="Search terms…" aria-label="Search terms" className="ml-auto rounded-full border border-[rgba(22,38,61,0.12)] bg-white px-4 py-2 text-sm outline-none focus:border-sky focus:ring-4 focus:ring-sky/25" />
      </form>

      {terms.length === 0 ? (
        <EmptyState title={all.length ? "No terms match" : "No terms yet"}>Add the slang and places your captions should know about.</EmptyState>
      ) : (
        <Card bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {terms.map((t) => (
              <li key={t.id} className={`flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start ${t.is_active ? "" : "opacity-60"}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="display text-lg text-ink">{t.term}</span>
                    <span className="rounded-full bg-powder px-2 py-0.5 text-[11px] font-semibold text-ink">{TERM_CATEGORIES.find((c) => c.value === t.category)?.label}</span>
                  </p>
                  <p className="text-sm text-muted">{t.definition}</p>
                  {t.example && <p className="mt-1 text-xs italic text-subtle">e.g. {t.example}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <ActiveSwitch active={t.is_active} label={`${t.term} active`} action={setActive.bind(null, "terms", t.id)} />
                  <RecordDialog title="Edit term" fields={fields} values={t} action={saveRecord.bind(null, "terms", t.id)} trigger="Edit" triggerClassName={linkBtn} />
                  <DeleteRecordButton action={deleteRecord.bind(null, "terms", t.id)} title={`Delete “${t.term}”?`} body={<p>The model will stop seeing this term. The deletion is recorded in the audit log.</p>} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
