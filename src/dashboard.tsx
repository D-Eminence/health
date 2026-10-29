import React, { useState } from "react";
import { Database, RecordEntity, Role, roles, num, str } from "./model";
import * as svc from "./service";
import {
  navigation,
  navigationRegistry,
  destination,
  moduleTitle,
} from "./navigation";
import { allModules } from "./catalog";
import { Button, Card, Heading, Operation, recordName } from "./ui";
import { Drawer, EmptyState } from "./feedback";
import { SubscriptionCard } from "./subscription";
import { connectionAvailable } from "./connectivity";
import { plural } from "./copy";

class Widget extends React.Component<
  React.PropsWithChildren<{ title: string }>,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return (
      <section className="dashboard-widget" aria-label={this.props.title}>
        <h2>{this.props.title}</h2>
        {this.state.failed ? (
          <>
            <p>
              This summary is unavailable. Other work areas remain available.
            </p>
            <Button secondary onClick={() => this.setState({ failed: false })}>
              Retry
            </Button>
          </>
        ) : (
          this.props.children
        )}
      </section>
    );
  }
}
const closed = [
  "completed",
  "published",
  "fulfilled",
  "closed",
  "paid",
  "discharged",
  "cancelled",
  "void",
  "signed",
  "dispensed",
  "resolved",
  "recorded",
  "active",
  "available",
];
const priorities: Record<string, string[]> = {
  "Hospital Owner": ["inventory", "procurement", "hr", "insurance", "quality", "procurement", "shifts", "ambulance"],
  "Hospital Admin": ["inventory", "procurement", "hr", "insurance", "quality", "procurement", "shifts", "ambulance"],
  "Medical Director": ["quality", "consult", "referrals", "lab"],
  Nurse: ["nursing-tasks", "triage", "inpatient", "maternity"],
  Receptionist: ["appointments", "journey"],
  "Records Officer": ["patients"],
  "Lab Manager": ["lab", "inventory", "procurement", "bloodbank"],
  "Lab Scientist": ["lab", "bloodbank"],
  "Radiology Reporter": ["radiology"],
  Pharmacist: ["pharmacy", "inventory"],
  "Pharmacy Manager": ["pharmacy", "inventory", "procurement"],
  "Billing Officer": ["insurance", "billing"],
  Cashier: ["billing", "insurance"],
};
function attention(r: RecordEntity, module: string, db: Database) {
  if (module === "inventory") {
    const batches = svc.scoped(db, "batch").filter((b) => b.parentId === r.id);
    return (
      batches.reduce((n, b) => n + num(b.data.quantity), 0) <=
        num(r.data.threshold) ||
      batches.some(
        (b) =>
          num(b.data.quantity) > 0 &&
          Date.parse(str(b.data.expiry)) < Date.now() + 30 * 86400000,
      )
    );
  }
  if (module === "hr") return Date.parse(str(r.data.expiry)) < Date.now() + 30 * 86400000;
  if (module === "patients") return false;
  return !closed.includes(r.status);
}
export function Dashboard({ db }: { db: Database }) {
  const { a, h, m, s } = svc.context(db);
  const [period, setPeriod] = useState("week"),
    [editing, setEditing] = useState(false),
    [target, setTarget] = useState(""),
    [draft, setDraft] = useState<string[]>([]);
  const items = navigation(db).filter((i) => i.id !== "dashboard");
  const choices = target
    ? navigationRegistry.filter((i) => i.id !== "dashboard")
    : items;
  const saved = m.shortcuts ?? h.dashboardDefaults?.[m.role];
  const shortcuts = (saved ?? items.slice(0, 4).map((i) => i.id))
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is (typeof items)[number] => !!i)
    .slice(0, 6);
  const modules = allModules.filter((mod) => svc.can(db, mod.id));
  const days = period === "today" ? 1 : period === "week" ? 7 : 30;
  const end = new Date();
  end.setHours(24, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const previous = new Date(start);
  previous.setDate(previous.getDate() - days);
  const within = (r: RecordEntity) =>
    Date.parse(r.createdAt) >= +start && Date.parse(r.createdAt) < +end;
  const preferred = priorities[m.role] || [
    "appointments",
    "consult",
    "lab",
    "referrals",
  ];
  const rows = preferred
    .filter((id) => svc.can(db, id))
    .flatMap((id) =>
      svc
        .records(db, id)
        .filter((r) => attention(r, id, db))
        .map((r) => ({ r, id })),
    )
    .sort((a, b) => {
      const score = (r: RecordEntity) =>
        /urgent|emergency|critical/i.test(
          str(r.data.priority || r.data.urgency),
        )
          ? 0
          : r.data.due && Date.parse(str(r.data.due)) < Date.now()
            ? 1
            : 2;
      return (
        score(a.r) - score(b.r) ||
        Date.parse(a.r.createdAt) - Date.parse(b.r.createdAt)
      );
    });
  const daily = modules
    .filter((mod) =>
      [
        "appointments",
        "journey",
        "patients",
        "lab",
        "radiology",
        "pharmacy",
        "nursing-tasks",
        "consult",
        "ambulance",
      ].includes(mod.id),
    )
    .flatMap((mod) =>
      svc
        .records(db, mod.id)
        .filter(
          (r) =>
            (str(r.data.starts || r.data.due || r.data.date || r.data.scheduledAt) || r.createdAt).slice(
              0,
              10,
            ) === new Date().toLocaleDateString("en-CA"),
        )
        .map((r) => ({ r, id: mod.id })),
    )
    .slice(0, 8);
  const invoice = svc.records(db, "billing").filter((r) => r.status !== "void");
  const current = invoice.filter(within),
    prior = invoice.filter(
      (r) =>
        Date.parse(r.createdAt) >= +previous &&
        Date.parse(r.createdAt) < +start,
    );
  const total = (rs: RecordEntity[]) =>
    rs.reduce((n, r) => n + num(r.data.totalCents), 0);
  const payments = svc.can(db, "billing") ? svc.scoped(db, "payment").filter(r => invoice.some(i => i.id === r.parentId)) : [];
  const collected = payments.filter(within).reduce((n,r) => n + num(r.data.cents),0);
  const priorCollected = payments.filter(r => Date.parse(r.createdAt) >= +previous && Date.parse(r.createdAt) < +start).reduce((n,r) => n + num(r.data.cents),0);
  const money = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: h.currency || "NGN",
      maximumFractionDigits: 0,
    }).format(n / 100);
  const updated = modules
    .flatMap((mod) => svc.records(db, mod.id))
    .reduce((latest, r) => (r.updatedAt > latest ? r.updatedAt : latest), "");
  return (
    <>
      <Heading title={"Welcome, " + a.name}>
        <Button
          secondary
          onClick={() => {
            setTarget("");
            setDraft(shortcuts.map((i) => i.id));
            setEditing(true);
          }}
        >
          Customize shortcuts
        </Button>
      </Heading>
      {!h.launched && svc.can(db, "setup") && (
        <Card>
          <h2>Finish facility setup</h2>
          <p>
            Complete your facility details, departments and staff access before
            opening daily work.
          </p>
          <a href="#/setup">Continue setup · step {h.step + 1}</a>
          <ol className="setup-checklist">{["Facility details", "Provider type", "Departments", "Branches", "Staff", "Roles", "Billing", "Review", "Launch"].map((step,index)=><li key={step}>{index < h.step ? "Complete: " : index === h.step ? "Next: " : "To do: "}{step}</li>)}</ol>
        </Card>
      )}
      <SubscriptionCard db={db} />
      {!connectionAvailable() && (
        <p className="muted">
          Cached data · Last record update:{" "}
          {updated ? new Date(updated).toLocaleString() : "No cached activity"}
        </p>
      )}
      <div className="dashboard-period">
        <label>
          Reporting period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
          </select>
        </label>
        <small>Record creation dates · local time</small>
      </div>
      <div className="dashboard-columns">
        {svc.can(db, "billing") && (
          <Widget title="Patient billing">
            {invoice.length ? (
              <>
                <div className="dashboard-metrics">
                  <div>
                    <span>Invoiced in period</span>
                    <strong>{money(total(current))}</strong>
                    <small>
                      {total(prior)
                        ? `${(((total(current) - total(prior)) / total(prior)) * 100).toFixed(0)}% vs previous period`
                        : "No comparison yet"}
                    </small>
                  </div>
                  <div>
                    <span>Collected in period</span>
                    <strong>{money(collected)}</strong>
                    <small>{priorCollected ? `${((collected-priorCollected)/priorCollected*100).toFixed(0)}% vs previous period` : "No comparison yet"} · Before refunds</small>
                  </div>
                  <div>
                    <span>Outstanding balance</span>
                    <strong>
                      {money(
                        invoice.reduce((n, r) => n + svc.balance(db, r).due, 0),
                      )}
                    </strong>
                    <small>All open invoices</small>
                  </div>
                </div>
                <a href="#/billing">View patient billing</a>
              </>
            ) : (
              <EmptyState title="No invoices yet">
                Patient invoices and outstanding balances will appear after
                billing activity. <a href="#/billing">Go to patient billing</a>
              </EmptyState>
            )}
          </Widget>
        )}
        {!svc.can(db, "billing") &&
          modules.some((mod) => svc.records(db, mod.id).some(within)) && (
            <Widget title="Activity in period">
              <div className="dashboard-metrics">
                {modules
                  .filter((mod) => svc.records(db, mod.id).some(within))
                  .slice(0, 4)
                  .map((mod) => {
                    const records = svc.records(db, mod.id),
                      count = records.filter(within).length,
                      before = records.filter(
                        (r) =>
                          Date.parse(r.createdAt) >= +previous &&
                          Date.parse(r.createdAt) < +start,
                      ).length;
                    return (
                      <div key={mod.id}>
                        <span>{moduleTitle(mod.id)} created</span>
                        <strong>{count}</strong>
                        <small>
                          {before
                            ? `${(((count - before) / before) * 100).toFixed(0)}% vs previous period`
                            : "No comparison yet"}
                        </small>
                      </div>
                    );
                  })}
              </div>
            </Widget>
          )}
        {svc.can(db, "staff") && (
          <Widget title="People">
            <strong className="stat-value">
              {
                db.memberships.filter(
                  (x) =>
                    x.hospitalId === h.id &&
                    x.branchIds.includes(s.branchId) &&
                    x.status === "active",
                ).length
              }
            </strong>
            <p>Active staff in this branch</p>
            <a href="#/staff">Manage staff & access</a>
          </Widget>
        )}
        {svc.can(db, "platform") && (
          <Widget title="Facility review">
            <p>
              {
                db.hospitals.filter(
                  (x) => x.verification === "pending_verification",
                ).length
              }{" "}
              facilities awaiting review
            </p>
            <a href="#/platform">Review facilities</a>
          </Widget>
        )}
        <Widget title="Needs attention">
          {rows.length ? (
            <ul className="dashboard-worklist">
              {rows.slice(0, 8).map(({ r, id }) => (
                <li key={id + r.id}>
                  <a href={`#/${id}/${r.id}`}>
                    <strong>{recordName(r)}</strong>
                    <span>
                      {moduleTitle(id)} · {r.status.replaceAll("-", " ")}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No open items in your worklist">
              New work requiring review will appear here. Use your work area to
              review completed records.
            </EmptyState>
          )}
        </Widget>
        <Widget title="Today">
          {daily.length ? (
            <ul className="dashboard-worklist">
              {daily.map(({ r, id }) => (
                <li key={id + r.id}>
                  <a href={`#/${id}/${r.id}`}>
                    <strong>{recordName(r)}</strong>
                    <span>
                      {moduleTitle(id)} · {r.status}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity recorded today">
              Your permitted appointments and daily work will appear here as
              records are saved.
            </EmptyState>
          )}
        </Widget>
      </div>
      <section className="dashboard-shortcuts" aria-label="Pinned shortcuts">
        <h2>Pinned shortcuts</h2>
        <div className="actions">
          {shortcuts.map((item) => (
            <a
              className="button secondary"
              key={item.id}
              href={"#" + destination(item)}
            >
              {item.title}
            </a>
          ))}
        </div>
        {!shortcuts.length && (
          <p>Pin up to six work areas using Customize shortcuts.</p>
        )}
      </section>
      <Drawer
        open={editing}
        title="Customize shortcuts"
        onClose={() => setEditing(false)}
      >
        <p>
          Choose up to six shortcuts. Permissions are checked each time they are
          displayed.
        </p>
        {["Hospital Owner", "Hospital Admin"].includes(m.role) &&
          svc.can(db, "setup", "edit") && (
            <label>
              Layout for
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setDraft(
                    e.target.value
                      ? h.dashboardDefaults?.[e.target.value as Role] || []
                      : shortcuts.map((i) => i.id),
                  );
                }}
              >
                <option value="">My shortcuts</option>
                {roles.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
          )}
        {choices.map((item) => (
          <label className="shortcut-choice" key={item.id}>
            <input
              type="checkbox"
              checked={draft.includes(item.id)}
              disabled={!draft.includes(item.id) && draft.length >= 6}
              onChange={(e) =>
                setDraft(
                  e.target.checked
                    ? [...draft, item.id]
                    : draft.filter((id) => id !== item.id),
                )
              }
            />
            {item.title}
          </label>
        ))}
        <ol>
          {draft.map((id, index) => (
            <li key={id}>
              {choices.find((i) => i.id === id)?.title || id}
              <Button
                secondary
                disabled={index === 0}
                aria-label={"Move " + id + " up"}
                onClick={() => {
                  const next = [...draft];
                  [next[index - 1], next[index]] = [
                    next[index],
                    next[index - 1],
                  ];
                  setDraft(next);
                }}
              >
                Move up
              </Button>
            </li>
          ))}
        </ol>
        <Operation
          onClick={async () => {
            await svc.saveShortcuts(
              draft,
              target ? (target as Role) : undefined,
            );
            setEditing(false);
          }}
        >
          Save shortcuts
        </Operation>
      </Drawer>
    </>
  );
}
