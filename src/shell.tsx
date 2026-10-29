import React, { useEffect, useRef, useState } from "react";
import { Database } from "./model";
import * as svc from "./service";
import { NavigationItem, activeItem, destination } from "./navigation";
import { Icon } from "./icons";
import { Avatar } from "./profiles";
import { PresencePicker, PresenceSettings } from "./presence";
import {
  Drawer,
  Popover,
  clearUnsaved,
  confirmAction,
  hasUnsaved,
} from "./feedback";
import { Button, Operation, go } from "./ui";

export function WorkspaceNavigation({
  db,
  items,
  current,
  collapsed,
  close,
}: {
  db: Database;
  items: NavigationItem[];
  current: string;
  collapsed: boolean;
  close: () => void;
}) {
  const { a, h, m, s } = svc.context(db);
  const key = `health-id-nav:${a.id}:${h.id}:${s.branchId}:${m.role}`;
  const [closed, setClosed] = useState<string[]>([]);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    try {
      setClosed(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      setClosed([]);
    }
  }, [key]);
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [current, key]);
  return (
    <nav ref={ref} aria-label="Main navigation">
      {[...new Set(items.map((i) => i.group))].map((group) => {
        const entries = items.filter((i) => i.group === group);
        const expanded =
          collapsed ||
          !closed.includes(group) ||
          entries.some((i) => activeItem(i, current));
        return (
          <div className="nav-group" key={group}>
            {!collapsed && !(entries.length === 1 && entries[0].title === group) && (
              <button
                className="nav-group-toggle"
                  aria-label={"Toggle " + group + " section"}
                aria-expanded={expanded}
                onClick={() => {
                  const next = closed.includes(group)
                    ? closed.filter((g) => g !== group)
                    : [...closed, group];
                  setClosed(next);
                  localStorage.setItem(key, JSON.stringify(next));
                }}
              >
                {group}
                <span aria-hidden="true">{expanded ? "−" : "+"}</span>
              </button>
            )}
            {expanded &&
              entries.map((item) => (
                <button
                  key={item.id}
                  title={item.title}
                  aria-label={item.title}
                  aria-current={activeItem(item, current) ? "page" : undefined}
                  onClick={() => {
                    close();
                    go(destination(item));
                  }}
                >
                  <Icon name={item.icon} size={18} />
                  {!collapsed && <span>{item.title}</span>}
                </button>
              ))}
          </div>
        );
      })}
    </nav>
  );
}

export function AccountMenu({ db }: { db: Database }) {
  const { a, m } = svc.context(db);
  const [open, setOpen] = useState(false),
    [panel, setPanel] = useState("");
  return (
    <div className="account-menu">
      <Button
        secondary
        className="profile-trigger"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Avatar src={a.photo} name={a.name} db={db} accountId={a.id} />
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} label="Account">
        <strong>{a.name}</strong>
        <small className="block">{m.role}</small>
        <Button
          secondary
          onClick={() => {
            document
              .querySelector<HTMLButtonElement>(".profile-trigger")
              ?.focus();
            setOpen(false);
            history.pushState({ profileDrawer: true }, "", "#/profile");
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          }}
        >
          My profile
        </Button>
        <PresencePicker db={db} />
        <Button
          secondary
          onClick={() => {
            setOpen(false);
            setPanel("Preferences");
          }}
        >
          Preferences
        </Button>
        <Button
          secondary
          onClick={() => {
            setOpen(false);
            setPanel("Help");
          }}
        >
          Help
        </Button>
        <Operation
          secondary
          onClick={async () => {
            if (hasUnsaved()) {
              if (
                !(await confirmAction({
                  title: "Sign out without saving?",
                  body: "Your latest unsaved edits will be discarded. Saved records and encrypted pending changes stay on this device.",
                  action: "Discard edits and sign out",
                }))
              )
                return false;
              clearUnsaved();
            }
            await svc.signOut();
            go("/signin");
          }}
        >
          Sign out
        </Operation>
      </Popover>
      <Drawer open={!!panel} title={panel} onClose={() => setPanel("")}>
        {panel === "Preferences" ? (
          <PresenceSettings db={db} />
        ) : (
          <>
            <p>
              Use Search Health ID to find permitted records and work areas.
              Press Ctrl+K or Command+K to open search.
            </p>
            <p>
              Connection details show saved changes and any items needing
              review. Contact your facility administrator for access or account
              help.
            </p>
          </>
        )}
      </Drawer>
    </div>
  );
}

export function DemoChip() {
  const [open, setOpen] = useState(false);
  return (
    <div className="demo-chip">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        Demo
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="About this demo"
      >
        <p>
          This local simulation uses fictional records. Connected services,
          verification and payments are simulated.
        </p>
        <a href="#/simulation">Simulation controls</a>
      </Popover>
    </div>
  );
}
