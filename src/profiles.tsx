import { Badge } from "./ui";
import {
  toast,
  requestPassword,
  hasUnsaved,
  confirmAction,
  clearUnsaved,
} from "./feedback";
import {
  PresenceSettings,
  PresenceDot,
  FacilityPresencePolicy,
} from "./presence";
import React, { useState, useEffect } from "react";
import { Database, str, departments } from "./model";
import * as svc from "./service";
import { Button, Card, ErrorBox, Form, Heading, Operation, go } from "./ui";
export function Avatar({
  src,
  name,
  large = false,
  db,
  accountId,
}: {
  src?: string;
  name: string;
  large?: boolean;
  db?: Database;
  accountId?: string;
}) {
  return (
    <span className="avatar-wrap">
      {src ? (
        <img
          className={"profile-avatar" + (large ? " large" : "")}
          src={src}
          alt={name + " profile picture"}
        />
      ) : (
        <span
          aria-hidden="true"
          className={"profile-avatar initials" + (large ? " large" : "")}
        >
          {name
            .split(" ")
            .map((s) => s[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
      )}
      {db && accountId && <PresenceDot db={db} accountId={accountId} />}
    </span>
  );
}
function PhotoEditor({
  value,
  name,
  label,
  onSave,
  db,
  accountId,
}: {
  value?: string;
  name: string;
  label: string;
  onSave: (photo: string) => Promise<void>;
  db?: Database;
  accountId?: string;
}) {
  const [photo, setPhoto] = useState(value || "");
  const [source, setSource] = useState<HTMLImageElement | null>(null),
    [zoom, setZoom] = useState(1),
    [x, setX] = useState(50),
    [y, setY] = useState(50);
  useEffect(() => {
    if (!source) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 384;
    const size = Math.min(source.naturalWidth, source.naturalHeight) / zoom;
    canvas
      .getContext("2d")!
      .drawImage(
        source,
        ((source.naturalWidth - size) * x) / 100,
        ((source.naturalHeight - size) * y) / 100,
        size,
        size,
        0,
        0,
        384,
        384,
      );
    setPhoto(canvas.toDataURL("image/png"));
  }, [source, zoom, x, y]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => setPhoto(value || ""), [value]);
  return (
    <div
      className="photo-editor"
      data-editable
      data-dirty={photo !== (value || "") ? "true" : "false"}
    >
      <Avatar src={photo} name={name} large db={db} accountId={accountId} />
      <div>
        <label>
          {label}
          <input
            type="file"
            aria-label={label}
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setError("");
              setMessage("");
              if (!file) return;
              if (
                ![
                  "image/png",
                  "image/jpeg",
                  "image/webp",
                  "image/gif",
                ].includes(file.type) ||
                file.size > 2 * 1024 * 1024
              ) {
                setError(
                  "Choose a PNG, JPEG, WebP or GIF image no larger than 2 MB.",
                );
                return;
              }
              const reader = new FileReader();
              reader.onerror = () =>
                setError("Image could not be read. Try again.");
              reader.onload = () => {
                const image = new Image();
                image.onload = () => {
                  setSource(image);
                  setZoom(1);
                  setX(50);
                  setY(50);
                  const canvas = document.createElement("canvas");
                  canvas.width = canvas.height = 384;
                  const size = Math.min(
                    image.naturalWidth,
                    image.naturalHeight,
                  );
                  canvas
                    .getContext("2d")!
                    .drawImage(
                      image,
                      (image.naturalWidth - size) / 2,
                      (image.naturalHeight - size) / 2,
                      size,
                      size,
                      0,
                      0,
                      384,
                      384,
                    );
                  setPhoto(canvas.toDataURL("image/png"));
                };
                image.onerror = () =>
                  setError(
                    "This image could not be opened. Choose another file.",
                  );
                image.src = String(reader.result);
              };
              reader.readAsDataURL(file);
              e.target.value = "";
            }}
          />
        </label>
        <small>
          PNG, JPEG, WebP or GIF · up to 2 MB. Adjust the square crop before
          saving. Saved with image metadata removed. Saved only in this local
          simulation.
        </small>
        {source && (
          <fieldset className="crop-controls">
            <legend>Crop picture</legend>
            <label>
              Zoom
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
            <label>
              Horizontal position
              <input
                type="range"
                min="0"
                max="100"
                value={x}
                onChange={(e) => setX(Number(e.target.value))}
              />
            </label>
            <label>
              Vertical position
              <input
                type="range"
                min="0"
                max="100"
                value={y}
                onChange={(e) => setY(Number(e.target.value))}
              />
            </label>
          </fieldset>
        )}
        <div className="actions">
          {photo !== (value || "") && (
            <>
              <Operation
                onClick={async () => {
                  await onSave(photo);
                  setSource(null);
                  toast("profile");
                }}
              >
                Save picture
              </Operation>
              <Button
                secondary
                onClick={() => {
                  setPhoto(value || "");
                  setSource(null);
                }}
              >
                Discard picture
              </Button>
            </>
          )}
          {value && (
            <Operation
              secondary
              onClick={async () => {
                await onSave("");
                setPhoto("");
                setSource(null);
                toast("profile");
              }}
            >
              Remove picture
            </Operation>
          )}
        </div>
        <ErrorBox message={error} />
        {message && <p role="status">{message}</p>}
      </div>
    </div>
  );
}
export function StaffProfile({ db }: { db: Database }) {
  const session = svc.sessionIn(db);
  const account = db.accounts.find((a) => a.id === session?.accountId);
  const [saved, setSaved] = useState("");
  if (!account) return <ErrorBox message="Sign in to edit your profile." />;
  const memberships = db.memberships.filter((m) => m.accountId === account.id);
  let activeWorkspace = false;
  try {
    svc.context(db);
    activeWorkspace = true;
  } catch {}
  return (
    <>
      <Heading title="My profile" sub="Personal details and account security" />
      {account.forcePasswordChange && (
        <p role="alert" className="info">
          Invitation accepted. Change your password below before making
          workspace changes.
        </p>
      )}
      <Card>
        <h2>Profile picture</h2>
        <PhotoEditor
          db={db}
          accountId={account.id}
          value={account.photo}
          name={account.name}
          label="Upload staff profile picture"
          onSave={(photo) => svc.updateOwnProfile({ photo })}
        />
      </Card>
      <Card>
        <h2>Personal details</h2>
        <p>
          Sign-in email: <strong>{account.email}</strong> ·{" "}
          {account.verified ? "Verified" : "Not verified"}
        </p>
        <Form
          initial={{
            name: account.name,
            phone: account.phone,
            jobTitle: account.jobTitle || "",
            bio: account.bio || "",
            language: account.language || "English",
            displayDepartment: account.displayDepartment || "",
          }}
          fields={[
            { key: "name", label: "Full name", required: true },
            { key: "phone", label: "Phone", type: "tel", required: true },
            { key: "jobTitle", label: "Job title (display only)" },
            { key: "bio", label: "About you", type: "textarea" },
            { key: "displayDepartment", label: "Department (display only)" },
            {
              key: "language",
              label: "Preferred language",
              options: ["English", "Hausa", "Igbo", "Yoruba"],
            },
          ]}
          label="Save personal details"
          onSubmit={async (data) => {
            await svc.updateOwnProfile(data);
            toast("profile");
          }}
        />
        {saved && <p role="status">{saved}</p>}
      </Card>
      <Card>
        <h2>Hospital memberships</h2>
        <p>
          Your display details do not change your role or clinical permissions.
          Hospital administrators manage membership access.
        </p>
        {memberships.map((m) => (
          <p key={m.id}>
            {db.hospitals.find((h) => h.id === m.hospitalId)?.name} · {m.role} ·{" "}
            {m.department} · {m.status}
          </p>
        ))}
      </Card>
      {activeWorkspace ? (
        <>
          <AccountSecurity db={db} />
          <p>Presence and notification settings are in Preferences in your account menu.</p>
        </>
      ) : (
        <p>
          <a href="#/institutions">Choose an active facility</a> to manage
          verification, sessions and presence.
        </p>
      )}
      <Card>
        <h2>Change password</h2>
        <p>
          Enter your current password to set a new one. Saving signs you out on
          all sessions. Your saved records stay available after signing in
          again.
        </p>
        <Form
          fields={[
            {
              key: "currentPassword",
              label: "Current password",
              type: "password",
              required: true,
            },
            {
              key: "newPassword",
              label: "New password",
              type: "password",
              required: true,
            },
            {
              key: "confirmPassword",
              label: "Confirm new password",
              type: "password",
              required: true,
            },
          ]}
          validateValues={(values) => {
            const errors: Record<string, string> = {};
            if (!values.currentPassword)
              errors.currentPassword = "Enter your current password.";
            if (str(values.newPassword).length < 8)
              errors.newPassword = "Use at least eight characters.";
            if (values.newPassword !== values.confirmPassword)
              errors.confirmPassword = "Passwords do not match.";
            return errors;
          }}
          label="Update password and sign out"
          onSubmit={async (values) => {
            if (
              hasUnsaved() &&
              !(await confirmAction({
                title: "Change password and discard other edits?",
                body: "Changing your password signs you out. Other unsaved profile edits will be discarded.",
                action: "Change password and sign out",
              }))
            )
              return false;
            await svc.changeOwnPassword(
              str(values.currentPassword),
              str(values.newPassword),
              str(values.confirmPassword),
            );
            clearUnsaved();
            go("/signin");
            toast("password");
          }}
        />
        <p>
          <a href="#/recover">
            Forgot your current password? Reset it using a verification code.
          </a>
        </p>
      </Card>
    </>
  );
}
export function HospitalIdentity({ db }: { db: Database }) {
  const { h } = svc.context(db);
  const [message, setMessage] = useState("");
  if (!svc.can(db, "facility", "edit")) return null;
  return (
    <Card>
      <h2>Hospital details & picture</h2>
      <FacilityPresencePolicy db={db} />
      <PhotoEditor
        value={h.logo}
        name={h.name}
        label="Upload hospital profile picture or logo"
        onSave={(logo) => svc.updateHospitalIdentity({ logo })}
      />
      <Form
        initial={{
          name: h.name,
          phone: h.phone,
          email: h.email,
          address: h.address,
        }}
        fields={[
          { key: "name", label: "Hospital name", required: true },
          {
            key: "phone",
            label: "Hospital phone",
            type: "tel",
            required: true,
          },
          {
            key: "email",
            label: "Hospital email",
            type: "email",
            required: true,
          },
          {
            key: "address",
            label: "Hospital address",
            type: "textarea",
            required: true,
          },
        ]}
        label="Save hospital details"
        onSubmit={async (data) => {
          await svc.updateHospitalIdentity(data);
          toast("profile");
        }}
      />
      {message && <p role="status">{message}</p>}
      <h3>Operations & regulatory details</h3>
      <p>
        Verification: {h.verification.replaceAll("_", " ")}. Changes to licence,
        CAC, registry ID or Medical Director require re-verification.
      </p>
      <Form
        initial={{
          hours: h.registrationProfile?.hours || "",
          beds: h.registrationProfile?.beds || 0,
          departments: h.departments,
          services: h.registrationProfile?.services || "",
          licence: h.registrationProfile?.licence || h.registration,
          cac: h.registrationProfile?.cac || "",
          registryId: h.registrationProfile?.registryId || "",
          directorName: h.registrationProfile?.directorName || "",
        }}
        fields={[
          { key: "hours", label: "Operating hours" },
          { key: "beds", label: "Bed count", type: "number" },
          {
            key: "departments",
            label: "Departments",
            multiple: true,
            options: departments,
          },
          { key: "services", label: "Services offered", type: "textarea" },
          { key: "licence", label: "Facility licence number" },
          { key: "cac", label: "CAC registration number" },
          { key: "registryId", label: "Facility registry ID" },
          { key: "directorName", label: "Medical Director" },
        ]}
        label="Save operations and regulatory details"
        onSubmit={svc.updateHospitalOperations}
      />
      <h3>Profile change history</h3>
      {h.profileHistory
        ?.slice()
        .reverse()
        .map((e, i) => (
          <p key={i}>
            {new Date(e.at).toLocaleString()} ?{" "}
            {db.accounts.find((a) => a.id === e.actorId)?.name ||
              "Staff member"}{" "}
            ? {e.fields.join(", ")}
          </p>
        ))}
      <p>
        Clinical roles, branch settings and verification decisions are managed
        separately.
      </p>
    </Card>
  );
}

function AccountSecurity({ db }: { db: Database }) {
  const { a, s } = svc.context(db);
  const [emailCode, setEmailCode] = useState(""),
    [message, setMessage] = useState("");
  return (
    <>
      <Card>
        <h2>Sign-in email</h2>
        <p>
          Your current email stays active until the replacement is verified.
          Codes and delivery notices are simulated.
        </p>
        <Form
          fields={[
            {
              key: "email",
              label: "New sign-in email",
              type: "email",
              required: true,
            },
          ]}
          label="Request email verification"
          onSubmit={async (d) => {
            const password = await requestPassword("Confirm email change");
            if (password === null) return false;
            setEmailCode(await svc.requestProfileEmail(str(d.email), password));
            setMessage("Verification code created in the simulation inbox.");
          }}
        />
        {emailCode && (
          <Form
            fields={[
              {
                key: "code",
                label: "New email verification code",
                required: true,
              },
            ]}
            label="Verify new email"
            onSubmit={async (d) => {
              await svc.confirmProfileEmail(emailCode, str(d.code));
              setEmailCode("");
              setMessage("Sign-in email verified.");
            }}
          />
        )}
        {message && <p role="status">{message}</p>}
      </Card>
      <Card>
        <h2>Professional credentials</h2>
        <Badge>
          {a.credentials?.status === "pending"
            ? "Verification pending"
            : a.credentials?.status || "No credentials submitted"}
        </Badge>
        {a.credentials?.status === "pending" && (
          <p>
            Your changes are awaiting administrator review. Your access
            permissions are unchanged.
          </p>
        )}
        <Form
          initial={{
            number: a.credentials?.number || "",
            details: a.credentials?.details || "",
          }}
          fields={[
            {
              key: "number",
              label: "MDCN / professional credential number",
              required: true,
            },
            { key: "details", label: "Licence details", type: "textarea" },
          ]}
          label="Submit credentials for review"
          onSubmit={(d) => svc.submitCredentials(str(d.number), str(d.details))}
        />
      </Card>
      <Card>
        <h2>Active sessions</h2>
        {db.sessions
          .filter((x) => x.accountId === a.id && x.expires > Date.now())
          .map((x) => (
            <p key={x.id}>
              {x.device || "Browser"} ? {x.id === s.id ? "This session ? " : ""}
              Last active:{" "}
              {x.lastActive
                ? new Date(x.lastActive).toLocaleString()
                : "Unknown"}
            </p>
          ))}
        <Operation onClick={svc.signOutOtherDevices}>
          Sign out other devices
        </Operation>
        <Form
          initial={{ enabled: a.mfaEnabled !== false }}
          fields={[
            {
              key: "enabled",
              label: "Enable two-step sign-in",
              type: "checkbox",
            },
            {
              key: "currentPassword",
              label: "Current password for two-step settings",
              type: "password",
              required: true,
            },
          ]}
          successToast="profile"
          label="Save two-step settings"
          onSubmit={(d) =>
            svc.setTwoFactor(!!d.enabled, str(d.currentPassword))
          }
        />
        <p>Uses the existing simulated verification-code channel.</p>
      </Card>
      <Card>
        <h2>Security delivery notices</h2>
        <p>Local simulation only ? no real email or SMS is sent.</p>
        {a.securityNotices
          ?.slice()
          .reverse()
          .map((n, i) => (
            <p key={i}>
              {new Date(n.at).toLocaleString()} ? {n.text} ? To: {n.destination}
            </p>
          ))}
      </Card>
    </>
  );
}
