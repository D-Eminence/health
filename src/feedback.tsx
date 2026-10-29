import { Database } from "./model";
import * as svc from "./service";
import { recordName } from "./ui";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PasswordInput } from "./ui";
export type ToastCode =
  | "profile"
  | "saved"
  | "invitation"
  | "password"
  | "synced"
  | "assignment"
  | "mention"
  | "undone"
  | "retry"
  | "filters";
const copy: Record<ToastCode, string> = {
  filters: "Filters cleared",
  profile: "Profile updated",
  saved: "Saved on this device",
  invitation: "Invitation created",
  password: "Password updated",
  synced: "changes synced",
  assignment: "New assignment - open Notifications",
  mention: "New mention - open Notifications",
  undone: "Change undone",
  retry: "Something needs attention. Review the current screen.",
};
export function toast(
  code: ToastCode,
  options: {
    count?: number;
    error?: boolean;
    action?: () => void;
    actionLabel?: string;
  } = {},
) {
  window.dispatchEvent(
    new CustomEvent("hid-toast", { detail: { code, ...options } }),
  );
}
export function safeError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /TypeError|ReferenceError|SyntaxError|IndexedDB|IDB|fetch|undefined|stack|JSON|crypto|objectStore/i.test(
    text,
  )
    ? "This action could not be completed. Your saved work is safe. Please retry."
    : text;
}
export function hasUnsaved(root: ParentNode = document) {
  return !!root.querySelector(
    '[data-dirty="true"]:not([data-submitting="true"]):not([data-draft="saved"])',
  );
}
export function clearUnsaved(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLFormElement>("[data-dirty]")
    .forEach((f) => (f.dataset.dirty = "false"));
}
type Decision = {
  title: string;
  body: string;
  action: string;
  word?: string;
  password?: boolean;
};
let decisionPending = false;
export function confirmAction(options: Decision): Promise<boolean> {
  return decision(options).then((result) => result !== null);
}
export function requestPassword(
  title = "Confirm your password",
): Promise<string | null> {
  return decision({
    title,
    body: "Re-enter your current password to continue.",
    action: "Continue",
    password: true,
  });
}
function decision(options: Decision): Promise<string | null> {
  if (decisionPending) return Promise.resolve(null);
  decisionPending = true;
  return new Promise((resolve) =>
    window.dispatchEvent(
      new CustomEvent("hid-decision", {
        detail: {
          ...options,
          resolve: (result: string | null) => {
            decisionPending = false;
            resolve(result);
          },
        },
      }),
    ),
  );
}
export async function guardedNavigate(path: string) {
  if (
    hasUnsaved() &&
    !(await confirmAction({
      title: "Leave without saving?",
      body: "Your latest edits have not been saved. Stay here to save them or leave and discard them.",
      action: "Discard edits and leave",
    }))
  )
    return;
  clearUnsaved();
  location.hash = path;
}
const focusable =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]';
let layers = 0,
  originalOverflow = "";
