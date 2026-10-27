import type { Metadata } from "next";
import { deleteRecord, saveRecord } from "@/app/(admin)/resources/actions";
import { ActiveSwitch, DeleteRecordButton, RecordDialog } from "@/components/RecordDialog";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDate, timeAgo } from "@/lib/format";
import { RESOURCES } from "@/lib/resources";
import { getAccess } from "@/lib/studio-data";
import { setSignupRestriction } from "./actions";

export const metadata: Metadata = { title: "Signup access" };

const linkBtn = "rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition hover:bg-powder hover:text-ink";

export default async function AccessPage() {
  const { supabase } = await requireAdmin("/access");
  const { restricted, settingsUpdatedAt, domains, emails } = await getAccess(supabase);

  return (
    <>
      <PageHeader
        title="Signup access"
        description="Who can create a new Morningside Memes account. Checked by the database when Google sign-in creates the account, so it can't be bypassed from the browser. Existing accounts are never locked out."
      />

      <Card bodyClassName="p-5 sm:p-6" className={restricted ? "!bg-[#f3f9ff]" : ""}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span aria-hidden className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] text-2xl ${restricted ? "orb" : "bg-butter"}`}>
            {restricted ? "🔒" : "🔓"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="display text-2xl">{restricted ? "Signups are restricted" : "Signups are open"}</p>
            <p className="text-sm text-muted">
              {restricted
                ? `Only emails at the ${domains.length} domain(s) below, plus ${emails.length} whitelisted address(es), can create an account.`
                : "Any Google account can create an account. The lists below take effect when you restrict signups."}
              {settingsUpdatedAt && <span className="text-subtle"> Changed {timeAgo(settingsUpdatedAt)}.</span>}
            </p>
          </div>
          <ActiveSwitch active={restricted} label="Restrict signups to the allowed domains and emails" action={setSignupRestriction} />
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card
          title="Allowed domains"
          description="Anyone with an email at these domains can sign up."
          action={<RecordDialog title="Allow a domain" fields={RESOURCES.domains.fields} action={saveRecord.bind(null, "domains", null)} trigger="+ Add" triggerClassName="btn btn-primary btn-sm" submitLabel="Allow domain" />}
        >
          {domains.length === 0 ? (
            <EmptyState title="No domains yet">e.g. columbia.edu and barnard.edu</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {domains.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-powder text-sm" aria-hidden>
                    @
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold">
                      {d.include_subdomains && <span className="text-subtle">*.</span>}
                      {d.domain}
                    </p>
                    <p className="text-xs text-subtle">
                      {d.note ? `${d.note} · ` : ""}added {formatDate(d.created_at)}
                    </p>
                  </div>
                  <RecordDialog title="Edit domain" fields={RESOURCES.domains.fields} values={d} action={saveRecord.bind(null, "domains", d.id)} trigger="Edit" triggerClassName={linkBtn} />
                  <DeleteRecordButton
                    action={deleteRecord.bind(null, "domains", d.id)}
                    title={`Remove ${d.domain}?`}
                    body={<p>{restricted ? "New people at this domain won't be able to sign up. " : ""}Existing accounts keep working. Recorded in the audit log.</p>}
                    label="Remove"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Whitelisted emails"
          description="Individual people allowed in from any domain."
          action={<RecordDialog title="Whitelist an email" fields={RESOURCES.emails.fields} action={saveRecord.bind(null, "emails", null)} trigger="+ Add" triggerClassName="btn btn-primary btn-sm" submitLabel="Whitelist" />}
        >
          {emails.length === 0 ? (
            <EmptyState title="No whitelisted emails">For guests, TAs, or alumni outside the allowed domains.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {emails.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-3">
                  <span className="orb flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-ink" aria-hidden>
                    {e.email.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-semibold">{e.email}</p>
                    <p className="text-xs text-subtle">
                      {e.note ? `${e.note} · ` : ""}added {formatDate(e.created_at)}
                    </p>
                  </div>
                  <RecordDialog title="Edit email" fields={RESOURCES.emails.fields} values={e} action={saveRecord.bind(null, "emails", e.id)} trigger="Edit" triggerClassName={linkBtn} />
                  <DeleteRecordButton action={deleteRecord.bind(null, "emails", e.id)} title={`Remove ${e.email}?`} body={<p>If they already have an account, it keeps working. Recorded in the audit log.</p>} label="Remove" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
