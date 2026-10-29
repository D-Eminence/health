import { connectionAvailable } from "./connectivity";
import { Drawer, EmptyState, confirmAction, Banner, toast } from "./feedback";
import { SubscriptionCard } from "./subscription";
import React, { useEffect, useState } from "react";
import { Database, Fields, Kind, RecordEntity, id, num, str } from "./model";
import { Action, Module, allModules, Field } from "./catalog";
import * as svc from "./service";
import {
  Badge,
  Button,
  Card,
  DataView,
  ErrorBox,
  Form,
  Heading,
  Operation,
  download,
  go,
  recordName,
} from "./ui";
export function Workflow({
  module,
  db,
  recordId,
}: {
  module: Module;
  db: Database;
  recordId?: string;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Action | null>(null);
  const [patient, setPatient] = useState("");
  const [editing, setEditing] = useState(false);
  const [quick, setQuick] = useState<RecordEntity | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    setSelected(null);
    setEditing(false);
    setPatient(str(svc.draft(db, "context-" + module.id)?.patient));
    setSearch("");
    setPage(0);
  }, [module.id, recordId]);
  if (!svc.can(db, module.id))
    return (
      <ErrorBox message="Permission denied. This membership or branch cannot open this module." />
    );
  const list = svc.records(db, module.id);
  const item =
    recordId && recordId !== "new"
      ? list.find((r) => r.id === recordId)
      : undefined;
  const patientRecords = svc.scoped(db, "patient");
  const create = recordId === "new";
  if (recordId && !create && !item)
    return (
      <>
        <Heading title="Record not found" />
        <p>
          The record is missing or outside your authorized hospital / branch.
        </p>
        <Button onClick={() => go("/" + module.id)}>Back to list</Button>
      </>
    );
  if (create && !svc.can(db, module.id, "create"))
    return (
      <ErrorBox message="You do not have permission to create this record." />
    );
  const heading = create
    ? "New " + module.title.toLowerCase()
    : item
      ? recordName(item)
      : module.title;
  const historyPatient = item?.kind === "patient" ? item.id : item?.patientId;
  const recordPatient = item?.patientId
    ? patientRecords.find((p) => p.id === item.patientId)
    : undefined;
  const filters = list.filter((r) => {
    const p = patientRecords.find((p) => p.id === r.patientId);
    const mrn = svc.scoped(db, "registration").find((x) => x.patientId === r.id)
      ?.data.mrn;
    return (JSON.stringify(r.data) + " " + str(p?.data.name) + " " + str(mrn))
      .toLowerCase()
      .includes(search.toLowerCase());
  });
  async function nextWorkflow(target: string) {
    const patientId = item?.kind === "patient" ? item.id : item?.patientId;
    if (!patientId) return;
    await svc.saveDraft("context-" + target, { patient: patientId });
    const existing = svc.draft(db, "new-" + target + "-" + patientId) || {};
    await svc.saveDraft("new-" + target + "-" + patientId, {
      quantity: 1,
      priority: "Routine",
      urgency: "Routine",
      ...existing,
      ...(item?.kind === "encounter" ? { encounter: item.id } : {}),
      ...(item?.kind === "visit" ? { visit: item.id } : {}),
      ...(item?.kind === "admission" ? { admission: item.id } : {}),
    });
    go("/" + target + "/new");
  }
  async function exportData() {
    download(
      "health-id-" + module.id + ".json",
      (await svc.exportModule(module.id)).filter((r) =>
        filters.some((f) => f.id === r.id),
      ),
    );
  }
  return (
    <>
      <Drawer
        open={!!quick}
        title="Record quick view"
        onClose={() => setQuick(null)}
      >
        {quick && (
          <>
            <h3>{recordName(quick)}</h3>
            <RecordSyncStatus
              record={db.records.find((r) => r.id === quick.id) || quick}
            />
            <p>Last updated {new Date(quick.updatedAt).toLocaleString()}</p>
            <DataView data={quick.data} db={db} />
            <Button
              onClick={() => {
                setQuick(null);
                go("/" + module.id + "/" + quick.id);
              }}
            >
              Open full record
            </Button>
          </>
        )}
      </Drawer>
      {!connectionAvailable() && (
        <Banner title="Cached records">
          <p>
            Last local update:{" "}
            {list.length
              ? new Date(
                  Math.max(...list.map((r) => Date.parse(r.updatedAt))),
                ).toLocaleString()
              : "No cached records yet"}
            . Reconnect to check for newer information.
          </p>
        </Banner>
      )}
      <Heading title={heading}>
        <div className="actions">
          {recordId && (
            <Button secondary onClick={() => go("/" + module.id)}>
              Back to list
            </Button>
          )}
          {!recordId && svc.can(db, module.id, "create") && (
            <Button onClick={() => go("/" + module.id + "/new")}>
              Create record
            </Button>
          )}
          {!recordId && svc.can(db, module.id, "export") && (
            <Operation secondary onClick={exportData}>
              Export filtered records
            </Operation>
          )}
        </div>
      </Heading>
      {create && (
        <Card>
          {module.patient && (
            <label>
              Patient *
              <select
                aria-label="Patient"
                value={patient}
                onChange={(e) => {
                  setPatient(e.target.value);
                  svc.saveDraft("context-" + module.id, {
                    patient: e.target.value,
                  });
                }}
              >
                <option value="">Select registered patient</option>
                {patientRecords.map((p) => (
                  <option key={p.id} value={p.id}>
                    {recordName(p)} · {str(p.data.healthId)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {patient && ["consult", "triage", "pharmacy"].includes(module.id) && (
            <section className="record-block">
              <h2>Patient context</h2>
              <p>{recordName(patientRecords.find((p) => p.id === patient)!)}</p>
              <p>
                Recorded allergies:{" "}
                {str(
                  patientRecords.find((p) => p.id === patient)?.data.allergies,
                ) || "None recorded. Confirm with the patient."}
              </p>
              {["consult", "triage"].includes(module.id) &&
                svc
                  .scoped(db, "triage")
                  .filter((r) => r.patientId === patient)
                  .map((r) => (
                    <details key={r.id}>
                      <summary>
                        Triage ? {r.status} ?{" "}
                        {new Date(r.updatedAt).toLocaleString()}
                      </summary>
                      <DataView data={r.data} db={db} />
                    </details>
                  ))}
            </section>
          )}
          {(!module.patient || patient) && (
            <Form
              key={module.id + patient}
              db={db}
              draftKey={"new-" + module.id + "-" + patient}
              contextPatient={patient}
              fields={module.fields}
              initial={{
                quantity: 1,
                packSize: 1,
                duration: 30,
                priority: "Routine",
                urgency: "Routine",
              }}
              label="Save record"
              onSubmit={async (data, op) => {
                const result = await svc.createRecord(
                  module.id,
                  data,
                  patient,
                  op,
                );
                go("/" + module.id + (result ? "/" + result : ""));
              }}
            >
              {module.id === "patients" && (
                <p>
                  Duplicate review uses name plus date of birth or phone. No
                  automatic merges. To register a distinct person with a match,
                  enable the review confirmation below.
                </p>
              )}
            </Form>
          )}
          {module.id === "patients" && (
            <Form
              fields={[]}
              label="Register reviewed duplicate as distinct person"
              onSubmit={async () => {
                const data = svc.draft(db, "new-patients-");
                if (!data) throw Error("Complete patient details first.");
                if (
                  !(await confirmAction({
                    title: "Register a distinct person?",
                    body: "Confirm you have reviewed the matching demographics. This creates a separate identity and does not link or merge records.",
                    action: "Register distinct person",
                  }))
                )
                  return;
                const result = await svc.createRecord(
                  "patients",
                  { ...data, duplicateReviewed: true },
                  "",
                  id(),
                );
                go("/patients/" + result);
              }}
            />
          )}
        </Card>
      )}
      {!recordId && (
        <>
          <Card>
            <label>
              Search {module.title}
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search saved records…"
              />
            </label>
            {search && (
              <Button
                secondary
                onClick={() => {
                  const previous = search;
                  setSearch("");
                  toast("filters", {
                    action: () => {
                      setSearch(previous);
                    },
                  });
                }}
              >
                Clear search
              </Button>
            )}
            {filters.length > 50 && (
              <nav className="actions" aria-label="Record pages">
                <Button
                  secondary
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous page
                </Button>
                <span>
                  Page {page + 1} of {Math.ceil(filters.length / 50)}
                </span>
                <Button
                  secondary
                  disabled={(page + 1) * 50 >= filters.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next page
                </Button>
              </nav>
            )}
            {filters.length === 0 ? (
              <EmptyState title="No matching records">
                {" "}
                {list.length
                  ? "Change your search."
                  : "Create the first record when you have the appropriate permission."}
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Patient / context</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filters.slice(page * 50, (page + 1) * 50).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <a href={"#/" + module.id + "/" + r.id}>
                            {recordName(r)}
                          </a>
                          <small className="block">{r.id.slice(0, 8)}</small>
                        </td>
                        <td>
                          {recordName(
                            patientRecords.find((p) => p.id === r.patientId) ||
                              r,
                          )}
                          {module.id === "patients" && (
                            <small className="block">
                              {str(r.data.healthId)} ·{" "}
                              {str(
                                svc
                                  .scoped(db, "registration")
                                  .find((x) => x.patientId === r.id)?.data.mrn,
                              )}
                            </small>
                          )}
                        </td>
                        <td>
                          <Badge>{r.status}</Badge>
                          <RecordSyncStatus record={r} />
                        </td>
                        <td>{new Date(r.updatedAt).toLocaleString()}</td>
                        <td>
                          <Button secondary onClick={() => setQuick(r)}>
                            Quick view
                          </Button>
                          <a href={"#/" + module.id + "/" + r.id}>Open →</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {module.id === "journey" && (
            <p>
              Journey stages are derived from visits, triage, encounters,
              investigations, prescriptions and invoices. Pending activities can
              run in parallel.
            </p>
          )}
        </>
      )}
      {item && (
        <>
          <div className="context-line">
            <Badge>{item.status}</Badge>
            <RecordSyncStatus record={item} />
            {recordPatient && (
              <span>
                {recordName(recordPatient)} · {str(recordPatient.data.healthId)}
              </span>
            )}
            <small>Saved {new Date(item.updatedAt).toLocaleString()}</small>
          </div>
          <div className="two-col">
            <Card>
              <h2>Saved record</h2>
              {["consult", "triage"].includes(module.id) &&
                item.status === "draft" &&
                svc.can(db, module.id, "edit") && (
                  <Button secondary onClick={() => setEditing(!editing)}>
                    {editing ? "Cancel editing" : "Edit unsigned draft"}
                  </Button>
                )}
              {editing && (
                <Form
                  key={item.id + "-edit"}
                  db={db}
                  draftKey={"edit-" + item.id}
                  contextPatient={item.patientId}
                  fields={module.fields}
                  initial={item.data}
                  label="Save draft changes"
                  onSubmit={async (data) => {
                    await svc.updateDraftRecord(module.id, item.id, data);
                    setEditing(false);
                  }}
                />
              )}
              <DataView data={item.data} db={db} />
              {module.id === "billing" && (
                <>
                  <DataView data={svc.balance(db, item)} />
                  <p>
                    Totals above are integer minor currency units (cents /
                    kobo). All payments are fictional.
                  </p>
                  <Button
                    secondary
                    onClick={() =>
                      download("receipt-" + item.id + ".json", {
                        invoice: item,
                        payments: svc
                          .scoped(db)
                          .filter(
                            (r) =>
                              ["payment", "refund"].includes(r.kind) &&
                              r.parentId === item.id,
                          ),
                        balance: svc.balance(db, item),
                      })
                    }
                  >
                    Download invoice / receipts
                  </Button>
                  <Button secondary onClick={() => window.print()}>
                    Print
                  </Button>
                </>
              )}
              {module.id === "inventory" && (
                <>
                  <h3>Stock batches</h3>
                  {svc
                    .scoped(db, "batch")
                    .filter((b) => b.parentId === item.id)
                    .map((b) => (
                      <p key={b.id}>
                        {str(b.data.lot)} · {str(b.data.quantity)} units ·
                        expires {str(b.data.expiry)}
                      </p>
                    ))}
                </>
              )}
            </Card>
            <Card>
              <h2>Available actions</h2>
              <div className="actions vertical">
                {module.actions
                  .filter(
                    (a) =>
                      a.from.includes(item.status) &&
                      svc.can(db, module.id, a.permission || "edit"),
                  )
                  .map((action) => (
                    <Button
                      key={action.id}
                      secondary
                      onClick={() => setSelected(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
              </div>
              {selected && (
                <Form
                  key={item.id + selected.id + item.updatedAt}
                  db={db}
                  draftKey={"action-" + item.id + "-" + selected.id}
                  contextPatient={item.patientId || ""}
                  fields={selected.fields || []}
                  label={selected.label}
                  onSubmit={async (data, op) => {
                    if (
                      [
                        "delete",
                        "cancel",
                        "void",
                        "refund",
                        "revoke",
                        "sign",
                      ].includes(selected.id) &&
                      !(await confirmAction({
                        title: selected.label + "?",
                        body: "Review the entered details before continuing. This action changes the saved record and is recorded in its history.",
                        action: selected.label,
                        word: ["delete", "sign", "refund"].includes(selected.id)
                          ? selected.id.toUpperCase()
                          : undefined,
                      }))
                    )
                      return false;
                    await svc.act(module.id, item.id, selected.id, data, op);
                    setSelected(null);
                  }}
                />
              )}
              {!module.actions.some(
                (a) =>
                  a.from.includes(item.status) &&
                  svc.can(db, module.id, a.permission || "edit"),
              ) && (
                <p>
                  No further actions for your permission and this record state.
                </p>
              )}
              {module.id === "consult" && (
                <>
                  <h3>Connected orders</h3>
                  {["pharmacy", "lab", "radiology", "referrals"]
                    .filter((m) => svc.can(db, m, "create"))
                    .map((m) => (
                      <p key={m}>
                        <Operation secondary onClick={() => nextWorkflow(m)}>
                          Create{" "}
                          {allModules
                            .find((x) => x.id === m)
                            ?.title.toLowerCase()}{" "}
                          record
                        </Operation>
                      </p>
                    ))}
                  <p>
                    Patient and encounter carry into each order. Sign the
                    encounter before issuing orders; investigations retain their
                    own lifecycle.
                  </p>
                </>
              )}
              {["journey", "inpatient", "icu"].includes(module.id) && (
                <>
                  <h3>Continue care</h3>
                  {(module.id === "journey"
                    ? ["triage", "consult"]
                    : ["nursing", "nursing-tasks"]
                  )
                    .filter((m) => svc.can(db, m, "create"))
                    .map((m) => (
                      <Operation
                        key={m}
                        secondary
                        onClick={() => nextWorkflow(m)}
                      >
                        Create{" "}
                        {allModules
                          .find((x) => x.id === m)
                          ?.title.toLowerCase()}
                      </Operation>
                    ))}
                </>
              )}
              {module.id === "patients" && (
                <>
                  <h3>Next steps</h3>
                  {["appointments", "journey", "consent"]
                    .filter((m) => svc.can(db, m, "create"))
                    .map((m) => (
                      <p key={m}>
                        <Operation secondary onClick={() => nextWorkflow(m)}>
                          {m === "journey"
                            ? "Register walk-in visit"
                            : "Open " + m}
                        </Operation>
                      </p>
                    ))}
                </>
              )}
            </Card>
          </div>
          {historyPatient && (
            <Card>
              <h2>Connected hospital history</h2>
              <p>
                Only records available to your current permissions are listed.
              </p>
              {allModules
                .filter((m) => svc.can(db, m.id) && m.id !== module.id)
                .flatMap((m) =>
                  svc
                    .records(db, m.id)
                    .filter(
                      (r) =>
                        r.patientId === historyPatient &&
                        (module.id !== "journey" ||
                          r.visitId === item.id ||
                          r.parentId === item.id),
                    )
                    .map((r) => (
                      <div className="list-row" key={m.id + r.id}>
                        <a href={"#/" + m.id + "/" + r.id}>
                          {m.title} · {recordName(r)}
                        </a>
                        <Badge>{r.status}</Badge>
                      </div>
                    )),
                )}
            </Card>
          )}
          {item.versions.length > 0 && (
            <Card>
              <h2>Preserved versions & amendments</h2>
              {item.versions.map((v, i) => (
                <details key={i}>
                  <summary>
                    {v.at} · {v.status} · {v.reason}
                  </summary>
                  <p>Author: {v.authorId}</p>
                  <DataView data={v.data} db={db} />
                </details>
              ))}
            </Card>
          )}
          {module.id === "consent" && (
            <ExternalView db={db} patientId={item.patientId!} />
          )}
        </>
      )}
    </>
  );
}
export function ExternalView({
  db,
  patientId,
}: {
  db: Database;
  patientId: string;
}) {
  const [category, setCategory] = useState("Published results");
  const [open, setOpen] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const data = open ? svc.externalRecords(db, patientId, category) : [];
  const { a, h } = svc.context(db);
  const grant = db.records.find(
    (g) =>
      g.kind === "grant" &&
      g.patientId === patientId &&
      g.hospitalId === h.id &&
      g.data.clinician === a.id &&
      g.status === "active" &&
      num(g.data.expires) > Date.now() &&
      g.data.categories === category,
  );
  return (
    <Card>
      <h2>Cross-institution history</h2>
      <p>
        Local hospital care does not require an external access grant. External
        content is removed immediately on expiry or revocation.
      </p>
      <select
        aria-label="External category"
        value={category}
        onChange={(e) => {
          setCategory(e.target.value);
          setOpen(false);
        }}
      >
        <option>Published results</option>
        <option>Signed notes</option>
      </select>
      <Operation
        onClick={async () => {
          await svc.viewExternal(patientId, category);
          setOpen(true);
        }}
      >
        View authorized category
      </Operation>
      {open &&
        (!grant ? (
          <p role="status">
            No active grant for this category. Request approval in the separate
            patient simulator.
          </p>
        ) : (
          <>
            <p>
              Grant expires{" "}
              {new Date(num(grant.data.expires)).toLocaleTimeString()}.
            </p>
            {data.length ? (
              data.map((r) => <DataView key={r.id} data={r.data} />)
            ) : (
              <p>No released records in this category.</p>
            )}
          </>
        ))}
      <a href="#/patient-simulation">Open separate patient simulation</a>
      {svc.can(db, "consent", "emergency") && (
        <>
          <Button secondary onClick={() => setEmergency(!emergency)}>
            Emergency break-glass access
          </Button>
          {emergency && (
            <Form
              fields={[
                { key: "reason", label: "Emergency reason", required: true },
                {
                  key: "justification",
                  label: "Clinical justification",
                  type: "textarea",
                  required: true,
                },
                {
                  key: "ack",
                  label:
                    "I acknowledge patient notification, audit and 15-minute expiry",
                  type: "checkbox",
                  required: true,
                },
              ]}
              label="Record emergency access"
              onSubmit={async (data) => {
                await svc.emergencyGrant(patientId, {
                  ...data,
                  categories: category,
                });
                setEmergency(false);
              }}
            />
          )}
        </>
      )}
    </Card>
  );
}
export function PatientSimulator({ db }: { db: Database }) {
  const patients = db.records.filter((p) => p.kind === "patient");
  const [patientId, setPatient] = useState(patients[0]?.id || "");
  const patient = patients.find((p) => p.id === patientId);
  const requests = db.records.filter(
    (r) => ["consent", "grant"].includes(r.kind) && r.patientId === patientId,
  );
  return (
    <div className="standalone">
      <Heading
        title="Patient-side simulation"
        sub="Separate supporting tool · fictional identities"
      >
        <Button secondary onClick={() => go("/dashboard")}>
          Return to hospital
        </Button>
      </Heading>
      <p>
        This local development tool simulates a patient decision. It is not a
        consumer portal or real identity verification.
      </p>
      <label>
        Fictional patient
        <select value={patientId} onChange={(e) => setPatient(e.target.value)}>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {recordName(p)} ·{" "}
              {db.hospitals.find((h) => h.id === p.hospitalId)?.name}
            </option>
          ))}
        </select>
      </label>
      <Card>
        <h2>Access requests and grants</h2>
        {requests.length === 0 && <p>No requests.</p>}
        {requests.map((r) => (
          <div className="record-block" key={r.id}>
            <p>
              {db.hospitals.find((h) => h.id === r.hospitalId)?.name} ·{" "}
              {str(r.data.categories)} · {r.status}{" "}
              {r.kind === "grant" && num(r.data.expires) < Date.now()
                ? "(expired)"
                : ""}
            </p>
            <p>{str(r.data.reason)}</p>
            <div className="actions">
              {r.status === "pending" && (
                <>
                  <Operation
                    onClick={() => svc.patientDecision(r.id, "approve")}
                  >
                    Approve
                  </Operation>
                  <Operation
                    secondary
                    onClick={() => svc.patientDecision(r.id, "decline")}
                  >
                    Decline
                  </Operation>
                </>
              )}
              {["active", "approved"].includes(r.status) && (
                <Operation
                  secondary
                  onClick={() => svc.patientDecision(r.id, "revoke")}
                >
                  Revoke access
                </Operation>
              )}
            </div>
          </div>
        ))}
      </Card>
      <Card>
        <h2>Released records for this fictional identity</h2>
        {db.records
          .filter(
            (r) =>
              ["note", "labResult", "radiologyReport"].includes(r.kind) &&
              ["signed", "published"].includes(r.status) &&
              db.records.some(
                (p) =>
                  p.kind === "patient" &&
                  p.id === r.patientId &&
                  p.data.healthId === patient?.data.healthId,
              ),
          )
          .map((r) => (
            <DataView key={r.id} data={r.data} />
          ))}
      </Card>
    </div>
  );
}
export function Reports({ db }: { db: Database }) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  if (!svc.can(db, "reports"))
    return <ErrorBox message="Reports access denied" />;
  const valid = !from || !to || from <= to;
  const report = valid ? svc.reportMetrics(db, from, to) : {};
  return (
    <>
      <Heading title="Reports & Analytics" />
      <Card>
        <div className="form-grid">
          <label>
            Created from
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Created through
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <p>
          Scope: current hospital and branch. Date range selects records by
          creation date. Invoice collection includes payments and refunds
          against those invoices. Occupancy is occupied beds / total selected
          beds. Open queue time is elapsed minutes since entry.
        </p>
        <ErrorBox message={valid ? "" : "Start date must precede end date."} />
        <DataView data={report} />
        {valid && svc.can(db, "reports", "export") && (
          <Operation
            onClick={async () =>
              download(
                "health-id-report.json",
                await svc.exportReport(from, to),
              )
            }
          >
            Export report
          </Operation>
        )}
      </Card>
    </>
  );
}

export function Platform({ db }: { db: Database }) {
  if (!svc.can(db, "platform"))
    return <ErrorBox message="Platform access denied" />;
  return (
    <>
      <Heading title="Facility review" sub="Platform administration" />
      <p>
        Fictional review of locally registered hospitals. These decisions do not
        constitute independent verification.
      </p>
      {db.hospitals.map((h) => (
        <Card key={h.id}>
          <h2>{h.name}</h2>
          <Badge>{h.verification}</Badge>
          <DataView
            data={{
              registration: h.registration || "Not provided",
              address: h.address,
              email: h.email,
            }}
          />
          <Form
            fields={[
              {
                key: "status",
                label: "Review outcome",
                options: ["Pending review", "Verified", "Rejected"],
                required: true,
              },
              {
                key: "reason",
                label: "Review reason",
                type: "textarea",
                required: true,
              },
            ]}
            label="Save local review"
            onSubmit={async (data) =>
              svc.platformAction(h.id, str(data.status), str(data.reason))
            }
          />
        </Card>
      ))}
    </>
  );
}

function RecordSyncStatus({ record }: { record: RecordEntity }) {
  if (record.conflict?.status === "needs-review")
    return (
      <p role="status">
        Conflicting versions retained. Open connection details for clinical
        review.
      </p>
    );
  if (record.sync?.state === "pending")
    return <small>Saved on this device, waiting to sync.</small>;
  if (record.sync?.receivedAt)
    return (
      <small>Synced {new Date(record.sync.receivedAt).toLocaleString()}</small>
    );
  return null;
}
