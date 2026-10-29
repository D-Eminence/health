import { toast, clearUnsaved, confirmAction } from "./feedback";
import { Registration, AuthLinks } from "./registration";
import { SubscriptionSimulation } from "./subscription";
import { pendingFacility } from "./subscription-model";
import React, { useState } from "react";
import { Database, Fields, str, roles } from "./model";
import * as svc from "./service";
import { simulateFailure } from "./storage";
import {
  PasswordInput,
  Button,
  Card,
  Heading,
  ErrorBox,
  Operation,
  go,
} from "./ui";
const PENDING = "health-id-pending-auth";
export function pending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING) || "{}") as {
      accountId?: string;
      codeId?: string;
      purpose?: "verify" | "mfa" | "recover";
      recovery?: string;
    };
  } catch {
    return {};
  }
}
function setPending(value: unknown) {
  localStorage.setItem(PENDING, JSON.stringify(value));
}
export function AuthShell({
  children,
  signIn = false,
}: {
  children: React.ReactNode;
  signIn?: boolean;
}) {
  return (
    <div className={"auth-shell" + (signIn ? " auth-shell--signin" : "")}>
      <div className="auth-split">
        <section className="auth-form-panel">
          <img
            className="auth-brand"
            src="brand/logo.png"
            alt="Health ID"
            width="112"
          />
          <div className="auth-content">{children}</div>
          <p className="muted">
            Local demonstration · fictional records only. No real emails,
            payments or medical integrations.
          </p>
          <a href="#/simulation">Simulation controls & inbox</a>
        </section>
        <section className="auth-visual">
          <img
            src="assets/cf4b3847-65e6-4a98-b03a-a5d509f51681.png"
            alt="Clinician using Health ID"
          />
          <div className="auth-story">
            <span>Health ID — Hospital EHR</span>
            <h2>
              More connected care.
              <br />
              More time for people.
            </h2>
            <p>
              Your hospital, patients and team in one connected local workspace.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
export function AuthPage({ route, db }: { route: string; db: Database }) {
  const mode = route.split("?")[0];
  const query = new URLSearchParams(route.split("?")[1]);
  const invitationId =
    query.get("invite") || sessionStorage.getItem("pending-invitation") || "";
  if (query.get("invite"))
    sessionStorage.setItem("pending-invitation", invitationId);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const p = pending();
  const [change, setChange] = useState(false);
  const [confirmationRead, setConfirmationRead] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const submittedForm = e.currentTarget;
    submittedForm.dataset.submitting = "true";
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    setBusy(true);
    setError("");
    try {
      if (mode === "/register") {
        setPending(
          await svc.register(
            { ...data, terms: data.terms === "on" },
            invitationId || undefined,
          ),
        );
        go("/verify");
      }
      if (mode === "/signin") {
        const result = await svc.signIn(data.email, data.password);
        if ("offline" in result || "session" in result) {
          go("/institutions");
        } else {
          setPending(result);
          go("/verify");
        }
      }
      if (mode === "/recover") {
        setPending(await svc.recover(data.email));
        setConfirmationRead(false);
        go("/verify?recoveryRequested=1");
      }
      if (mode === "/verify") {
        const result = await svc.verify(p.codeId || "", data.code);
        if (result.recovery) {
          setPending({ ...p, recovery: result.recovery });
          go("/reset-password");
        } else {
          localStorage.removeItem(PENDING);
          go(invitationId ? "/invitation/" + invitationId : "/institutions");
        }
      }
      if (mode === "/reset-password") {
        await svc.resetPassword(p.recovery || "", data.password, data.confirm);
        localStorage.removeItem(PENDING);
        go("/signin");
        toast("password");
      }
      submittedForm.dataset.dirty = "false";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      submittedForm.dataset.submitting = "false";
    }
  }
  const title =
    mode === "/register"
      ? "Register your hospital"
      : mode === "/recover"
        ? "Recover account access"
        : mode === "/verify"
          ? p.purpose === "mfa"
            ? "Verify your sign-in"
            : "Enter your verification code"
          : mode === "/reset-password"
            ? "Set a new password"
            : "Welcome back.";
  if (route.startsWith("/invitation/")) {
    const invitation = db.invitations.find((i) => i.id === route.split("/")[2]);
    return (
      <AuthShell>
        <h1>Accept your invitation</h1>
        {!invitation ? (
          <ErrorBox message="Invitation not found" />
        ) : (
          <>
            <p>
              {invitation.name}, you are invited to{" "}
              {db.hospitals.find((h) => h.id === invitation.hospitalId)?.name}{" "}
              as <strong>{invitation.role}</strong>.
            </p>
            <p>
              {invitation.email} · {invitation.status} ·{" "}
              {invitation.expires < Date.now()
                ? "Expired"
                : "Expires " + new Date(invitation.expires).toLocaleString()}
            </p>
            {svc.sessionIn(db) ? (
              <Operation
                onClick={async () => {
                  await svc.acceptInvitation(invitation.id);
                  sessionStorage.removeItem("pending-invitation");
                  go("/institutions");
                }}
              >
                Accept assigned membership
              </Operation>
            ) : (
              <div className="actions">
                <a href={"#/signin?invite=" + invitation.id}>Sign in</a>
                <a href={"#/register?invite=" + invitation.id}>
                  Create account
                </a>
              </div>
            )}
          </>
        )}
        <AuthLinks />
      </AuthShell>
    );
  }
  if (mode === "/register" && !query.get("invite"))
    return (
      <Registration
        db={db}
        onRegistered={(result) => {
          setPending(result);
          setConfirmationRead(false);
          go("/verify?submitted=1");
        }}
      />
    );
  if (
    mode === "/verify" &&
    !confirmationRead &&
    (query.has("submitted") || query.has("recoveryRequested"))
  )
    return (
      <AuthShell>
        <h1>
          {query.has("submitted")
            ? "Hospital registration submitted"
            : "Check your recovery channel"}
        </h1>
        <p>
          {query.has("submitted")
            ? "Your registration is saved. Verify your account next; clinical access begins after facility approval."
            : "If an eligible account matches, a time-limited recovery code is available in the simulation inbox. No real email or SMS was sent."}
        </p>
        <Button onClick={() => setConfirmationRead(true)}>
          Continue to verification
        </Button>
        <AuthLinks />
      </AuthShell>
    );
  return (
    <AuthShell signIn={mode === "/signin"}>
      {mode === "/signin" && <span className="auth-eyebrow">Hospital EHR</span>}
      <h1>{mode === "/register" ? "Create your staff account" : title}</h1>
      <p>
        {mode === "/signin"
          ? "Sign in to your hospital workspace."
          : mode === "/verify"
            ? "Read the generated code in the simulated inbox. No real email was sent."
            : mode === "/register"
              ? invitationId
                ? "Create an account for your assigned invitation."
                : "Create an owner account. Clinical privileges are assigned separately."
              : "Health ID — Hospital EHR"}
      </p>
      {query.get("passwordChanged") === "1" && (
        <p role="status" className="info">
          Password updated. Sign in with your new password.
        </p>
      )}
      <form onSubmit={submit} className="auth-form">
        {mode === "/register" && (
          <>
            <label>
              Full name
              <input name="name" required />
            </label>
            <label>
              Phone
              <input name="phone" required />
            </label>
          </>
        )}
        {["/signin", "/register", "/recover"].includes(mode) && (
          <label>
            {mode === "/recover" ? "Email or phone" : "Email"}
            <input
              type={mode === "/recover" ? "text" : "email"}
              name="email"
              autoComplete="username"
              spellCheck={false}
              placeholder={mode === "/signin" ? "you@hospital.org" : undefined}
              required
              defaultValue={query.get("email") || ""}
            />
          </label>
        )}
        {["/signin", "/register", "/reset-password"].includes(mode) && (
          <label>
            Password
            <PasswordInput
              aria-label="Password"
              type="password"
              name="password"
              required
              minLength={mode === "/signin" ? undefined : 8}
              autoComplete={
                mode === "/signin" ? "current-password" : "new-password"
              }
            />
          </label>
        )}
        {mode === "/signin" && (
          <a className="auth-recovery" href="#/recover">
            Forgot password?
          </a>
        )}
        {["/register", "/reset-password"].includes(mode) && (
          <label>
            Confirm password
            <PasswordInput
              aria-label="Confirm password"
              autoComplete="new-password"
              name="confirm"
              required
              minLength={8}
            />
          </label>
        )}
        {mode === "/register" && (
          <label className="check">
            <input type="checkbox" name="terms" required /> I am authorized to
            accept this staff invitation and acknowledge the local-demo terms.
          </label>
        )}
        {mode === "/verify" && p.purpose === "recover" && (
          <p role="status">
            If an eligible account matches, a recovery code is available in the
            simulation inbox. Requests are rate limited.
          </p>
        )}
        {mode === "/verify" && (
          <label>
            Verification code
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </label>
        )}
        <ErrorBox message={error} />
        <Button type="submit" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "/register"
              ? "Create account"
              : mode === "/verify"
                ? "Verify code"
                : mode === "/recover"
                  ? "Generate recovery code"
                  : mode === "/reset-password"
                    ? "Replace password"
                    : "Sign in"}
        </Button>
      </form>
      {mode === "/verify" && p.accountId && p.purpose && (
        <>
          <Operation
            secondary
            onClick={async () => {
              const codeId = await svc.resend(p.accountId!, p.purpose!);
              setPending({ ...p, codeId });
              setError(
                "New code generated in the simulated inbox. Previous code invalidated.",
              );
            }}
          >
            Resend code (30-second cooldown)
          </Operation>
          {p.purpose === "verify" && (
            <Button secondary onClick={() => setChange(!change)}>
              Change unverified email
            </Button>
          )}
          {change && (
            <form
              className="auth-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  const codeId = await svc.changeEmail(
                    p.accountId!,
                    String(f.get("email")),
                    String(f.get("password")),
                  );
                  setPending({ ...p, codeId });
                  setChange(false);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <label>
                New email
                <input name="email" type="email" required />
              </label>
              <label>
                Current password
                <PasswordInput
                  aria-label="Current password"
                  name="password"
                  required
                />
              </label>
              <Button type="submit">Update email and code</Button>
            </form>
          )}
        </>
      )}
      {mode === "/signin" ? (
        <div className="signin-links">
          <p>
            New to Health ID? <a href="#/register">Register a hospital</a>
          </p>
          <p>
            Joining your team?{" "}
            <a href="#/accept-invitation">Accept invitation</a>
          </p>
        </div>
      ) : (
        <div className="auth-links">
          <a href="#/register">Register a hospital</a>
          <a href="#/signin">Sign in</a>
          <a href="#/recover">Recover access</a>
          <a href="#/accept-invitation">Accept invitation</a>
        </div>
      )}
    </AuthShell>
  );
}
export function Simulation({ db }: { db: Database }) {
  const p = pending();
  const [message, setMessage] = useState("");
  return (
    <div className="standalone">
      <Heading
        title="Simulation controls"
        sub="Development tools · not a hospital role switcher"
      >
        <Button
          secondary
          onClick={() => go(p.codeId ? "/verify" : "/dashboard")}
        >
          Return to application
        </Button>
      </Heading>
      <p>
        All identities and codes below are fictional and stored only in this
        browser. Selecting an account fills its email; sign-in and MFA are still
        required.
      </p>
      <div className="actions">
        <Operation onClick={() => svc.sampleData()}>
          Load fictional sample hospital
        </Operation>
        <Button
          secondary
          onClick={() => {
            simulateFailure();
            setMessage(
              "Next service operation will fail before writing. Retry it to recover.",
            );
          }}
        >
          Fail next operation
        </Button>
        <Operation secondary onClick={() => svc.devAction("expire-session")}>
          Expire current session
        </Operation>
        <Operation
          secondary
          onClick={async () => {
            if (
              await confirmAction({
                title: "Delete all local demonstration data?",
                body: "Accounts, records and drafts on this device will be deleted. This cannot be undone.",
                action: "Delete local data",
                word: "DELETE",
              })
            ) {
              await svc.devAction("reset");
              localStorage.removeItem(PENDING);
              go("/signin");
            }
          }}
        >
          Reset local data
        </Operation>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="two-col">
        <Card>
          <h2>Simulated inbox</h2>
          {db.codes.length === 0 && <p>No generated codes yet.</p>}
          {db.codes
            .slice()
            .reverse()
            .map((c) => (
              <div className="list-row" key={c.id}>
                <div>
                  <strong>
                    {db.accounts.find((a) => a.id === c.accountId)?.email}
                  </strong>
                  <p>
                    {c.purpose}: <code>{c.code}</code> ·{" "}
                    {c.used
                      ? "used"
                      : c.expires < Date.now()
                        ? "expired"
                        : "active"}{" "}
                    · {c.attempts}/5 attempts
                  </p>
                </div>
                <Operation
                  secondary
                  onClick={() => svc.devAction("expire-code", c.id)}
                >
                  Expire code
                </Operation>
              </div>
            ))}
        </Card>
        <Card>
          <h2>Fictional accounts</h2>
          <p>
            Explicit sample accounts use <code>DemoPass123!</code>. New account
            passwords are never displayed.
          </p>
          {db.accounts.map((a) => (
            <div className="list-row" key={a.id}>
              <span>{a.email}</span>
              <Button
                secondary
                onClick={() =>
                  go("/signin?email=" + encodeURIComponent(a.email))
                }
              >
                Use email
              </Button>
            </div>
          ))}
        </Card>
      </div>
      <Card>
        <h2>Invitations & membership failures</h2>
        {db.invitations.map((i) => (
          <div className="list-row" key={i.id}>
            <a href={"#/invitation/" + i.id}>
              {i.email} · {i.role} · {i.status}
            </a>
            <Operation
              secondary
              onClick={() => svc.devAction("expire-invitation", i.id)}
            >
              Expire invitation
            </Operation>
          </div>
        ))}
        {db.memberships.map((m) => (
          <div className="list-row" key={m.id}>
            <span>
              {db.accounts.find((a) => a.id === m.accountId)?.email} · {m.role}{" "}
              · {m.status}
            </span>
            <Operation secondary onClick={() => svc.devAction("suspend", m.id)}>
              Toggle suspension
            </Operation>
          </div>
        ))}
      </Card>
      <Card>
        <h2>Patient-side simulation</h2>
        <a href="#/patient-simulation">
          Open isolated consent and released-record simulator
        </a>
        {db.records
          .filter((r) => r.kind === "grant")
          .map((g) => (
            <div className="list-row" key={g.id}>
              <span>
                {g.id} · {g.status}
              </span>
              <Operation
                secondary
                onClick={() => svc.devAction("expire-grant", g.id)}
              >
                Expire grant
              </Operation>
            </div>
          ))}
      </Card>
      <SubscriptionSimulation db={db} />
    </div>
  );
}
export function Institutions({ db }: { db: Database }) {
  const s = svc.sessionIn(db);
  if (!s) return <AuthPage route="/signin" db={db} />;
  const memberships = db.memberships.filter((m) => m.accountId === s.accountId);
  return (
    <div className="standalone narrow">
      <Heading title="Choose your workspace" sub="Health ID — Hospital EHR" />
      <p>
        Select one of your actual hospital memberships and authorized branches.
      </p>
      {!memberships.length && (
        <p>
          No active membership. Accept an invitation or register a hospital.
        </p>
      )}
      {memberships.map((m) => (
        <Card key={m.id}>
          <h2>{db.hospitals.find((h) => h.id === m.hospitalId)?.name}</h2>
          <p>
            {m.role} · {m.status}
          </p>
          <div className="actions">
            {m.branchIds.map((branchId) => (
              <Operation
                key={branchId}
                onClick={async () => {
                  await svc.chooseMembership(m.id, branchId);
                  const h = db.hospitals.find((h) => h.id === m.hospitalId)!;
                  const updated = await import("./storage").then((s) =>
                    s.read(),
                  );
                  go(
                    pendingFacility(h)
                      ? "/facility"
                      : h.launched
                        ? svc.sessionIn(updated)?.lastRoute || "/dashboard"
                        : "/onboarding",
                  );
                }}
              >
                {db.branches.find((b) => b.id === branchId)?.name ||
                  "Missing branch"}
              </Operation>
            ))}
          </div>
        </Card>
      ))}
      <div className="actions">
        <Operation
          secondary
          onClick={async () => {
            go("/register");
          }}
        >
          Register another hospital
        </Operation>
        <Operation
          secondary
          onClick={async () => {
            await svc.signOut();
            go("/signin");
          }}
        >
          Sign out
        </Operation>
        <a href="#/simulation">Simulation controls</a>
      </div>
    </div>
  );
}
