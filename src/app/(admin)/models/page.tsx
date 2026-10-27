import type { Metadata } from "next";
import { deleteRecord, saveRecord, setActive } from "@/app/(admin)/resources/actions";
import { ActiveSwitch, DeleteRecordButton, RecordDialog } from "@/components/RecordDialog";
import { seconds } from "@/components/studio";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { RESOURCES, type Field } from "@/lib/resources";
import { getAiStats, keyConfigured, listChains, listProvidersAndModels } from "@/lib/studio-data";

export const metadata: Metadata = { title: "Models & providers" };

const linkBtn = "rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition hover:bg-powder hover:text-ink";

export default async function ModelsPage() {
  const { supabase } = await requireAdmin("/models");
  const [{ providers, models }, stats, chains] = await Promise.all([
    listProvidersAndModels(supabase),
    getAiStats(supabase, 30),
    listChains(supabase),
  ]);

  const modelFields: Field[] = RESOURCES.models.fields.map((f) =>
    f.name === "provider_id" && f.type === "select" ? { ...f, options: providers.map((p) => ({ value: p.id, label: p.name })) } : f
  );
  const usage = new Map(stats.models.map((m) => [m.model_key, m]));
  const usedBy = new Map<string, string[]>();
  for (const chain of chains) for (const step of chain.steps) usedBy.set(step.model_id, [...(usedBy.get(step.model_id) ?? []), `${chain.name} · step ${step.position}`]);

  return (
    <>
      <PageHeader
        title="Models & providers"
        description="The models prompt-chain steps can call, and who serves them. API keys never live in the database: a provider names the server environment variable that holds its key."
        actions={
          providers.length > 0 && <RecordDialog title="New model" fields={modelFields} action={saveRecord.bind(null, "models", null)} trigger="+ New model" submitLabel="Add model" />
        }
      />

      <h2 className="display mb-3 text-2xl">Models</h2>
      {models.length === 0 ? (
        <EmptyState title="No models yet">Add a provider first, then a model.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {models.map((m) => {
            const provider = providers.find((p) => p.id === m.provider_id);
            const u = usage.get(m.model_key);
            const chainsUsing = usedBy.get(m.id) ?? [];
            const callable = m.is_active && provider?.is_active && provider.adapter === "gemini";
            return (
              <Card key={m.id} bodyClassName="p-5" className={m.is_active ? "" : "opacity-70"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="display text-xl text-ink">{m.display_name}</p>
                    <p className="truncate font-mono text-xs text-muted">{m.model_key}</p>
                  </div>
                  <ActiveSwitch active={m.is_active} label={`${m.display_name} active`} action={setActive.bind(null, "models", m.id)} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  <span className={`rounded-full px-2 py-0.5 ${callable ? "bg-powder text-human-ink" : "bg-[#ffede6] text-down-ink"}`}>{callable ? "● callable" : "● not callable"}</span>
                  <span className="rounded-full bg-background px-2 py-0.5 text-muted ring-1 ring-line">{provider?.name ?? "?"}</span>
                  {m.supports_vision && <span className="rounded-full bg-background px-2 py-0.5 text-muted ring-1 ring-line">👁 vision</span>}
                  <span className="rounded-full bg-background px-2 py-0.5 text-muted ring-1 ring-line">temp {m.temperature}</span>
                  <span className="rounded-full bg-background px-2 py-0.5 text-muted ring-1 ring-line">{m.max_output_tokens ? `${formatNumber(m.max_output_tokens)} max tokens` : "default max tokens"}</span>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-[14px] bg-background py-2 ring-1 ring-line">
                    <dt className="text-[10px] text-muted">calls (30d)</dt>
                    <dd className="display text-lg">{formatNumber(u?.calls ?? 0)}</dd>
                  </div>
                  <div className="rounded-[14px] bg-background py-2 ring-1 ring-line">
                    <dt className="text-[10px] text-muted">error rate</dt>
                    <dd className="display text-lg">{u?.calls ? `${Math.round((u.errors / u.calls) * 100)}%` : "—"}</dd>
                  </div>
                  <div className="rounded-[14px] bg-background py-2 ring-1 ring-line">
                    <dt className="text-[10px] text-muted">avg latency</dt>
                    <dd className="display text-lg">{seconds(u?.avg_latency_ms ?? null)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-subtle">{chainsUsing.length ? `Used by ${chainsUsing.join(", ")}` : "Not used by any chain step"}</p>
                {m.notes && <p className="mt-1 text-xs text-muted">{m.notes}</p>}
                <div className="mt-3 flex justify-end gap-1 border-t border-line pt-3">
                  <RecordDialog title="Edit model" fields={modelFields} values={m} action={saveRecord.bind(null, "models", m.id)} trigger="Edit" triggerClassName={linkBtn} />
                  <DeleteRecordButton
                    action={deleteRecord.bind(null, "models", m.id)}
                    title={`Delete ${m.display_name}?`}
                    body={
                      chainsUsing.length ? (
                        <p>This model is used by {chainsUsing.length} chain step(s), so the database will refuse. Deactivate it instead.</p>
                      ) : (
                        <p>Past logs keep the model id. The deletion is recorded in the audit log.</p>
                      )
                    }
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mb-3 mt-10 flex items-end justify-between gap-3">
        <h2 className="display text-2xl">Providers</h2>
        <RecordDialog title="New provider" fields={RESOURCES.providers.fields} action={saveRecord.bind(null, "providers", null)} trigger="+ New provider" triggerClassName="btn btn-ghost btn-sm" submitLabel="Add provider" />
      </div>
      <Card bodyClassName="p-0">
        {providers.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No providers yet" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Provider</th>
                  <th className="px-3 py-3 font-medium">Adapter</th>
                  <th className="px-3 py-3 font-medium">API key</th>
                  <th className="px-3 py-3 font-medium">Models</th>
                  <th className="px-3 py-3 font-medium">Active</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {providers.map((p) => {
                  const configured = keyConfigured(p.api_key_env_var);
                  const count = models.filter((m) => m.provider_id === p.id).length;
                  return (
                    <tr key={p.id}>
                      <td className="px-5 py-3">
                        <span className="font-semibold">{p.name}</span>
                        <span className="block font-mono text-xs text-subtle">{p.slug}</span>
                        {p.website_url && (
                          <a href={p.website_url} target="_blank" rel="noreferrer" className="text-xs text-human hover:underline">
                            {p.website_url.replace(/^https:\/\//, "")} ↗
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-3">{p.adapter === "gemini" ? "Gemini API" : <span className="text-muted">Catalog only</span>}</td>
                      <td className="px-3 py-3">
                        {p.api_key_env_var ? (
                          <>
                            <span className="font-mono text-xs">{p.api_key_env_var}</span>
                            <span className={`mt-0.5 block text-[11px] font-semibold ${configured ? "text-success" : "text-danger"}`}>
                              {configured ? "● set on this server" : "● not set on this server"}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="tabular px-3 py-3">{count}</td>
                      <td className="px-3 py-3">
                        <ActiveSwitch active={p.is_active} label={`${p.name} active`} action={setActive.bind(null, "providers", p.id)} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="inline-flex gap-1">
                          <RecordDialog title="Edit provider" fields={RESOURCES.providers.fields} values={p} action={saveRecord.bind(null, "providers", p.id)} trigger="Edit" triggerClassName={linkBtn} />
                          <DeleteRecordButton
                            action={deleteRecord.bind(null, "providers", p.id)}
                            title={`Delete ${p.name}?`}
                            body={count ? <p>It still has {count} model(s), so the database will refuse. Delete or move those first.</p> : <p>The deletion is recorded in the audit log.</p>}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-subtle">
        “Set on this server” checks the admin console&apos;s own environment. The main app reads the same variable name from its environment when a chain runs.
      </p>
    </>
  );
}
