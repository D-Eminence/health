import { Dashboard } from "./dashboard";
import { navigation, activeItem, destination, moduleTitle } from "./navigation";
import { WorkspaceNavigation, AccountMenu, DemoChip } from "./shell";
import { DEMO_MODE } from "./config";
import {
  FeedbackHost,
  Drawer,
  Banner,
  Skeleton,
  EmptyState,
  Tooltip,
  WorkspaceSearch,
  hasUnsaved,
  confirmAction,
  clearUnsaved,
} from "./feedback";
import { PresenceRuntime, PresencePicker } from "./presence";
import { StaffProfile, Avatar } from "./profiles";
import { OfflineTools, ConnectionBoundary, OfflineBanner } from "./offline";
import { FacilityProfile, AuthLinks } from "./registration";
import { SubscriptionPage } from "./subscription";
import { pendingFacility } from "./subscription-model";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Database, str } from "./model";
import { allModules } from "./catalog";
import * as svc from "./service";
import { listeners, read } from "./storage";
import { AuthPage, AuthShell, Institutions, Simulation } from "./auth";
import { Onboarding, Staff } from "./admin";
import { PatientSimulator, Reports, Workflow, Platform } from "./workflows";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Heading,
  Operation,
  download,
  go,
  useRoute,
} from "./ui";
import { Icon } from "./icons";
const icons: Record<string, string> = {
  patients: "user",
  appointments: "calendar",
  journey: "route",
  triage: "activity",
  consult: "stethoscope",
  lab: "flask",
  pharmacy: "pill",
  radiology: "scan",
  inpatient: "bed",
  billing: "receipt",
  inventory: "box",
  staff: "users",
  setup: "building",
  audit: "history",
  reports: "chart",
};
function App() {
  const [db, setDB] = useState<Database | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const route = useRoute();
  const [collapsed, setCollapsed] = useState(
    localStorage.getItem("sidebar-collapsed") === "true",
  );
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [notification, setNotification] = useState(false);
  async function load() {
    try {
      const reference = svc.token();
      setDB(
        location.hash.startsWith("#/simulation")
          ? await read()
          : await svc.workspaceData(),
      );
      setLoadedToken(reference);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    listeners.add(load);
    const tick = setInterval(() => {
      load();
      svc.syncSubscriptionReminders().catch(() => {});
    }, 1000);
    return () => {
      listeners.delete(load);
      clearInterval(tick);
    };
  }, []);
  const session = db ? svc.sessionIn(db) : undefined;
  let ctx: ReturnType<typeof svc.context> | undefined;
  try {
    if (db) ctx = svc.context(db);
  } catch {}
  useEffect(() => {
    if (route !== (location.hash.slice(1) || "/")) return;
    if (!db) return;
    if (loadedToken !== svc.token()) {
      load();
      return;
    }
    const publicRoute =
      [
        "/signin",
        "/register",
        "/verify",
        "/recover",
        "/reset-password",
        "/simulation",
        "/patient-simulation",
        "/accept-invitation",
      ].some((p) => route.startsWith(p)) || route.startsWith("/invitation/");
    if (publicRoute) return;
    if (!session) {
      if (svc.token())
        setNotice(
          "Your session has expired or changed. Sign in to continue. Saved records remain on this device.",
        );
      go("/signin");
      return;
    }
    if (route === "/institutions") return;
    if (route === "/profile") return;
    if (!ctx) {
      setNotice(
        "Choose an active institution and authorized branch. Your membership may have changed.",
      );
      go("/institutions");
      return;
    }
    if (ctx.a.forcePasswordChange) {
      go("/profile");
      return;
    }
    if (
      pendingFacility(ctx.h) &&
      !["/facility", "/staff", "/subscription", "/dashboard"].includes(route)
    ) {
      go(svc.can(db, "facility") ? "/facility" : "/dashboard");
      return;
    }
    if (route === "/") {
      go(ctx.h.launched ? session.lastRoute || "/dashboard" : "/onboarding");
      return;
    }
    const module = route.split("/")[1];
    const allowedDuringSetup = [
      "onboarding",
      "staff",
      "shifts",
      "services",
      "setup",
      "facility",
      "subscription",
      "dashboard",
    ];
    if (!ctx.h.launched && !allowedDuringSetup.includes(module)) {
      go("/onboarding");
      return;
    }
    const check = module === "onboarding" ? "setup" : module;
    if (module !== "dashboard" && !svc.can(db, check)) {
      setNotice(
        "Your current permissions no longer allow that page. Choose an authorized workflow.",
      );
      go("/dashboard");
      return;
    }
    if (session.lastRoute !== route)
      svc.rememberRoute(route).catch((e) => setError((e as Error).message));
  }, [db, route, loadedToken]);
  if (error && !db)
    return (
      <div className="standalone narrow">
        <Heading title="Unable to restore local records" />
        <ErrorBox message={error} />
        <Button onClick={load}>Retry storage</Button>
      </div>
    );
  if (!db) return <Skeleton />;
  if (route === "/simulation")
    return DEMO_MODE ? (
      <Simulation db={db} />
    ) : (
      <ErrorBox message="Simulation is disabled." />
    );
  if (route === "/patient-simulation")
    return DEMO_MODE ? (
      <PatientSimulator db={db} />
    ) : (
      <ErrorBox message="Simulation is disabled." />
    );
  if (route === "/accept-invitation")
    return (
      <AuthShell>
        <Heading title="Accept an invitation" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = String(
              new FormData(e.currentTarget).get("invitation"),
            );
            const invitation = value.includes("/invitation/")
              ? value.split("/invitation/")[1]
              : value;
            go("/invitation/" + invitation);
          }}
        >
          <label>
            Local invitation link or ID
            <input name="invitation" required />
          </label>
          <Button type="submit">Review invitation</Button>
        </form>
        <AuthLinks />
      </AuthShell>
    );
  if (
    ["/signin", "/register", "/verify", "/recover", "/reset-password"].some(
      (p) => route.startsWith(p),
    ) ||
    route.startsWith("/invitation/")
  )
    return <AuthPage key={route} route={route} db={db} />;
  if (loadedToken !== svc.token())
    return (
      <div className="standalone" role="status">
        Restoring your workspace?
      </div>
    );
  if (route === "/institutions")
    return (
      <>
        <div className="route-notice">{notice}</div>
        <Institutions db={db} />
      </>
    );
  if (!ctx && session && route === "/profile")
    return (
      <div className="standalone">
        <Button secondary onClick={() => go("/institutions")}>
          Back to workspaces
        </Button>
        <StaffProfile db={db} />
      </div>
    );
  if (!ctx)
    return (
      <div className="standalone" role="status">
        Resolving your workspace…
      </div>
    );
  const { h, m, s, a } = ctx;
  const items = navigation(db);
  const current = route.split("/")[1];
  const sourceModule = allModules.find((mod) => mod.id === current);
  const mod = sourceModule
    ? { ...sourceModule, title: moduleTitle(current) }
    : undefined;
  const parent = items.find((i) => i.children?.some((c) => c.id === current));
  const contexts = db.memberships
    .filter((x) => x.accountId === a.id && x.status === "active")
    .reduce((n, x) => n + x.branchIds.length, 0);
  const notes = svc.visibleNotifications(db);
  async function switchContext(discard = false) {
    if (discard) {
      const prefix = [a.id, h.id, s.branchId].join(":") + ":";
      for (const key of Object.keys(db!.drafts).filter((k) =>
        k.startsWith(prefix),
      ))
        await svc.saveDraft(key.slice(prefix.length), null);
    }
    setSwitching(false);
    go("/institutions");
  }
  return (
    <div className={"hid-shell" + (collapsed ? " sidebar-collapsed" : "")}>
      <PresenceRuntime db={db} />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        className={
          "waya-sidebar" +
          (collapsed ? " is-collapsed" : "") +
          (mobile ? " mobile-open" : "")
        }
      >
        <div className="workspace-brand">
          <img
            className={collapsed ? "health-id-mark" : "health-id-lockup"}
            src={collapsed ? "brand/logo-icon.png" : "brand/logo.png"}
            alt="Health ID"
          />
          {!collapsed && <small>Hospital EHR</small>}
        </div>
        <WorkspaceNavigation
          db={db}
          items={items}
          current={current}
          collapsed={collapsed}
          close={() => setMobile(false)}
        />
        <div className="sidebar-footer">
          <button
            className="collapse-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => {
              setCollapsed(!collapsed);
              localStorage.setItem("sidebar-collapsed", String(!collapsed));
            }}
          >
            <Icon name="arrowLeft" size={17} />
            {!collapsed && "Collapse sidebar"}
          </button>
        </div>
      </aside>
      <header className="hid-topbar workspace-topbar">
        <Button
          secondary
          className="mobile-trigger"
          onClick={() => setMobile(!mobile)}
        >
          Menu
        </Button>
        {h.logo && (
          <img
            className="hospital-mini-logo"
            src={h.logo}
            alt={h.name + " logo"}
          />
        )}
        {contexts > 1 ? (
          <Button
            secondary
            onClick={() => setSwitching(true)}
            aria-label="Switch hospital or branch"
          >
            {h.name} · {db.branches.find((b) => b.id === s.branchId)?.name}
          </Button>
        ) : (
          <strong className="facility-context">{h.name}</strong>
        )}
        <span className="topbar-fill" />
        <WorkspaceSearch
          items={items.flatMap((i) =>
            i.children ? i.children : [{ id: i.id, title: i.title }],
          )}
          db={db}
        />
        {DEMO_MODE && <DemoChip />}
        <Button
          secondary
          aria-label="Notifications"
          onClick={() => setNotification(!notification)}
        >
          <Icon name="bell" />
          <span className="sr-only">Notifications</span>
          {notes.some((n) => n.status === "unread") && (
            <span className="notification-count">
              {notes.filter((n) => n.status === "unread").length}
            </span>
          )}
        </Button>
        <AccountMenu db={db} />
      </header>
      <main className="emr-main" id="main-content">
        <OfflineBanner />
        {notice && (
          <div className="info">
            {notice}
            <button onClick={() => setNotice("")} aria-label="Dismiss notice">
              ×
            </button>
          </div>
        )}
        <ErrorBox message={error} />
        {a.forcePasswordChange && (
          <p role="alert" className="info">
            Finish invitation setup:{" "}
            <a href="#/profile">change your password</a> before making workspace
            changes.
          </p>
        )}
        {notification && (
          <Drawer
            open={notification}
            title="Notifications"
            onClose={() => setNotification(false)}
          >
            {notes.length ? (
              notes
                .slice()
                .reverse()
                .map((n) => (
                  <div className="list-row" key={n.id}>
                    <span>{str(n.data.text)}</span>
                    <Operation
                      secondary
                      onClick={async () => {
                        await svc.markRead(n.id);
                        go(str(n.data.route));
                        setNotification(false);
                      }}
                    >
                      Open record
                    </Operation>
                  </div>
                ))
            ) : (
              <EmptyState title="You are up to date">
                New assignments and alerts will appear here.
              </EmptyState>
            )}
          </Drawer>
        )}
        {pendingFacility(h) && current !== "facility" && (
          <Banner
            title="Facility verification"
            tone={h.verification === "rejected" ? "critical" : "warning"}
          >
            Facility {h.verification.replaceAll("_", " ")}. Clinical modules are
            locked until verification is approved. {h.verificationReason}
          </Banner>
        )}
        {current !== "dashboard" &&
          current !== "subscription" &&
          svc.can(db, "subscription") &&
          !!db.subscriptionReminders?.length && (
            <Banner title="Renewal reminder" tone="warning">
              <a href="#/subscription">
                Facility renewal reminders ({db.subscriptionReminders.length})
              </a>
            </Banner>
          )}
        {current === "profile" ? (
          <>
            <Drawer
              open
              title="Edit my profile"
              onClose={() => {
                if (history.state?.profileDrawer) history.back();
                else go("/dashboard");
              }}
            >
              <StaffProfile db={db} />
            </Drawer>
          </>
        ) : current === "facility" ? (
          <FacilityProfile db={db} />
        ) : current === "subscription" ? (
          <SubscriptionPage db={db} />
        ) : current === "dashboard" ? (
          pendingFacility(h) ? (
            <Card>
              <h1>Facility review in progress</h1>
              <p>
                Contact your facility administrator. Clinical workspaces will
                become available after approval.
              </p>
            </Card>
          ) : (
            <Dashboard db={db} />
          )
        ) : ["onboarding", "setup"].includes(current) ? (
          <Onboarding db={db} />
        ) : current === "platform" ? (
          <Platform db={db} />
        ) : current === "staff" ? (
          <Staff db={db} />
        ) : current === "reports" ? (
          <Reports db={db} />
        ) : current === "audit" ? (
          <>
            <Heading title="Audit & Compliance" />
            <p>
              Local simulation audit. This browser storage is not tamper-proof.
            </p>
            <Card>
              {db.audit
                .filter(
                  (e) =>
                    e.hospitalId === h.id &&
                    (!e.branchId || e.branchId === s.branchId),
                )
                .slice()
                .reverse()
                .map((e) => (
                  <div className="list-row" key={e.id}>
                    <span>
                      <strong>{e.action}</strong>
                      <small className="block">
                        {e.at} · actor {e.actorId} · membership {e.membershipId}
                      </small>
                      <small>
                        {e.resource} · {e.reason}
                      </small>
                    </span>
                  </div>
                ))}
            </Card>
          </>
        ) : mod ? (
          <>
            {parent?.children && (
              <nav className="module-tabs" aria-label={parent.title}>
                {parent.children.map((child) => (
                  <Button
                    key={child.id}
                    secondary
                    aria-current={child.id === current ? "page" : undefined}
                    onClick={() => go("/" + child.id)}
                  >
                    {child.title}
                  </Button>
                ))}
              </nav>
            )}
            <Workflow
              key={current}
              module={mod}
              db={db}
              recordId={route.split("/")[2]}
            />
          </>
        ) : (
          <ErrorBox message="This route is unavailable." />
        )}
      </main>
      <Drawer
        open={switching}
        title="Switch hospital or branch"
        onClose={() => setSwitching(false)}
      >
        <p>
          Saved drafts stay with their hospital and branch. Patient context does
          not carry across institutions.
        </p>
        <div className="actions">
          <Operation onClick={() => switchContext(false)}>
            Save and switch
          </Operation>
          <Operation secondary onClick={() => switchContext(true)}>
            Discard drafts and switch
          </Operation>
          <Button secondary onClick={() => setSwitching(false)}>
            Cancel
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
class Boundary extends React.Component<
  React.PropsWithChildren,
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="standalone">
        <h1>Unable to open this view</h1>
        <p>
          Saved records have not been reset. Reload to restore the workspace.
        </p>
        <Button onClick={() => location.reload()}>Reload</Button>
        <Button
          secondary
          onClick={() => {
            go("/dashboard");
            this.setState({ error: false });
          }}
        >
          Return to workspace
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
if ("serviceWorker" in navigator)
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <div id="health-id-workspace">
      <App />
    </div>
    <FeedbackHost />
    <ConnectionBoundary>
      <OfflineTools />
    </ConnectionBoundary>
  </Boundary>,
);
