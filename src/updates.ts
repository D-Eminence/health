import { hasUnsaved } from "./feedback";
import { deviceState, hasPendingDeviceChanges } from "./storage";

export async function updateSafe() {
  return (
    !hasUnsaved() &&
    !deviceState().syncing &&
    !(await hasPendingDeviceChanges())
  );
}
export function watchUpdateSafety() {
  const listener = (event: MessageEvent) => {
    if (event.data?.type === "health-id-update-check")
      void updateSafe()
        .then((safe) => event.ports[0]?.postMessage(safe))
        .catch(() => event.ports[0]?.postMessage(false));
  };
  navigator.serviceWorker?.addEventListener("message", listener);
  return () =>
    navigator.serviceWorker?.removeEventListener("message", listener);
}
export async function refreshUpdate(): Promise<string> {
  if (!(await updateSafe()))
    return "Save your edits and sync pending changes before refreshing.";
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration?.waiting) {
    location.reload();
    return "";
  }
  const worker = registration.waiting;
  const result = await new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data === true);
    };
    worker.postMessage({ type: "health-id-activate" }, [channel.port2]);
  });
  if (!result)
    return "Refresh is paused. Save and sync work in your open Health ID windows, then try again.";
  if (!(await updateSafe()))
    return "New work was detected. Save and sync it before refreshing.";
  location.reload();
  return "";
}