function useLayer(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const workspace = document.getElementById("health-id-workspace");
    if (layers === 0) originalOverflow = document.body.style.overflow;
    layers++;
    if (workspace) workspace.inert = true;
    document.body.style.overflow = "hidden";
    const timer = requestAnimationFrame(() => {
      (
        ref.current?.querySelector<HTMLElement>("[data-initial-focus]") ||
        ref.current?.querySelector<HTMLElement>(focusable) ||
        ref.current
      )?.focus();
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...ref.current!.querySelectorAll<HTMLElement>(focusable),
        ].filter((n) => n.getClientRects().length && !n.closest("[inert]"));
        const first = nodes[0],
          last = nodes.at(-1);
        if (!first) {
          e.preventDefault();
          ref.current?.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first ||
            !ref.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !ref.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    ref.current?.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(timer);
      ref.current?.removeEventListener("keydown", key);
      layers--;
      if (workspace && layers === 0 && !document.querySelector(".offline-lock"))
        workspace.inert = false;
      if (layers === 0) document.body.style.overflow = originalOverflow;
      requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest("[inert]"))
          previous.focus();
      });
    };
  }, [active]);
}
const activeDrawers: string[] = [];
export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const drawerId = React.useId();
  const ref = useRef<HTMLElement>(null),
    [suspended, setSuspended] = useState(false),
    [discard, setDiscard] = useState(false);
  useEffect(() => {
    if (!open) return;
    const refresh = () =>
      setSuspended(decisionPending || activeDrawers.at(-1) !== drawerId);
    const show = () => setSuspended(true);
    activeDrawers.push(drawerId);
    window.addEventListener("hid-drawer-changed", refresh);
    window.addEventListener("hid-decision", show);
    window.addEventListener("hid-decision-closed", refresh);
    window.dispatchEvent(new Event("hid-drawer-changed"));
    return () => {
      const index = activeDrawers.indexOf(drawerId);
      if (index >= 0) activeDrawers.splice(index, 1);
      window.removeEventListener("hid-drawer-changed", refresh);
      window.removeEventListener("hid-decision", show);
      window.removeEventListener("hid-decision-closed", refresh);
      window.dispatchEvent(new Event("hid-drawer-changed"));
    };
  }, [open]);
  const close = () => {
    if (discard) {
      setDiscard(false);
      return;
    }
    if (hasUnsaved(ref.current || document)) {
      setDiscard(true);
      return;
    }
    onClose();
  };
  useLayer(ref, open && !suspended, close);
  useEffect(() => {
    if (discard)
      ref.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, [discard]);
  if (!open) return null;
  return createPortal(
    <div className="feedback-scrim" hidden={suspended}>
      <section
        ref={ref}
        className="feedback-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="hid-button button secondary"
            onClick={close}
            aria-label={"Close " + title}
          >
            Close
          </button>
        </header>
        {discard && (
          <div role="alert">
            <h3>Discard unsaved changes?</h3>
            <p>Your latest edits have not been saved.</p>
            <button
              className="hid-button button secondary"
              data-initial-focus
              onClick={() => setDiscard(false)}
            >
              Keep editing
            </button>
            <button
              className="hid-button button"
              onClick={() => {
                clearUnsaved(ref.current!);
                setDiscard(false);
                onClose();
              }}
            >
              Discard changes
            </button>
          </div>
        )}
        <div hidden={discard} inert={discard ? true : undefined}>
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}
export function Popover({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        previous?.focus();
      }
    };
    const outside = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node))
        close.current();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return open ? (
    <div
      ref={ref}
      className="feedback-popover"
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  ) : null;
}
export function Banner({
  title,
  children,
  tone = "info",
}: React.PropsWithChildren<{
  title: string;
  tone?: "info" | "warning" | "critical";
}>) {
  return (
    <section
      className={"feedback-banner " + tone}
      role={tone === "critical" ? "alert" : "status"}
    >
      <strong>{title}</strong>
      {children}
    </section>
  );
}
export function EmptyState({
  title = "Nothing here yet",
  children,
}: React.PropsWithChildren<{ title?: string }>) {
  return (
    <div className="feedback-empty">
      <strong>{title}</strong>
      <p>
        {children ||
          "Create a record when you have the appropriate permission, or adjust your search."}
      </p>
    </div>
  );
}
export function Skeleton() {
  return (
    <div
      role="status"
      aria-label="Loading workspace"
      className="feedback-skeleton"
    >
      <span />
      <span />
      <span />
      <p>Opening your saved workspace...</p>
    </div>
  );
}
export function Tooltip({
  text,
  children,
}: React.PropsWithChildren<{ text: string }>) {
  const tooltipId = React.useId();
  return (
    <span className="feedback-tooltip">
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            "aria-describedby": tooltipId,
          })
        : children}
      <span role="tooltip" id={tooltipId}>
        {text}
      </span>
    </span>
  );
}
export function FeedbackHost() {
  const [items, setItems] = useState<any[]>([]),
    [prompt, setPrompt] = useState<
      (Decision & { resolve: (v: string | null) => void }) | null
    >(null),
    [word, setWord] = useState(""),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false),
    [phase, setPhase] = useState("");
  const closing = useRef(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!prompt) return;
    closing.current = false;
    setPhase("");
    const frame = requestAnimationFrame(() => setPhase("is-open"));
    return () => cancelAnimationFrame(frame);
  }, [prompt]);
  const finish = (value: string | null) => {
    if (closing.current) return;
    closing.current = true;
    setPhase("is-closing");
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--modal-close-dur",
          ),
        ) || 150;
    setTimeout(() => {
      prompt?.resolve(value);
      setPrompt(null);
      setWord("");
      setPassword("");
      setPhase("");
      closing.current = false;
      window.dispatchEvent(new Event("hid-decision-closed"));
    }, duration);
  };
  useLayer(ref, !!prompt, () => finish(null));
  useEffect(() => {
    const notify = (event: Event) => {
      const incoming = (event as CustomEvent).detail;
      if (
        !incoming ||
        typeof incoming.code !== "string" ||
        !Object.hasOwn(copy, incoming.code)
      )
        return;
      const d = {
        code: incoming.code,
        count:
          typeof incoming.count === "number" &&
          Number.isSafeInteger(incoming.count) &&
          incoming.count > 0
            ? incoming.count
            : 1,
        error: incoming.error === true,
        action:
          typeof incoming.action === "function" ? incoming.action : undefined,
        actionLabel: ["Undo", "Retry", "Open"].includes(incoming.actionLabel)
          ? incoming.actionLabel
          : "Undo",
      };
      if ((globalThis as any).__hidDnd) return;
      setItems((old) => {
        const existing = old.find((i) => i.code === d.code);
        if (existing)
          return old.map((i) =>
            i === existing
              ? {
                  ...i,
                  count: (i.count || 1) + (d.count || 1),
                  remaining: 5000,
                }
              : i,
          );
        const next = [...old];
        if (next.length >= 3) {
          const drop = next.findIndex((i) => !i.error);
          if (drop < 0) return old;
          next.splice(drop, 1);
        }
        return [...next, { ...d, id: crypto.randomUUID(), remaining: 5000 }];
      });
    };
    const ask = (event: Event) => {
      setPrompt((event as CustomEvent).detail);
      setVisible(false);
    };
    const input = (e: Event) => {
      const form = (e.target as HTMLElement).closest<HTMLElement>("form");
      if (form) {
        form.dataset.dirty = "true";
        delete form.dataset.draft;
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (hasUnsaved()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const links = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>(
        'a[href^="#/"]',
      );
      if (a && hasUnsaved()) {
        e.preventDefault();
        void guardedNavigate(a.hash.slice(1));
      }
    };
    window.addEventListener("hid-toast", notify);
    window.addEventListener("hid-decision", ask);
    document.addEventListener("input", input);
    document.addEventListener("change", input);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", links, true);
    const tick = setInterval(
      () =>
        setItems((old) =>
          old
            .map((i) =>
              i.hovered || i.focused || i.error
                ? i
                : { ...i, remaining: i.remaining - 250 },
            )
            .filter((i) => i.remaining > 0),
        ),
      250,
    );
    return () => {
      clearInterval(tick);
      window.removeEventListener("hid-toast", notify);
      window.removeEventListener("hid-decision", ask);
      document.removeEventListener("input", input);
      document.removeEventListener("change", input);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", links, true);
    };
  }, []);
  const auth = /^#\/(signin|recover|verify|reset-password|register)/.test(
    location.hash,
  );
  return (
    <>
      {createPortal(
        <div
          className={"feedback-toasts" + (auth ? " auth-feedback" : "")}
          aria-label="Activity confirmations"
        >
          {items.map((i) => (
            <div
              key={i.id}
              role={i.error ? "alert" : "status"}
              className="feedback-toast t-toast is-open"
              onMouseEnter={() =>
                setItems((old) =>
                  old.map((x) => (x.id === i.id ? { ...x, hovered: true } : x)),
                )
              }
              onMouseLeave={() =>
                setItems((old) =>
                  old.map((x) =>
                    x.id === i.id ? { ...x, hovered: false } : x,
                  ),
                )
              }
              onFocus={() =>
                setItems((old) =>
                  old.map((x) => (x.id === i.id ? { ...x, focused: true } : x)),
                )
              }
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget))
                  setItems((old) =>
                    old.map((x) =>
                      x.id === i.id ? { ...x, focused: false } : x,
                    ),
                  );
              }}
            >
              <span>
                {i.code === "synced"
                  ? `${i.count || 1} ${copy.synced}`
                  : copy[i.code as ToastCode]}
                {i.count > 1 && i.code !== "synced" ? ` (${i.count})` : ""}
              </span>
              {i.action && (
                <button
                  onClick={() => {
                    i.action();
                    setItems((old) => old.filter((x) => x.id !== i.id));
                  }}
                >
                  {i.actionLabel || "Undo"}
                </button>
              )}
              <button
                aria-label="Dismiss confirmation"
                onClick={() =>
                  setItems((old) => old.filter((x) => x.id !== i.id))
                }
              >
                Close
              </button>
            </div>
          ))}
        </div>,
        auth
          ? document.querySelector(".auth-content") ||
              document.getElementById("root")!
          : document.body,
      )}
      {prompt &&
        createPortal(
          <div className="feedback-scrim decision-scrim">
            <section
              ref={ref}
              className={"feedback-dialog t-modal " + phase}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="decision-title"
              aria-describedby="decision-body"
              tabIndex={-1}
            >
              <h2 id="decision-title">{prompt.title}</h2>
              <p id="decision-body">{prompt.body}</p>
              {prompt.word && (
                <label>
                  Type {prompt.word} to confirm
                  <input
                    value={word}
                    onChange={(e) => setWord(e.target.value)}
                  />
                </label>
              )}
              {prompt.password && (
                <label>
                  Current password
                  <PasswordInput
                    aria-label="Current password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              <div className="actions">
                <button
                  className="hid-button button secondary"
                  data-initial-focus
                  onClick={() => finish(null)}
                >
                  Cancel
                </button>
                <button
                  className="hid-button button"
                  disabled={
                    (!!prompt.word && word !== prompt.word) ||
                    (prompt.password && !password)
                  }
                  onClick={() =>
                    finish(prompt.password ? password : "confirmed")
                  }
                >
                  {prompt.action}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

export function WorkspaceSearch({
  items,
  db,
}: {
  items: { id: string; title: string }[];
  db: Database;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const { h, s: session } = svc.context(db);
  const candidates = [
    ...items,
    ...(query.trim().length >= 2
      ? [
          ...svc
            .records(db, "patients")
            .map((r) => ({
              id: "patients/" + r.id,
              title: recordName(r) + " ? Patient",
            })),
          ...(svc.can(db, "staff")
            ? db.memberships
                .filter(
                  (m) =>
                    m.hospitalId === h.id &&
                    m.branchIds.includes(session.branchId),
                )
                .map((m) => ({
                  id: "staff",
                  title:
                    (db.accounts.find((a) => a.id === m.accountId)?.name ||
                      "Staff member") + " ? Staff",
                }))
            : []),
        ]
      : []),
  ];
  const results = candidates.filter(
    (item, index) =>
      candidates.findIndex(
        (i) => i.id === item.id && i.title === item.title,
      ) === index && item.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <button
        className="hid-button button secondary"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+k Meta+k"
      >
        Search Health ID
      </button>
      <Drawer
        open={open}
        title="Search Health ID"
        onClose={() => {
          setOpen(false);
          setQuery("");
        }}
      >
        <label>
          Search modules, patients and staff
          <input
            className="workspace-search-input"
            autoComplete="off"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <p>
          Search your permitted work areas. Enter at least two characters to
          find patients and staff.
        </p>
        {results.length ? (
          <nav aria-label="Search results">
            {results.slice(0, 50).map((item) => (
              <button
                className="workspace-search-result hid-button button secondary"
                key={item.id + item.title}
                onClick={() => {
                  setOpen(false);
                  void guardedNavigate("/" + item.id);
                }}
              >
                {item.title}
              </button>
            ))}
          </nav>
        ) : (
          <EmptyState title="No matching results">
            Try a different name.
          </EmptyState>
        )}
      </Drawer>
    </>
  );
}
