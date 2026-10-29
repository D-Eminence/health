import {
  toast,
  ToastCode,
  safeError,
  hasUnsaved,
  confirmAction,
  guardedNavigate,
  clearUnsaved,
  Drawer,
  Tooltip,
} from "./feedback";
import { Icon } from "./icons";
import { presenceOf } from "./presence";
import React, { useEffect, useState, useRef } from "react";
import { Database, Fields, Kind, RecordEntity, Value, str, id } from "./model";
import { Field } from "./catalog";
import * as svc from "./service";
export function go(path: string) {
  void guardedNavigate(path);
}
let routeDecision = false;
export function useRoute() {
  const [route, set] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    let prior = location.hash.slice(1) || "/";
    let priorState = history.state;
    const approved = (e: Event) => {
      prior = (e as CustomEvent).detail;
      priorState = history.state;
      set(prior);
    };
    const fn = async () => {
      if (routeDecision) return;
      const next = location.hash.slice(1) || "/";
      if (hasUnsaved()) {
        routeDecision = true;
        const leave = await confirmAction({
          title: "Leave without saving?",
          body: "Your latest edits have not been saved.",
          action: "Discard edits and leave",
        });
        routeDecision = false;
        if (!leave) {
          history.replaceState(priorState, "", "#" + prior);
          return;
        }
        clearUnsaved();
      }
      window.dispatchEvent(
        new CustomEvent("hid-route-approved", { detail: next }),
      );
    };
    window.addEventListener("hashchange", fn);
    window.addEventListener("hid-route-approved", approved);
    return () => {
      window.removeEventListener("hashchange", fn);
      window.removeEventListener("hid-route-approved", approved);
    };
  }, []);
  return route;
}
export function Button({
  children,
  secondary = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return (
    <button
      type="button"
      className={
        "hid-button button " + (secondary ? "secondary" : "") + " " + className
      }
      {...props}
    >
      {children}
    </button>
  );
}
export function Card({ children }: React.PropsWithChildren) {
  return <section className="hid-card panel">{children}</section>;
}
export function Heading({
  title,
  sub,
  children,
}: React.PropsWithChildren<{ title: string; sub?: string }>) {
  return (
    <div className="page-heading heading">
      <div>
        {sub && <p className="eyebrow">{sub}</p>}
        <h1>{title}</h1>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Badge({ children }: React.PropsWithChildren) {
  return <span className="badge">{children}</span>;
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div role="alert" className="error">
      {safeError(message)}
    </div>
  ) : null;
}
export function recordName(r: RecordEntity) {
  return str(
    r.data.name ||
      r.data.title ||
      r.data.number ||
      r.data.test ||
      r.data.modality ||
      r.data.procedure ||
      r.data.reason ||
      r.data.sampleCode ||
      r.data.lot ||
      r.id.slice(0, 8),
  );
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Form({
  fields,
  initial = {},
  onSubmit,
  label = "Save",
  db,
  contextPatient = "",
  draftKey,
  children,
  onValuesChange,
  validateValues,
  disabledWhen,
  successToast,
  persistValues = false,
}: {
  persistValues?: boolean;
  successToast?: ToastCode;
  onValuesChange?: (values: Fields) => void | Promise<void>;
  validateValues?: (values: Fields) => Record<string, string>;
  disabledWhen?: (values: Fields) => boolean;
  fields: Field[];
  initial?: Fields;
  onSubmit: (data: Fields, op: string) => Promise<unknown>;
  label?: string;
  db?: Database;
  contextPatient?: string;
  draftKey?: string;
  children?: React.ReactNode;
}) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [values, set] = useState<Fields>(() =>
    db && draftKey ? svc.draft(db, draftKey) || initial : initial,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [op] = useState(id);
  const formRef = useRef<HTMLFormElement>(null);
  const readers = useRef<Record<string, FileReader>>({});
  const [uploads, setUploads] = useState<Record<string, number>>({});
  useEffect(
    () => () =>
      Object.values(readers.current).forEach((r) => {
        if (r.readyState === 1) r.abort();
      }),
    [],
  );
  const revision = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (saving.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  async function change(key: string, value: Value) {
    const next = { ...values, [key]: value };
    if (key === "state") next.lga = "";
    const current = ++revision.current;
    set(next);
    setFieldErrors((old) => ({ ...old, [key]: "" }));
    if (onValuesChange) {
      saving.current = true;
      if (persistValues) setSaved("Saving draft...");
      try {
        await onValuesChange(next);
        if (current === revision.current) {
          saving.current = false;
          if (persistValues) {
            setSaved("Draft saved on this device");
            if (
              formRef.current &&
              !fields.some((f) => f.type === "password" && next[f.key])
            )
              formRef.current.dataset.draft = "saved";
          }
        }
      } catch (e) {
        setError((e as Error).message);
        if (persistValues) setSaved("Draft not saved");
      }
    }
    if (db && draftKey) {
      setSaved("Saving draft…");
      try {
        await svc.saveDraft(draftKey, next);
        if (current === revision.current) {
          saving.current = false;
          setSaved("Draft saved on this device");
          if (formRef.current) formRef.current.dataset.draft = "saved";
        }
      } catch (e) {
        if (current === revision.current) {
          setError((e as Error).message);
          setSaved("Draft not saved");
        }
      }
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errors: Record<string, string> = {};
    for (const f of fields) {
      const value = values[f.key];
      if (
        f.required &&
        (value === undefined ||
          value === "" ||
          (Array.isArray(value) && !value.length) ||
          (f.type === "checkbox" && !value))
      )
        errors[f.key] = "Complete this field.";
      if (f.type === "email" && value && !/^\S+@\S+\.\S+$/.test(String(value)))
        errors[f.key] = "Enter a valid email address.";
    }
    Object.assign(errors, validateValues?.(values) || {});
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      const field = fields.find((f) => errors[f.key]);
      if (field)
        (e.currentTarget as HTMLFormElement)
          .querySelector<HTMLElement>(
            '[aria-label="' + CSS.escape(field.label) + '"]',
          )
          ?.focus();
      return;
    }
    setBusy(true);
    if (formRef.current) formRef.current.dataset.submitting = "true";
    setError("");
    try {
      const result = await onSubmit(values, op);
      if (result === false) return;
      if (formRef.current) {
        formRef.current.dataset.dirty = "false";
        delete formRef.current.dataset.draft;
      }
      if (successToast) toast(successToast);
      if (db && draftKey) await svc.saveDraft(draftKey, null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (formRef.current) formRef.current.dataset.submitting = "false";
    }
  }
  function selection(
    field: Field,
  ): { value: string; label: string }[] | undefined {
    if (field.choices) return field.choices;
    if (!db) return undefined;
    let ctx;
    try {
      ctx = svc.context(db);
    } catch {
      return undefined;
    }
    if (["clinician", "staff", "assignedTo"].includes(field.key))
      return db.memberships
        .filter(
          (m) =>
            m.hospitalId === ctx.h.id &&
            m.branchIds.includes(ctx.s.branchId) &&
            m.status === "active" &&
            (field.key !== "clinician" ||
              ["Doctor", "Consultant", "Medical Director"].includes(m.role)) &&
            (field.key !== "assignedTo" || m.role === "Nurse"),
        )
        .map((m) => ({
          value: m.id,
          label:
            (db.accounts.find((a) => a.id === m.accountId)?.name || m.role) +
            " ? " +
            m.role +
            (presenceOf(db, m.accountId).status === "Hidden"
              ? ""
              : " ? " + presenceOf(db, m.accountId).status),
        }));
    if (field.key === "destination" && field.label.includes("branch"))
      return db.branches
        .filter(
          (b) =>
            b.hospitalId === ctx.h.id &&
            b.id !== ctx.s.branchId &&
            ctx.m.branchIds.includes(b.id),
        )
        .map((b) => ({ value: b.id, label: b.name }));
    if (field.key === "department" && !field.options)
      return db.branches
        .find((b) => b.id === ctx.s.branchId)
        ?.departments.map((d) => ({ value: d, label: d }));
    return undefined;
  }
  function choices(kind: Kind) {
    if (!db) return [];
    try {
      return svc
        .scoped(db, kind)
        .filter(
          (r) =>
            !contextPatient || !r.patientId || r.patientId === contextPatient,
        );
    } catch {
      return [];
    }
  }
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="record-form">
      <div className="form-grid">
        {fields.map((field) => (
          <label
            key={field.key}
            className={field.type === "textarea" ? "full" : ""}
          >
            {field.label}
            {field.required && <span aria-hidden="true"> *</span>}
            {field.options || field.ref || selection(field) ? (
              <select
                aria-invalid={!!fieldErrors[field.key]}
                aria-describedby={
                  fieldErrors[field.key] ? op + field.key + "-error" : undefined
                }
                aria-label={field.label}
                multiple={field.multiple}
                required={field.required}
                value={
                  field.multiple
                    ? Array.isArray(values[field.key])
                      ? (values[field.key] as string[])
                      : []
                    : str(values[field.key])
                }
                onChange={(e) =>
                  change(
                    field.key,
                    field.multiple
                      ? Array.from(e.target.selectedOptions).map((o) => o.value)
                      : e.target.value,
                  )
                }
              >
                <option value="">Select…</option>
                {selection(field)?.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
                {field.options?.map((x) => (
                  <option key={x}>{x}</option>
                ))}
                {field.ref &&
                  choices(field.ref).map((r) => (
                    <option key={r.id} value={r.id}>
                      {recordName(r)} · {r.status} · {r.id.slice(0, 6)}
                    </option>
                  ))}
              </select>
            ) : field.type === "checkbox" ? (
              <input
                aria-invalid={!!fieldErrors[field.key]}
                aria-describedby={
                  fieldErrors[field.key] ? op + field.key + "-error" : undefined
                }
                aria-label={field.label}
                type="checkbox"
                required={field.required}
                checked={!!values[field.key]}
                onChange={(e) => change(field.key, e.target.checked)}
              />
            ) : field.type === "textarea" ? (
              <textarea
                aria-invalid={!!fieldErrors[field.key]}
                aria-describedby={
                  fieldErrors[field.key] ? op + field.key + "-error" : undefined
                }
                aria-label={field.label}
                rows={3}
                required={field.required}
                value={str(values[field.key])}
                onChange={(e) => change(field.key, e.target.value)}
              />
            ) : field.type === "file" ? (
              <>
                <input
                  aria-invalid={!!fieldErrors[field.key]}
                  aria-describedby={
                    fieldErrors[field.key]
                      ? op + field.key + "-error"
                      : undefined
                  }
                  aria-label={field.label}
                  type="file"
                  accept="image/*,application/pdf"
                  required={field.required && !values[field.key]}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      setError("Choose an image or PDF smaller than 2 MB.");
                      return;
                    }
                    const reader = new FileReader();
                    readers.current[field.key] = reader;
                    setUploads((old) => ({ ...old, [field.key]: 0 }));
                    reader.onprogress = (e) => {
                      if (e.lengthComputable)
                        setUploads((old) => ({
                          ...old,
                          [field.key]: Math.round((e.loaded / e.total) * 100),
                        }));
                    };
                    reader.onabort = () =>
                      setUploads((old) => ({ ...old, [field.key]: -1 }));
                    reader.onload = () => {
                      setUploads((old) => ({ ...old, [field.key]: -1 }));
                      void change(field.key, String(reader.result));
                    };
                    reader.onerror = () =>
                      setError(
                        "The file could not be read. Choose it again and retry.",
                      );
                    reader.readAsDataURL(file);
                  }}
                />
                {uploads[field.key] >= 0 && (
                  <span>
                    <progress
                      value={uploads[field.key]}
                      max="100"
                      aria-label="Preparing attachment"
                    />
                    <Button
                      secondary
                      onClick={() => readers.current[field.key]?.abort()}
                    >
                      Cancel attachment
                    </Button>
                  </span>
                )}
                {values[field.key] && (
                  <small>Local attachment saved with this draft</small>
                )}
              </>
            ) : field.type === "password" ? (
              <PasswordInput
                aria-label={field.label}
                aria-invalid={!!fieldErrors[field.key]}
                aria-describedby={
                  fieldErrors[field.key] ? op + field.key + "-error" : undefined
                }
                required={field.required}
                value={str(values[field.key])}
                autoComplete={
                  field.key === "currentPassword"
                    ? "current-password"
                    : "new-password"
                }
                onChange={(e) => change(field.key, e.target.value)}
              />
            ) : (
              <input
                list={field.suggestions ? op + field.key : undefined}
                aria-invalid={!!fieldErrors[field.key]}
                aria-describedby={
                  fieldErrors[field.key] ? op + field.key + "-error" : undefined
                }
                aria-label={field.label}
                type={field.type || "text"}
                required={field.required}
                value={str(values[field.key])}
                onChange={(e) =>
                  change(
                    field.key,
                    field.type === "number" && e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
            {fieldErrors[field.key] && (
              <small className="field-error" id={op + field.key + "-error"}>
                {fieldErrors[field.key]}
              </small>
            )}
            {field.suggestions && (
              <datalist id={op + field.key}>
                {field.suggestions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            )}
          </label>
        ))}
      </div>
      {children}
      <ErrorBox message={error} />
      <div className="form-footer">
        <Button type="submit" disabled={busy || disabledWhen?.(values)}>
          {busy ? "Saving…" : label}
        </Button>
        {saved && <small role="status">{saved}</small>}
        {error && (
          <small>
            Correct the issue or retry using the same button. No success is
            reported until saved.
          </small>
        )}
      </div>
    </form>
  );
}
export function Operation({
  children,
  onClick,
  secondary = false,
  successToast,
}: {
  successToast?: ToastCode;
  children: React.ReactNode;
  onClick: () => Promise<unknown>;
  secondary?: boolean;
}) {
  const [busy, set] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        secondary={secondary}
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          set(true);
          setError("");
          try {
            const result = await onClick();
            if (result !== false && successToast) toast(successToast);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            set(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </Button>
      <ErrorBox message={error} />
    </>
  );
}
export function DataView({ data, db }: { data: Fields; db?: Database }) {
  const [preview, setPreview] = useState("");
  return (
    <>
      <Drawer
        open={!!preview}
        title="Document preview"
        onClose={() => setPreview("")}
      >
        {preview.startsWith("data:image/") ? (
          <img
            className="study-preview"
            src={preview}
            alt="Attached document"
          />
        ) : (
          <object
            className="study-preview"
            data={preview}
            type="application/pdf"
          >
            <p>Download the document to read it.</p>
          </object>
        )}
        <a href={preview} download="facility-document">
          Download document
        </a>
      </Drawer>
      <dl className="details">
        {Object.entries(data)
          .filter(([key]) => key !== "module")
          .map(([key, value]) => (
            <React.Fragment key={key}>
              <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
              <dd>
                {typeof value === "string" && value.startsWith("data:") ? (
                  <div>
                    <Button secondary onClick={() => setPreview(value)}>
                      Preview document
                    </Button>
                    <a href={value} download="local-study">
                      Download local attachment
                    </a>
                  </div>
                ) : Array.isArray(value) ? (
                  value.join(", ")
                ) : typeof value === "boolean" ? (
                  value ? (
                    "Yes"
                  ) : (
                    "No"
                  )
                ) : db?.records.some((r) => r.id === value) ? (
                  recordName(db.records.find((r) => r.id === value)!)
                ) : (
                  String(value)
                )}
              </dd>
            </React.Fragment>
          ))}
      </dl>
    </>
  );
}

export function PasswordInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  const [visible, setVisible] = useState(false);
  const [typed, setTyped] = useState("");
  const generated = React.useId();
  const inputId = props.id || generated;
  const label = String(props["aria-label"] || props.name || "password")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
  return (
    <span className="password-field">
      <span className="password-control">
        <input
          {...props}
          aria-label={
            props["aria-label"] ||
            label.charAt(0).toUpperCase() + label.slice(1)
          }
          id={inputId}
          type={visible ? "text" : "password"}
          onChange={(e) => {
            setTyped(e.target.value);
            props.onChange?.(e);
          }}
        />
        <Tooltip text={(visible ? "Hide " : "Show ") + label}>
          <button
            type="button"
            className="password-toggle"
            aria-label={(visible ? "Hide " : "Show ") + label}
            aria-controls={inputId}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            <Icon name={visible ? "eyeOff" : "eye"} size={20} />
          </button>
        </Tooltip>
      </span>
      {props.autoComplete === "new-password" && typed && (
        <small aria-live="polite" style={{ display: "block", paddingTop: 6 }}>
          Password strength:{" "}
          {typed.length >= 12 &&
          /[A-Z]/.test(typed) &&
          /[0-9]/.test(typed) &&
          /[^a-z0-9]/i.test(typed)
            ? "Strong"
            : typed.length >= 8
              ? "Fair — use a longer, unique password"
              : "Weak — use at least 8 characters"}
        </small>
      )}
    </span>
  );
}
