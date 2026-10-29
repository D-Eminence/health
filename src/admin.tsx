import { Drawer, confirmAction, toast, EmptyState } from "./feedback";
import { Avatar } from "./profiles";
import React, { useState } from "react";
import {
  Branch,
  Database,
  Fields,
  Hospital,
  departments,
  facilityTypes,
  roles,
  str,
} from "./model";
import { Field, permissions } from "./catalog";
import * as svc from "./service";
import {
  Button,
  Card,
  DataView,
  ErrorBox,
  Form,
  Heading,
  Operation,
  go,
} from "./ui";
const field = (
  key: string,
  label: string,
  required = true,
  type: Field["type"] = "text",
): Field => ({ key, label, required, type });
export function Staff({
  db,
  compact = false,
}: {
  db: Database;
  compact?: boolean;
}) {
  const { h, m } = svc.context(db);
  const branches = db.branches.filter(
    (b) => b.hospitalId === h.id && m.branchIds.includes(b.id),
  );
  const [selected, set] = useState<string[]>([branches[0]?.id].filter(Boolean));
  const [edit, setEdit] = useState("");
  const [inviteOpen, setInvite] = useState(compact);
  const [checkedInvites, setCheckedInvites] = useState<string[]>([]);
  const [invitationDetail, setInvitationDetail] = useState<string>("");
  const members = db.memberships.filter((x) => x.hospitalId === h.id);
  const assignRoles = roles.filter(
    (r) =>
      r !== "Platform Super Admin" &&
      r !== "Hospital Owner" &&
      (m.role === "Hospital Owner" ||
        !["Hospital Admin", "Medical Director"].includes(r)),
  );
  return (
    <>
      <Heading title="Staff & access" sub="Hospital memberships">
        {svc.can(db, "staff", "create") && (
          <Button onClick={() => setInvite(!inviteOpen)}>Invite staff</Button>
        )}
      </Heading>
      {inviteOpen && (
        <Card>
          <h2>Invite a staff member</h2>
          <div className="checks">
            {branches.map((b) => (
              <label key={b.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(b.id)}
                  onChange={() =>
                    set(
                      selected.includes(b.id)
                        ? selected.filter((x) => x !== b.id)
                        : [...selected, b.id],
                    )
                  }
                />
                {b.name}
              </label>
            ))}
          </div>
          <Form
            key="invite"
            db={db}
            draftKey="staff-invitation"
            fields={[
              field("name", "Name"),
              field("email", "Email", true, "email"),
              {
                key: "role",
                label: "Assigned role",
                options: [...assignRoles],
                required: true,
              },
              {
                key: "department",
                label: "Department",
                options: ["Administration", ...h.departments],
                required: true,
              },
            ]}
            label="Create local invitation"
            onSubmit={async (data) => {
              await svc.invite({ ...data, branches: selected });
              setInvite(false);
            }}
          />
        </Card>
      )}
      <Card>
        <h2>Memberships</h2>
        {members.map((member) => (
          <div key={member.id} className="record-block">
            <div className="list-row">
              <div>
                <Avatar
                  src={
                    db.accounts.find((a) => a.id === member.accountId)?.photo
                  }
                  name={
                    db.accounts.find((a) => a.id === member.accountId)?.name ||
                    member.role
                  }
                />
                <strong>
                  {db.accounts.find((a) => a.id === member.accountId)?.name}
                </strong>
                <p>
                  {member.role} · {member.status} · {member.leave}
                </p>
              </div>
              {svc.can(db, "staff", "edit") &&
                member.role !== "Hospital Owner" &&
                member.id !== m.id && (
                  <Button
                    secondary
                    onClick={() => setEdit(edit === member.id ? "" : member.id)}
                  >
                    Edit access
                  </Button>
                )}
            </div>
            {edit === member.id && (
              <Drawer
                open
                title="Staff details and access"
                onClose={() => setEdit("")}
              >
                <h3>
                  {db.accounts.find((a) => a.id === member.accountId)?.name}
                </h3>
                <p>
                  {member.role} / {member.department}
                </p>
                {db.accounts.find((a) => a.id === member.accountId)
                  ?.credentials && (
                  <DataView
                    data={{
                      number: db.accounts.find(
                        (a) => a.id === member.accountId,
                      )!.credentials!.number,
                      details: db.accounts.find(
                        (a) => a.id === member.accountId,
                      )!.credentials!.details,
                      status: db.accounts.find(
                        (a) => a.id === member.accountId,
                      )!.credentials!.status,
                    }}
                  />
                )}
                <Form
                  db={db}
                  fields={[
                    {
                      key: "role",
                      label: "Role",
                      options: [...assignRoles],
                      required: true,
                    },
                    field("department", "Department"),
                    {
                      key: "status",
                      label: "Account access",
                      options: ["active", "suspended", "ended"],
                      required: true,
                    },
                    {
                      key: "employment",
                      label: "Employment",
                      options: ["employed", "ended"],
                      required: true,
                    },
                    {
                      key: "leave",
                      label: "Leave status",
                      options: ["working", "on leave"],
                      required: true,
                    },
                    {
                      key: "branches",
                      label: "Authorized branches (select one or more)",
                      multiple: true,
                      choices: branches.map((b) => ({
                        value: b.id,
                        label: b.name,
                      })),
                      required: true,
                    },
                    {
                      key: "denied",
                      label: "Restricted role permissions (optional)",
                      multiple: true,
                      choices: permissions(member.role).map((p) => ({
                        value: p,
                        label: p.replace(".", " ? "),
                      })),
                    },
                    {
                      key: "reportingTo",
                      label: "Reports to (optional)",
                      choices: members
                        .filter((x) => x.id !== member.id)
                        .map((x) => ({
                          value: x.id,
                          label:
                            db.accounts.find((a) => a.id === x.accountId)
                              ?.name || x.role,
                        })),
                    },
                  ]}
                  initial={{
                    role: member.role,
                    department: member.department,
                    status: member.status,
                    employment: member.employment,
                    leave: member.leave,
                    branches: member.branchIds,
                    denied: member.deniedPermissions,
                    reportingTo: str(
                      db.records.find(
                        (r) =>
                          r.kind === "staffProfile" &&
                          r.data.account === member.accountId,
                      )?.data.reportingTo,
                    ),
                  }}
                  onSubmit={async (data) => {
                    if (
                      data.status !== "active" &&
                      member.status === "active" &&
                      !(await confirmAction({
                        title: "Deactivate this staff membership?",
                        body: "This staff member will lose access to this facility. Saved records remain available to authorized staff.",
                        action: "Deactivate staff member",
                        word: "DEACTIVATE",
                      }))
                    )
                      return false;
                    await svc.editMembership(member.id, data);
                    setEdit("");
                  }}
                />
              </Drawer>
            )}
          </div>
        ))}
      </Card>
      <Card>
        <h2>Invitation lifecycle</h2>
        <Drawer
          open={!!invitationDetail}
          title="Invitation details"
          onClose={() => setInvitationDetail("")}
        >
          {db.invitations
            .filter((i) => i.id === invitationDetail)
            .map((i) => (
              <div key={i.id}>
                <h3>{i.name}</h3>
                <p>
                  {i.email} / {i.role} / {i.status}
                </p>
                <p>Expires {new Date(i.expires).toLocaleString()}</p>
                <a href={"#/invitation/" + i.id}>Open invitation link</a>
              </div>
            ))}
        </Drawer>
        {checkedInvites.length > 0 && (
          <div
            className="bulk-action-bar"
            role="region"
            aria-label="Selected invitation actions"
          >
            <strong>{checkedInvites.length} selected</strong>
            <Operation
              onClick={async () => {
                for (const id of checkedInvites) {
                  await svc.invitationAction(id, "resend");
                  setCheckedInvites((old) => old.filter((x) => x !== id));
                }
                toast("invitation");
              }}
            >
              Resend selected
            </Operation>
            <Operation
              secondary
              onClick={async () => {
                if (
                  !(await confirmAction({
                    title: "Revoke selected invitations?",
                    body: "These invitation links will stop working.",
                    action: "Revoke invitations",
                    word: "REVOKE",
                  }))
                )
                  return false;
                for (const id of checkedInvites) {
                  await svc.invitationAction(id, "revoke");
                  setCheckedInvites((old) => old.filter((x) => x !== id));
                }
              }}
            >
              Revoke selected
            </Operation>
            <Button secondary onClick={() => setCheckedInvites([])}>
              Clear selection
            </Button>
          </div>
        )}

        {db.invitations
          .filter((i) => i.hospitalId === h.id)
          .map((inv) => (
            <div className="list-row" key={inv.id}>
              {svc.can(db, "staff", "edit") && inv.status !== "accepted" && (
                <input
                  type="checkbox"
                  aria-label={"Select invitation for " + inv.email}
                  checked={checkedInvites.includes(inv.id)}
                  onChange={() =>
                    setCheckedInvites((old) =>
                      old.includes(inv.id)
                        ? old.filter((x) => x !== inv.id)
                        : [...old, inv.id],
                    )
                  }
                />
              )}
              <Button secondary onClick={() => setInvitationDetail(inv.id)}>
                Invitation details
              </Button>
              <div>
                <strong>{inv.name}</strong>
                <p>
                  {inv.email} · {inv.role} ·{" "}
                  {inv.status === "pending" && inv.expires < Date.now()
                    ? "expired"
                    : inv.status}
                </p>
                <a href={"#/invitation/" + inv.id}>Open invitation link</a>
              </div>
              {svc.can(db, "staff", "edit") && inv.status !== "accepted" && (
                <div className="actions">
                  <Operation
                    secondary
                    onClick={() => svc.invitationAction(inv.id, "resend")}
                  >
                    Resend
                  </Operation>
                  <Operation
                    secondary
                    onClick={() => svc.invitationAction(inv.id, "revoke")}
                  >
                    Revoke
                  </Operation>
                </div>
              )}
            </div>
          ))}
        {!db.invitations.some((i) => i.hospitalId === h.id) && (
          <EmptyState title="No invitations yet">
            Invite staff after launch to give them access to this facility.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
function BranchEditor({ db }: { db: Database }) {
  const { h } = svc.context(db);
  const branches = db.branches.filter((b) => b.hospitalId === h.id);
  const [selected, setSelected] = useState(branches[0]?.id || "new");
  const b = branches.find((b) => b.id === selected);
  const [deps, setDeps] = useState<string[]>(b?.departments || h.departments);
  return (
    <Card>
      <h2>Branch configuration</h2>
      <div className="actions">
        {branches.map((b) => (
          <Button
            key={b.id}
            secondary
            onClick={() => {
              setSelected(b.id);
              setDeps(b.departments);
            }}
          >
            {b.name}
          </Button>
        ))}
        <Button
          secondary
          onClick={() => {
            setSelected("new");
            setDeps(h.departments);
          }}
        >
          Add branch
        </Button>
      </div>
      <div className="checks">
        {h.departments.map((d) => (
          <label key={d}>
            <input
              type="checkbox"
              checked={deps.includes(d)}
              onChange={() =>
                setDeps(
                  deps.includes(d) ? deps.filter((x) => x !== d) : [...deps, d],
                )
              }
            />
            {d}
          </label>
        ))}
      </div>
      <Form
        key={selected}
        initial={
          b
            ? {
                name: b.name,
                address: b.address,
                contact: b.contact,
                hours: b.hours,
              }
            : { hours: "09:00-17:00" }
        }
        fields={[
          field("name", "Branch name"),
          field("address", "Address"),
          field("contact", "Contact"),
          field("hours", "Operating hours"),
        ]}
        label="Save branch"
        onSubmit={async (data) => {
          await svc.saveBranch({
            ...data,
            id: selected === "new" ? undefined : selected,
            departments: deps,
          } as Partial<Branch>);
        }}
      />
    </Card>
  );
}
export function Onboarding({ db }: { db: Database }) {
  const { h } = svc.context(db);
  const steps = [
    "Facility",
    "Type",
    "Departments",
    "Branches",
    "Staff",
    "Roles",
    "Billing",
    "Review",
    "Launch",
  ];
  const [selected, setSelected] = useState(h.departments);
  const errors = svc.launchErrors(db, h);
  const next = () => svc.configure({}, Math.min(8, h.step + 1));
  return (
    <>
      <Heading
        title={h.launched ? "Facility settings" : "Set up your hospital"}
        sub={`Step ${h.step + 1} of 9 · ${steps[h.step]}`}
      >
        <Button secondary onClick={() => go("/institutions")}>
          Save and exit
        </Button>
      </Heading>
      <nav className="stepper" aria-label="Onboarding steps">
        {steps.map((step, i) => (
          <Operation key={step} secondary onClick={() => svc.configure({}, i)}>
            {i + 1}. {step}
          </Operation>
        ))}
      </nav>
      {h.step === 0 && (
        <Card>
          <Form
            key="facility"
            db={db}
            draftKey="onboarding-facility"
            initial={h as unknown as Fields}
            fields={[
              field("name", "Hospital name"),
              field("phone", "Main phone"),
              field("email", "Main email", true, "email"),
              field("address", "Address"),
              field("city", "City"),
              field("state", "State"),
              field("registration", "Optional registration number", false),
              { key: "logo", label: "Optional hospital logo", type: "file" },
            ]}
            label="Save and continue"
            onSubmit={(data) => svc.configure(data as Partial<Hospital>, 1)}
          />
          <p>
            Hospital review: {h.verification}. Entering a registration number
            does not verify a hospital.
          </p>
          <Operation secondary onClick={() => svc.submitHospitalReview()}>
            Submit for simulated registration review
          </Operation>
        </Card>
      )}
      {h.step === 1 && (
        <Card>
          <Form
            key="type"
            initial={{ type: h.type }}
            fields={[
              {
                key: "type",
                label: "Facility type",
                options: facilityTypes,
                required: true,
              },
            ]}
            label="Save and continue"
            onSubmit={async (data) => {
              const preset =
                data.type === "Diagnostic Centre"
                  ? ["Laboratory", "Radiology"]
                  : data.type === "Maternity Centre"
                    ? ["Maternity"]
                    : ["General Outpatient"];
              const replace =
                JSON.stringify(preset) !== JSON.stringify(h.departments) &&
                (await confirmAction({
                  title: "Use suggested departments?",
                  body: "Cancel keeps your customized departments.",
                  action: "Use suggested departments",
                }));
              await svc.configure(
                {
                  type: str(data.type),
                  departments: replace ? preset : h.departments,
                },
                2,
              );
              setSelected(replace ? preset : h.departments);
            }}
          />
          <p>
            Types suggest defaults. Clinical specialties share the appointments,
            triage and consultation infrastructure. Multi-Branch Hospital
            requires at least two configured branches.
          </p>
        </Card>
      )}
      {h.step === 2 && (
        <Card>
          <h2>Enabled departments</h2>
          <div
            className="department-grid"
            data-editable
            data-dirty={
              JSON.stringify(selected) !== JSON.stringify(h.departments)
                ? "true"
                : "false"
            }
          >
            {departments.map((d) => (
              <label key={d}>
                <input
                  type="checkbox"
                  checked={selected.includes(d)}
                  onChange={() =>
                    setSelected(
                      selected.includes(d)
                        ? selected.filter((x) => x !== d)
                        : [...selected, d],
                    )
                  }
                />
                <strong>{d}</strong>
                <small>
                  {d === "Laboratory"
                    ? "Orders, samples and results; invite lab staff."
                    : d === "Pharmacy"
                      ? "Prescription fulfilment; configure stock and pharmacy staff."
                      : ["Inpatient", "ICU"].includes(d)
                        ? "Admissions and nursing; configure wards and beds."
                        : d === "Radiology"
                          ? "Studies and reports; assign radiology reporting permission."
                          : "Appointments, triage, care records and department-specific context."}
                </small>
              </label>
            ))}
          </div>
          <Operation
            onClick={async () => {
              if (!selected.length)
                throw Error("Select at least one department.");
              await svc.configure({ departments: selected }, 3);
            }}
          >
            Save and continue
          </Operation>
        </Card>
      )}
      {h.step === 3 && (
        <>
          <BranchEditor db={db} />
          <Operation onClick={next}>Continue to staff</Operation>
        </>
      )}
      {h.step === 4 && (
        <>
          <Staff db={db} compact />
          <p>
            Reporting hierarchies are optional. Shifts can be configured now or
            after launch.
          </p>
          <a href="#/shifts/new">Create a shift assignment</a>
          <Operation onClick={next}>Continue to roles</Operation>
        </>
      )}
      {h.step === 5 && (
        <>
          <Card>
            <h2>Role templates and permission scopes</h2>
            <p>
              Administrative ownership never grants clinical signing,
              prescribing or dispensing rights. Branch access and restrictions
              are editable in Staff & Roles.
            </p>
            {roles
              .filter((r) => r !== "Platform Super Admin")
              .map((role) => (
                <details key={role}>
                  <summary>{role}</summary>
                  <p>{permissions(role).join(", ")}</p>
                </details>
              ))}
          </Card>
          <Staff db={db} />
          <Operation onClick={next}>Continue to billing</Operation>
        </>
      )}
      {h.step === 6 && (
        <Card>
          <Form
            key="billing"
            initial={{
              currency: h.currency,
              invoicePrefix: h.invoicePrefix,
              methods: h.paymentMethods.join(","),
              paymentTiming: h.paymentTiming,
              insurance: h.insurance,
            }}
            fields={[
              field("currency", "Currency"),
              field("invoicePrefix", "Invoice numbering prefix"),
              field(
                "methods",
                "Accepted simulated methods (Cash,Transfer,Card,Insurance)",
              ),
              {
                key: "paymentTiming",
                label: "Payment policy",
                options: ["Before service", "After service"],
                required: true,
              },
              {
                key: "insurance",
                label: "Enable insurance support",
                type: "checkbox",
              },
            ]}
            label="Save and continue"
            onSubmit={(data) =>
              svc.configure(
                {
                  currency: str(data.currency),
                  invoicePrefix: str(data.invoicePrefix),
                  paymentMethods: str(data.methods)
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                  paymentTiming: str(data.paymentTiming),
                  insurance: !!data.insurance,
                },
                7,
              )
            }
          />
          <p>
            This configures patient service billing, not a platform
            subscription. Service pricing is optional before launch.
          </p>
          <a href="#/services">Configure service catalogue</a>
        </Card>
      )}
      {h.step === 7 && (
        <Card>
          <h2>Review your configuration</h2>
          <DataView
            data={{
              name: h.name,
              type: h.type,
              phone: h.phone,
              email: h.email,
              address: h.address,
              city: h.city,
              state: h.state,
              departments: h.departments,
              currency: h.currency,
              paymentMethods: h.paymentMethods,
              paymentTiming: h.paymentTiming,
              insurance: h.insurance,
            }}
          />
          <h3>Branches</h3>
          {db.branches
            .filter((b) => b.hospitalId === h.id)
            .map((b) => (
              <p key={b.id}>
                {b.name} · {b.address} · {b.departments.join(", ")}
              </p>
            ))}
          <ErrorBox message={errors.join(" ")} />
          <p>
            Optional after launch: staff invitations, service pricing, wards and
            beds, inventory and professional credential records.
          </p>
          <Operation onClick={next}>Review launch requirements</Operation>
        </Card>
      )}
      {h.step === 8 && (
        <Card>
          <h2>{h.launched ? "Hospital is launched" : "Ready to launch?"}</h2>
          <ErrorBox message={errors.join(" ")} />
          <p>
            A new hospital starts with no patients, stock or transactions.
            Sample loading is a separate explicit development action.
          </p>
          {!h.launched ? (
            <Operation
              onClick={async () => {
                await svc.launch();
                go("/dashboard");
              }}
            >
              Launch hospital
            </Operation>
          ) : (
            <Button onClick={() => go("/dashboard")}>Open dashboard</Button>
          )}
        </Card>
      )}
      {h.step > 0 && (
        <Operation secondary onClick={() => svc.configure({}, h.step - 1)}>
          Back
        </Operation>
      )}
    </>
  );
}
