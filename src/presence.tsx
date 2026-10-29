import { Popover, toast } from "./feedback";
import React, { useEffect, useRef, useState } from "react";
import { Database, str } from "./model";
import * as svc from "./service";
import { connectionAvailable } from "./connectivity";
import { deviceState } from "./storage";
import { Card, Form, Operation } from "./ui";
export function presenceOf(db: Database, accountId: string) {
  let ctx;
  try {
    ctx = svc.context(db);
  } catch {
    return { status: "Offline", text: "" };
  }
  if (
    ctx.h.presencePolicy?.enabled === false ||
    !db.memberships.some(
      (m) =>
        m.hospitalId === ctx.h.id &&
        m.accountId === accountId &&
        m.status === "active",
    )
  )
    return { status: "Hidden", text: "" };
  const sessions = db.sessions
    .filter(
      (s) =>
        s.accountId === accountId &&
        s.version ===
          db.accounts.find((a) => a.id === accountId)?.credentialVersion &&
        s.expires > Date.now() &&
        db.memberships.some(
          (m) =>
            m.id === s.membershipId &&
            m.hospitalId === ctx.h.id &&
            m.status === "active",
        ) &&
        s.presence &&
        Date.now() - s.presence.heartbeat < 45000,
    )
    .sort(
      (a, b) => (b.presence?.heartbeat || 0) - (a.presence?.heartbeat || 0),
    );
  const p = sessions[0]?.presence;
  if (!p) return { status: "Offline", text: "" };
  const expired = p.expires > 0 && p.expires < Date.now();
  const manual = expired ? "Online" : p.status;
  return {
    status:
      manual === "Online" &&
      Date.now() - p.activeAt > (ctx.h.presencePolicy?.idleMinutes || 5) * 60000
        ? "Away"
        : manual,
    text: expired ? "" : p.text,
  };
}
export function PresenceDot({
  db,
  accountId,
}: {
  db: Database;
  accountId: string;
}) {
  const p = presenceOf(db, accountId);
  return p.status === "Hidden" ? null : (
    <span
      className={"presence-dot " + p.status.toLowerCase().replaceAll(" ", "-")}
      role="img"
      aria-label={p.status + (p.text ? " - " + p.text : "")}
      title={p.status + (p.text ? " - " + p.text : "")}
    />
  );
}
let audioContext: AudioContext | undefined;
export function playTone(tone: string, volume: number, critical = false) {
  if (
    !audioContext ||
    audioContext.state !== "running" ||
    tone === "off" ||
    document.hidden
  )
    return;
  const ctx = audioContext;
  const notes = critical
    ? [660, 880, 660]
    : tone === "drop"
      ? [620, 420]
      : tone === "pulse"
        ? [520, 740]
        : [540, 810];
  notes.forEach((frequency, index) => {
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain(),
      at = ctx.currentTime + index * 0.13;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(
      Math.min(1, volume / 100) * 0.16,
      at + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.13);
  });
}
export function soundAllowed(
  p: typeof svc.defaultPreferences,
  status: string,
  critical: boolean,
  override: boolean,
  clinical: boolean,
  hour: string,
) {
  if (!p.sounds || p.volume === 0 || (p.muteClinical && clinical)) return false;
  if (critical && override) return true;
  const quiet =
    p.quietStart &&
    p.quietEnd &&
    p.quietStart !== p.quietEnd &&
    (p.quietStart < p.quietEnd
      ? hour >= p.quietStart && hour < p.quietEnd
      : hour >= p.quietStart || hour < p.quietEnd);
  return status !== "Do not disturb" && !quiet;
}
export function PresenceRuntime({ db }: { db: Database }) {
  const seen = useRef<Set<string> | null>(null),
    wasOnline = useRef(false),
    scope = useRef("");
  const [alert, setAlert] = useState("");
  useEffect(() => {
    let activeAt = Date.now();
    const active = () => {
      activeAt = Date.now();
      if (!audioContext) audioContext = new AudioContext();
      if (audioContext.state === "suspended")
        void audioContext.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", active);
    window.addEventListener("keydown", active);
    const heartbeat = () => {
      if (!document.hidden && !deviceState().locked)
        void svc.presenceHeartbeat(activeAt).catch(() => {});
    };
    heartbeat();
    const timer = setInterval(heartbeat, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
    };
  }, []);
  useEffect(() => {
    let context;
    try {
      context = svc.context(db);
    } catch {
      return;
    }
    (globalThis as any).__hidDnd =
      presenceOf(db, context.a.id).status === "Do not disturb";
    const { a, h } = context,
      notes = svc.visibleNotifications(db),
      online = connectionAvailable(),
      key = a.id + ":" + h.id;
    if (
      !seen.current ||
      !online ||
      !wasOnline.current ||
      scope.current !== key
    ) {
      seen.current = new Set(notes.map((n) => n.id));
      wasOnline.current = online;
      scope.current = key;
      return;
    }
    const fresh = notes.filter((n) => !seen.current!.has(n.id));
    seen.current = new Set(notes.map((n) => n.id));
    const p = a.preferences || svc.defaultPreferences,
      status = presenceOf(db, a.id).status;
    const clinical =
      /\/(patients|consult|triage|inpatient|lab|pharmacy)(\/|$)/.test(
        location.hash,
      );
    const hour = new Date().toTimeString().slice(0, 5);
    for (const n of fresh.slice(-1)) {
      if (n.status !== "unread" || Date.now() - Date.parse(n.createdAt) > 15000)
        continue;
      const critical = n.data.critical === true;
      const type = ["message", "mention", "task", "alert"].includes(
        str(n.data.event),
      )
        ? (str(n.data.event) as "message" | "mention" | "task" | "alert")
        : "alert";
      if (!critical && (type === "task" || type === "mention"))
        toast(type === "task" ? "assignment" : "mention");
      if (critical)
        setAlert(
          "Critical clinical notification - open Notifications to review.",
        );
      if (
        soundAllowed(
          p,
          status,
          critical,
          h.presencePolicy?.criticalSounds !== false,
          clinical,
          hour,
        )
      )
        playTone(critical ? "pulse" : p[type], p.volume, critical);
    }
  }, [db]);
  return alert ? (
    <div role="alert" className="critical-notice">
      {alert}
      <button onClick={() => setAlert("")} aria-label="Dismiss critical notice">
        Dismiss
      </button>
    </div>
  ) : null;
}
export function PresenceSettings({ db }: { db: Database }) {
  const { a, h, s, m } = svc.context(db),
    p = a.preferences || svc.defaultPreferences;
  return (
    <>
      <Card>
        <h2>Your status</h2>
        <p>
          Visible only within this facility. Do not put patient information in
          your status. Closed tabs and dropped connections expire within 45
          seconds.
        </p>
        {h.presencePolicy?.enabled === false ? (
          <p>Presence is disabled by your facility.</p>
        ) : (
          <Form
            initial={{
              status: s.presence?.status || "Online",
              text: s.presence?.text || "",
              minutes: 60,
            }}
            fields={[
              {
                key: "status",
                label: "Presence",
                options: [
                  "Online",
                  "Away",
                  "Do not disturb",
                  ...(h.presencePolicy?.allowOffline === false
                    ? []
                    : ["Offline"]),
                ],
              },
              { key: "text", label: "Custom status (no patient information)" },
              {
                key: "minutes",
                label: "Status expiry in minutes (0 for none)",
                type: "number",
              },
            ]}
            label="Save status"
            onSubmit={(d) =>
              svc.setPresence(str(d.status), str(d.text), Number(d.minutes))
            }
          />
        )}
      </Card>
      <Card>
        <h2>Notification sounds</h2>
        <p>
          Original synthesized tones. Visual notifications work without sound.
          Your sound toggle and volume always apply; clinical alerts may bypass
          quiet hours and Do not disturb under facility policy.
        </p>
        <Form
          initial={{ ...p }}
          fields={[
            { key: "sounds", label: "Enable sounds", type: "checkbox" },
            { key: "volume", label: "Volume (0-100)", type: "number" },
            ...(["message", "mention", "task", "alert"] as const).map(
              (key) => ({
                key,
                label:
                  key === "task" ? "Assignment or task sound" : key + " sound",
                options: ["off", "chime", "drop", "pulse"],
              }),
            ),
            { key: "quietStart", label: "Quiet hours start (HH:MM)" },
            { key: "quietEnd", label: "Quiet hours end (HH:MM)" },
            {
              key: "muteClinical",
              label: "Mute sounds in patient-facing clinical views",
              type: "checkbox",
            },
          ]}
          successToast="profile"
          label="Save sound preferences"
          onSubmit={svc.savePreferences}
        />
        <Operation secondary onClick={async () => playTone("chime", p.volume)}>
          Preview original chime
        </Operation>
        <p>
          Message and mention preferences are reserved for those notification
          types; this simulation has no chat module.
        </p>
      </Card>
    </>
  );
}
export function FacilityPresencePolicy({ db }: { db: Database }) {
  const { m, h } = svc.context(db);
  return ["Hospital Owner", "Hospital Admin"].includes(m.role) ? (
    <Card>
      <h2>Facility presence policy</h2>
      <Form
        initial={{
          enabled: true,
          allowOffline: true,
          idleMinutes: 5,
          criticalSounds: true,
          ...h.presencePolicy,
        }}
        fields={[
          {
            key: "enabled",
            label: "Enable facility presence",
            type: "checkbox",
          },
          {
            key: "allowOffline",
            label: "Allow staff to appear offline",
            type: "checkbox",
          },
          {
            key: "idleMinutes",
            label: "Away after inactivity (minutes)",
            type: "number",
          },
          {
            key: "criticalSounds",
            label: "Critical alert sounds bypass DND and quiet hours",
            type: "checkbox",
          },
        ]}
        label="Save presence policy"
        onSubmit={svc.savePresencePolicy}
      />
    </Card>
  ) : null;
}

export function PresencePicker({ db }: { db: Database }) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const { h, a } = svc.context(db);
  if (h.presencePolicy?.enabled === false) return null;
  return (
    <div className="status-picker">
      <button
        className="hid-button button secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Status: {presenceOf(db, a.id).status}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="Choose your status"
      >
        {[
          "Online",
          "Away",
          "Do not disturb",
          ...(h.presencePolicy?.allowOffline === false ? [] : ["Offline"]),
        ].map((status) => (
          <button
            key={status}
            className="hid-button button secondary"
            onClick={async () => {
              try {
                await svc.setPresence(status, "", 60);
                setOpen(false);
              } catch {
                setError("Connect to update your status.");
              }
            }}
          >
            {status}
          </button>
        ))}
        {error && <p role="alert">{error}</p>}
        <p>Applies for one hour. Custom status and expiry are in My profile.</p>
      </Popover>
    </div>
  );
}
