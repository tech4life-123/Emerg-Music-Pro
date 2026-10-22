"use client";

import { useActionState } from "react";
import { IDLE, type FormState } from "@/lib/forms";

type Choice = { value: string; label: string; danger?: boolean };

/** One small decision form: hidden ids, an optional reason, and one button per choice. The server action re-checks everything. */
export function ActionForm({ action, hidden, choiceName, choices, reasonLabel, reasonRequired }: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  choiceName: string;
  choices: Choice[];
  reasonLabel?: string;
  reasonRequired?: boolean;
}) {
  const [state, run, pending] = useActionState(action, IDLE);
  const err = state.status === "error" ? state.message : null;
  return (
    <form action={run} className="form" style={{ padding: 0, maxWidth: "none" }}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {reasonLabel ? (
        <div className="field">
          <label htmlFor={`r-${hidden.id}-${choiceName}`}>{reasonLabel}</label>
          <textarea id={`r-${hidden.id}-${choiceName}`} name="reason" rows={2} maxLength={500} required={reasonRequired} />
        </div>
      ) : null}
      <div className="row-actions">
        {choices.map((c) => (
          <button key={c.value} name={choiceName} value={c.value} disabled={pending} className={`btn btn-sm ${c.danger ? "btn-danger" : "btn-ghost"}`}>{c.label}</button>
        ))}
      </div>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
      {state.status === "success" ? <p className="form-ok" role="status">{state.message}</p> : null}
    </form>
  );
}
