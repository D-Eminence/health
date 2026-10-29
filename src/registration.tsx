import { confirmAction, Banner } from "./feedback";
import { HospitalIdentity } from "./profiles";
import React, { useState, useRef, useEffect } from "react";
import { Database, Fields, id, str } from "./model";
import { AuthShell } from "./auth";
import { Button, Card, DataView, ErrorBox, Form, Operation, go } from "./ui";
import {
  facilityFields,
  facilityErrors,
  registrationSteps,
  safeProfile,
} from "./facility-fields";
import * as svc from "./service";
export function AuthLinks() {
  return (
    <div className="auth-links">
      <a href="#/register">Register a hospital</a>
      <a href="#/signin">Sign in</a>
      <a href="#/recover">Recover access</a>
      <a href="#/accept-invitation">Accept invitation</a>
    </div>
  );
}
export function Registration({
  db,
  onRegistered,
}: {
  db: Database;
  onRegistered: (result: unknown) => void;
}) {
  const [policy, setPolicy] = useState({ trialDays: 21, graceDays: 21 });
  useEffect(() => {
    svc.registrationPolicy().then(setPolicy);
  }, []);
  const [draftId] = useState(() => {
    let value = localStorage.getItem("health-id-facility-draft");
    if (!value) {
      value = id();
      localStorage.setItem("health-id-facility-draft", value);
    }
    return value;
  });
  const initial = db.facilityDrafts?.[draftId];
  const [step, setStep] = useState(initial?.step || 0);
  const [data, setData] = useState<Fields>(
    initial?.data || { beds: 0, staffCount: 1 },
  );
  const latest = useRef(data);
  const [savedLater, setSavedLater] = useState(false);
  const [error, setError] = useState("");
  async function change(values: Fields) {
    const merged = { ...latest.current, ...values };
    latest.current = merged;
    setData(merged);
    await svc.saveFacilityDraft(draftId, step, merged);
  }
  async function move(next: number) {
    await svc.saveFacilityDraft(draftId, next, latest.current);
    setStep(next);
    setError("");
    document.getElementById("registration-heading")?.focus();
  }
  return (
    <AuthShell>
      <div className="facility-onboarding">
        <p className="eyebrow">A workspace for your facility</p>
        <h1 id="registration-heading" tabIndex={-1}>
          Register your hospital
        </h1>
        <p>
          Tell us about your facility. Start a {policy.trialDays}-day free trial
          after verification, with no payment at sign-up.
        </p>
        <div
          className="registration-progress"
          aria-label="Registration progress"
        >
          <span>
            Step {step + 1} of 5 · {registrationSteps[step]}
          </span>
          <progress max={5} value={step + 1} />
          <ol>
            {registrationSteps.map((name, i) => (
              <li key={name} aria-current={i === step ? "step" : undefined}>
                {i + 1}. {name}
              </li>
            ))}
          </ol>
        </div>
        {savedLater ? (
          <Card>
            <h2>Draft saved on this device</h2>
            <p>
              Return to Register a hospital in this browser to continue.
              Passwords are never saved with drafts; re-enter them in Your
              account after returning.
            </p>
            <Button onClick={() => setSavedLater(false)}>
              Continue registration
            </Button>
            <a href="#/signin">Save and exit</a>
          </Card>
        ) : (
          <>
            <h2>{registrationSteps[step]}</h2>
            {initial && !data.password && (
              <p className="info">
                Your draft is restored. Re-enter your password in Your account
                before submitting.
              </p>
            )}
            {step === 3 && (
              <p className="muted">
                Product choices record your interest. Only the Hospital EHR is
                implemented in this local preview; other products and external
                connections are not activated.
              </p>
            )}
            {step === 4 && (
              <>
                <div className="registration-summary">
                  {registrationSteps.slice(0, 4).map((section, i) => (
                    <details key={section} open={i === 0}>
                      <summary>{section}</summary>
                      <Button secondary onClick={() => move(i)}>
                        Edit {section.toLowerCase()}
                      </Button>
                      <DataView
                        data={Object.fromEntries(
                          facilityFields(i, data, true)
                            .filter((f) => data[f.key] !== undefined)
                            .map((f) => [f.label, data[f.key]]),
                        )}
                      />
                    </details>
                  ))}
                </div>
                <div className="info">
                  No payment is taken at sign-up. Your {policy.trialDays}-day
                  trial starts after facility verification, followed by a{" "}
                  {policy.graceDays}-day grace period.
                </div>
                <details className="agreement-copy">
                  <summary>Read the demonstration agreements</summary>
                  <p>
                    <strong>Terms of Service:</strong> This local preview is for
                    fictional workflows only. It does not provide medical care,
                    live integrations or payment processing.
                  </p>
                  <p>
                    <strong>Data Processing Agreement:</strong> Only fictional
                    information belongs in this simulation. Data and attachments
                    are stored on this device and can be removed using
                    Simulation controls.
                  </p>
                  <p>
                    <strong>NDPA and patient consent acknowledgement:</strong>{" "}
                    Facility users acknowledge responsibility for appropriate
                    data protection and patient consent. This demonstration
                    acknowledgement does not establish legal compliance or
                    replace approved production agreements.
                  </p>
                </details>
              </>
            )}
            <Form
              persistValues
              key={step}
              initial={data}
              fields={facilityFields(step, data)}
              onValuesChange={change}
              validateValues={(values) => facilityErrors(step, values)}
              disabledWhen={
                step === 4
                  ? (values) =>
                      !["terms", "dpa", "ndpa", "authorised"].every(
                        (k) => values[k] === true,
                      )
                  : undefined
              }
              label={
                step === 4
                  ? "Submit facility for verification"
                  : "Save & continue"
              }
              onSubmit={async (values) => {
                latest.current = { ...latest.current, ...values };
                setData(latest.current);
                if (step < 4) {
                  await move(step + 1);
                  return;
                }
                for (let s = 0; s < 5; s++) {
                  if (Object.keys(facilityErrors(s, latest.current)).length) {
                    await move(s);
                    setError(
                      "Complete this section before submitting. Passwords must be re-entered after restoring a draft.",
                    );
                    return;
                  }
                }
                if (
                  !(await confirmAction({
                    title: "Submit the hospital agreements?",
                    body: "Confirm that you are authorized to accept the agreements selected above and submit this registration for review.",
                    action: "Accept agreements and submit",
                  }))
                )
                  return false;
                const result = await svc.register({
                  ...latest.current,
                  draftId,
                });
                localStorage.removeItem("health-id-facility-draft");
                sessionStorage.removeItem("pending-invitation");
                onRegistered(result);
              }}
            />
            <ErrorBox message={error} />
            <div className="actions registration-controls">
              {step > 0 && (
                <Button secondary onClick={() => move(step - 1)}>
                  Back
                </Button>
              )}
              <Operation
                secondary
                onClick={async () => {
                  await svc.saveFacilityDraft(draftId, step, latest.current);
                  setSavedLater(true);
                }}
              >
                Save & continue later
              </Operation>
            </div>
          </>
        )}
        <AuthLinks />
      </div>
    </AuthShell>
  );
}
export function FacilityProfile({ db }: { db: Database }) {
  const { h } = svc.context(db);
  const [edit, setEdit] = useState<number | null>(null);
  const [data, setData] = useState(h.registrationProfile || {});
  if (!svc.can(db, "facility"))
    return (
      <ErrorBox message="Contact your administrator to update the facility profile." />
    );
  return (
    <>
      <h1>Facility profile</h1>
      <HospitalIdentity db={db} />
      <Banner
        title="Facility verification"
        tone={h.verification === "rejected" ? "critical" : "warning"}
      >
        <strong>{h.verification.replaceAll("_", " ")}</strong>
        <p>
          {h.verificationReason ||
            (h.registrationProfile
              ? "Your facility is awaiting a simulated review. Clinical modules become available after approval."
              : "Existing local demonstration facility. Registration review has not been submitted.")}
        </p>
      </Banner>
      {h.registrationProfile &&
        [1, 2, 3].map((step) => (
          <Card key={step}>
            <h2>{registrationSteps[step]}</h2>
            <Button
              secondary
              onClick={() => {
                setData(h.registrationProfile || {});
                setEdit(edit === step ? null : step);
              }}
            >
              Edit {registrationSteps[step].toLowerCase()}
            </Button>
            {edit === step ? (
              <Form
                key={step}
                initial={data}
                fields={facilityFields(step, data, true)}
                onValuesChange={(v) => setData({ ...data, ...v })}
                validateValues={(v) => facilityErrors(step, v, true)}
                onSubmit={async (v) => {
                  await svc.saveFacilityProfile({
                    ...h.registrationProfile,
                    ...v,
                  });
                  setEdit(null);
                }}
              />
            ) : (
              <DataView
                data={Object.fromEntries(
                  facilityFields(step, h.registrationProfile || {}, true).map(
                    (f) => [
                      f.label,
                      h.registrationProfile?.[f.key] || "Not provided",
                    ],
                  ),
                )}
              />
            )}
          </Card>
        ))}
      {["rejected", "draft"].includes(h.verification) && (
        <Operation
          onClick={() =>
            svc.saveFacilityProfile(h.registrationProfile || {}, true)
          }
        >
          Re-submit for verification
        </Operation>
      )}
      <Card>
        <h2>Verification history</h2>
        {h.verificationHistory?.map((v, i) => (
          <p key={i}>
            {v.status.replaceAll("_", " ")} · {new Date(v.at).toLocaleString()}{" "}
            · {v.reason}
          </p>
        ))}
      </Card>
    </>
  );
}
