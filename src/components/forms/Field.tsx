import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { FormState } from "@/lib/forms";

/** Label + control + hint + error, wired with ids so screen readers announce them. */
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="field-hint" id={`${id}-hint`}>{hint}</p> : null}
      {error ? <p className="field-error" id={`${id}-err`} role="alert">{error}</p> : null}
    </div>
  );
}

const describe = (id: string, hint?: string, error?: string) => [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;

export function TextField({ id, label, hint, state, ...rest }: { id: string; label: string; hint?: string; state: FormState } & InputHTMLAttributes<HTMLInputElement>) {
  const error = state.status === "error" && state.field === id ? state.message : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describe(id, hint, error)} {...rest} />
    </Field>
  );
}

export function TextArea({ id, label, hint, state, ...rest }: { id: string; label: string; hint?: string; state: FormState } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const error = state.status === "error" && state.field === id ? state.message : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <textarea id={id} name={id} rows={4} aria-invalid={error ? true : undefined} aria-describedby={describe(id, hint, error)} {...rest} />
    </Field>
  );
}

export function SelectField({ id, label, hint, state, children, ...rest }: { id: string; label: string; hint?: string; state: FormState } & SelectHTMLAttributes<HTMLSelectElement>) {
  const error = state.status === "error" && state.field === id ? state.message : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <select id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describe(id, hint, error)} {...rest}>{children}</select>
    </Field>
  );
}

/** Form-level result (errors not tied to one field, and success). */
export function FormMessage({ state }: { state: FormState }) {
  if (state.status === "error" && !state.field) return <p className="form-error" role="alert">{state.message}</p>;
  if (state.status === "success") return <p className="form-ok" role="status">{state.message}</p>;
  return null;
}
