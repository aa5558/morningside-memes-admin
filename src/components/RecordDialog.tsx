"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { FormResult } from "@/app/(admin)/resources/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import type { Field } from "@/lib/resources";

const input =
  "w-full rounded-[16px] border border-[rgba(22,38,61,0.12)] bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-subtle focus:border-sky focus:ring-4 focus:ring-sky/25 aria-[invalid=true]:border-down";

type Values = Record<string, string | number | boolean | null | undefined>;

// A create/edit form in a modal, rendered from a resource's field list.
// `action` is a server action bound to the resource and record id.
export function RecordDialog({
  title,
  fields,
  values,
  action,
  trigger,
  triggerClassName = "btn btn-primary btn-sm",
  submitLabel = "Save",
}: {
  title: string;
  fields: Field[];
  values?: Values;
  action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  trigger: ReactNode;
  triggerClassName?: string;
  submitLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Several of these dialogs share a page, so ids must be unique per dialog.
  const uid = useId();
  const [state, formAction, pending] = useActionState(action, {});
  const [openedAt, setOpenedAt] = useState(0);
  const handled = useRef<number | undefined>(undefined);

  // Close after a successful save.
  useEffect(() => {
    if (state.success && state.at && state.at !== handled.current) {
      handled.current = state.at;
      dialog.current?.close();
    }
  }, [state.success, state.at]);

  const showErrors = (state.at ?? 0) < openedAt ? false : true;

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => {
          setOpenedAt(Date.now());
          dialog.current?.showModal();
        }}
      >
        {trigger}
      </button>
      <dialog
        ref={dialog}
        aria-label={title}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-[28px] border-0 bg-white p-0 text-ink shadow-[0_30px_80px_-20px_rgba(22,38,61,0.45)] backdrop:bg-ink/25 backdrop:backdrop-blur-sm"
      >
        <form action={formAction} key={openedAt} className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 className="display text-2xl">{title}</h2>
          {fields.map((field) => {
            const error = showErrors ? state.fieldErrors?.[field.name] : undefined;
            const id = `${uid}-${field.name}`;
            const value = values?.[field.name];
            if (field.type === "checkbox") {
              return (
                <label key={field.name} className="flex items-start gap-3 rounded-[16px] bg-background px-3.5 py-3 text-sm ring-1 ring-line">
                  <input
                    type="checkbox"
                    name={field.name}
                    defaultChecked={value === undefined ? Boolean(field.defaultValue) : Boolean(value)}
                    className="mt-0.5 h-4 w-4 accent-[#1f6fd1]"
                  />
                  <span>
                    <span className="font-medium">{field.label}</span>
                    {field.help && <span className="mt-0.5 block text-xs text-muted">{field.help}</span>}
                  </span>
                </label>
              );
            }
            return (
              <div key={field.name} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="px-1 text-xs font-semibold text-muted">
                  {field.label}
                  {"required" in field && field.required && <span className="text-down"> *</span>}
                </label>
                {field.type === "select" ? (
                  <select id={id} name={field.name} defaultValue={value === null || value === undefined ? (field.nullValue ?? field.options[0]?.value) : String(value)} className={input} aria-invalid={Boolean(error)}>
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    id={id}
                    name={field.name}
                    defaultValue={value === null || value === undefined ? "" : String(value)}
                    maxLength={field.max}
                    required={field.required}
                    rows={field.max > 1000 ? 8 : 3}
                    placeholder={field.placeholder}
                    aria-invalid={Boolean(error)}
                    className={`${input} ${field.mono ? "font-mono" : ""}`}
                  />
                ) : field.type === "number" ? (
                  <input
                    id={id}
                    name={field.name}
                    type="number"
                    defaultValue={value === null || value === undefined ? "" : String(value)}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? (field.integer ? 1 : "any")}
                    required={field.required}
                    placeholder={field.placeholder}
                    aria-invalid={Boolean(error)}
                    className={input}
                  />
                ) : (
                  <input
                    id={id}
                    name={field.name}
                    defaultValue={value === null || value === undefined ? "" : String(value)}
                    maxLength={field.max}
                    required={field.required}
                    pattern={field.pattern}
                    title={field.patternHint}
                    placeholder={field.placeholder}
                    aria-invalid={Boolean(error)}
                    autoComplete="off"
                    className={`${input} ${field.mono ? "font-mono" : ""}`}
                  />
                )}
                {error ? (
                  <p role="alert" className="px-1 text-xs text-danger">
                    {error}
                  </p>
                ) : (
                  field.help && <p className="px-1 text-xs text-subtle">{field.help}</p>
                )}
              </div>
            );
          })}
          {showErrors && state.error && (
            <p role="alert" className="rounded-[16px] bg-[#ffede6] px-4 py-2.5 text-sm text-down-ink">
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => dialog.current?.close()} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? "Saving…" : submitLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function DeleteRecordButton({
  action,
  title,
  body,
  label = "Delete",
  className = "rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition hover:bg-[#ffede6] hover:text-danger",
  confirmWord,
}: {
  action: () => Promise<FormResult>;
  title: string;
  body: ReactNode;
  label?: ReactNode;
  className?: string;
  confirmWord?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <ConfirmButton
        label={label}
        className={className}
        title={title}
        body={body}
        confirmLabel="Delete"
        confirmWord={confirmWord}
        onConfirm={async () => {
          const result = await action();
          setError(result.error ?? null);
        }}
      />
      {error && (
        <span role="alert" className="mt-1 max-w-xs text-right text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

// An accessible on/off switch that saves immediately.
export function ActiveSwitch({
  active,
  label,
  action,
}: {
  active: boolean;
  label: string;
  action: (next: boolean) => Promise<FormResult>;
}) {
  const [on, setOn] = useState(active);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const next = !on;
            setOn(next);
            const result = await action(next);
            if (result.error) {
              setOn(!next);
              setError(result.error);
            } else setError(null);
          })
        }
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-human" : "bg-[#d5deea]"} disabled:opacity-60`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
