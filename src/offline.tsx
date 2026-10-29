import { plural } from "./copy";
import { refreshUpdate, watchUpdateSafety } from "./updates";
import { Popover, Drawer, Banner, safeError } from "./feedback";
import React, { useEffect, useState } from "react";
import { networkSnapshot, probe, startNetwork } from "./connectivity";
import {
  cacheMeta,
  deviceState,
  lockListeners,
  queueForCurrent,
  startAutoLock,
  unlockDevice,
} from "./storage";
import { syncNow } from "./sync";
import { PasswordInput } from "./ui";
import { listConflictReviews } from "./conflicts";
import { ConflictReviewDrawer } from "./conflict-review";
export function OfflineTools() {
  const [reviews, setReviews] = useState<
    Awaited<ReturnType<typeof listConflictReviews>>
  >([]);
  const [reviewId, setReviewId] = useState("");
  const [network, setNetwork] = useState(networkSnapshot()),
    [open, setOpen] = useState(false),
    [details, setDetails] = useState(false),
    [items, setItems] = useState<Awaited<ReturnType<typeof queueForCurrent>>>(
      [],
    ),
    [last, setLast] = useState<number | null>(null),
    [locked, setLocked] = useState(deviceState().locked),
    [error, setError] = useState(""),
    [space, setSpace] = useState(false);
  useEffect(() => {
    const workspace = document.getElementById("health-id-workspace");
    if (workspace) workspace.inert = locked;
  }, [locked]);
  useEffect(() => {
    const stopUpdateWatch = watchUpdateSafety();
    startNetwork();
    startAutoLock();
    const lock = () => setLocked(deviceState().locked);
    lockListeners.add(lock);
    const update = async () => {
      setNetwork({ ...networkSnapshot() });
      setItems(await queueForCurrent());
      setReviews(await listConflictReviews());
      setLast((await cacheMeta())?.lastSync || null);
      lock();
    };
    void update().catch(() => {});
    const t = setInterval(() => void update().catch(() => {}), 1000);
    const s = setInterval(() => void syncNow().catch(() => {}), 10000);
    void navigator.storage
      ?.estimate()
      .then((e) => setSpace(!!e.quota && (e.usage || 0) > e.quota * 0.85));
    return () => {
      stopUpdateWatch();
      clearInterval(t);
      clearInterval(s);
      lockListeners.delete(lock);
    };
  }, []);
  const pending = items.filter((i) => i.state !== "synced"),
    problem =
      reviews.length > 0 ||
      pending.some((i) => i.state === "conflict" || i.state === "attention");
  return (
    <>
      <aside className="connection-tools">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Connection and sync status"
        >
          <span aria-hidden="true">● </span>
          {problem
            ? "Needs attention"
            : deviceState().syncing
              ? "Syncing"
              : network.state === "Online"
                ? "All changes saved"
                : network.state}
          {pending.length ? ` · ${pending.length} pending` : ""}
        </button>
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          label="Connection details"
        >
          <strong>{network.state}</strong>
          <p>{plural(pending.length, "saved change")} waiting to sync.</p>
          <p>Last sync: {last ? new Date(last).toLocaleString() : "Not yet"}</p>
          <p>
            Cached clinical records remain available offline. Administrative
            changes require a connection.
          </p>
          <button
            onClick={() => {
              setOpen(false);
              setDetails(true);
            }}
          >
            View sync details
          </button>
        </Popover>
      </aside>
      <Drawer
        open={details}
        title="Connection and sync details"
        onClose={() => setDetails(false)}
      >
        {" "}
        <strong>Connection & saved work</strong>
        <p>Local simulation · {network.state}</p>
        <p>Last sync: {last ? new Date(last).toLocaleString() : "Not yet"}</p>
        <p>
          Up to 100 assigned/recent patients per workspace. Offline access lasts
          up to 8 hours; inactivity locks after 5 minutes.
        </p>
        <p>
          Cached clinical work can be saved offline. Administrative changes
          require a connection.
        </p>
        {space && (
          <p role="alert">
            Device storage is nearly full. Free space before attaching files.
            Pending clinical work is retained.
          </p>
        )}
        <button
          onClick={() =>
            void probe()
              .then(() => syncNow())
              .catch((e) => setError(e.message))
          }
        >
          Sync now
        </button>
        {error && <p role="alert">{safeError(error)}</p>}
        {reviews.length > 0 && (
          <section className="record-block">
            <h3>Clinical reviews for this branch</h3>
            <p>
              These include conflicts saved by other staff. Only reviews within
              your current clinical permissions are shown.
            </p>
            {reviews.map((review) => (
              <article key={review.id}>
                <p>
                  {plural(review.count, "record change")} ·{" "}
                  {new Date(review.deviceAt).toLocaleString()}
                </p>
                <button
                  className="hid-button button secondary"
                  onClick={() => setReviewId(review.id)}
                >
                  Review versions
                </button>
              </article>
            ))}
          </section>
        )}
        {pending.map((i) => (
          <article key={i.id}>
            <strong>
              {i.state === "pending"
                ? "Saved on this device"
                : i.state === "conflict"
                  ? "Review required"
                  : "Needs attention"}
            </strong>
            <p>
              {i.changes.length} record changes ·{" "}
              {new Date(i.deviceAt).toLocaleString()}
            </p>
            <p>{i.reason ? safeError(i.reason) : ""}</p>
            {i.state === "conflict" && (
              <p>
                Both versions are retained. An authorized clinician can review
                this work from this branch's connection details when online.
                This item will not overwrite the connected version
                automatically.
              </p>
            )}
          </article>
        ))}
        <p>
          Signing out clears cached records and retains encrypted pending
          changes for authenticated sync.
        </p>
      </Drawer>
      <ConflictReviewDrawer
        batchId={reviewId}
        onClose={() => setReviewId("")}
        onResolved={() => {
          void listConflictReviews().then(setReviews);
        }}
      />
      {locked && (
        <div
          className="offline-lock"
          role="dialog"
          aria-modal="true"
          aria-label="Unlock workspace"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await unlockDevice(
                  String(form.get("email")),
                  String(form.get("password")),
                );
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <img src="/brand/logo.png" alt="Health ID" width="130" />
            <h1>Unlock your workspace</h1>
            <p>{deviceState().reason}</p>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <PasswordInput
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p role="alert">{safeError(error)}</p>}
            <button type="submit">Unlock</button>
            <p>Saved and pending work stays on this device.</p>
          </form>
        </div>
      )}
    </>
  );
}
export class ConnectionBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <small className="connection-tools">Connection status unavailable</small>
    ) : (
      this.props.children
    );
  }
}

export function OfflineBanner() {
  const [update, setUpdate] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const check = () =>
      void navigator.serviceWorker
        ?.getRegistration()
        .then((r) => setUpdate(!!r?.waiting));
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, []);
  return update ? (
    <div className="update-notice">
      <span>A new version is ready</span>
      <button
        onClick={() =>
          void refreshUpdate()
            .then(setMessage)
            .catch(() => setMessage("Unable to check saved work. Try again."))
        }
      >
        Refresh
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  ) : null;
}
