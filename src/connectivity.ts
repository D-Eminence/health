export type ConnectionState =
  "Online" | "Slow connection" | "Reconnecting" | "Offline";
export type NetworkSnapshot = {
  state: ConnectionState;
  reachable: boolean;
  latency: number | null;
  checkedAt: number | null;
  serverTime: number | null;
  offset: number;
  simulated: boolean;
};
const snapshot: NetworkSnapshot = ((globalThis as any).__healthIdNetwork ||= {
  state: "Reconnecting",
  reachable: false,
  latency: null,
  checkedAt: null,
  serverTime: null,
  offset: 0,
  simulated: false,
});
const subscribers = new Set<() => void>();
let started = false,
  busy = false,
  failures = 0;
let override: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
export const networkSnapshot = () => snapshot;
export function subscribeNetwork(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
function publish(next: Partial<NetworkSnapshot>) {
  Object.assign(snapshot, next);
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}
export function connectionAvailable() {
  return snapshot.reachable;
}
export function trustedNow() {
  return Date.now() + snapshot.offset;
}
export function simulateConnection(mode: string) {
  override = mode === "automatic" ? null : mode;
  failures = 0;
  publish({ simulated: !!override });
  void probe();
}
export async function probe() {
  if (busy) return snapshot.reachable;
  busy = true;
  const start = performance.now();
  try {
    if (override === "offline" || (override === "lossy" && Math.random() < 0.6))
      throw Error("offline");
    if (override === "slow") await new Promise((r) => setTimeout(r, 1400));
    const response = await fetch("/health.json?probe=" + Date.now(), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok || (await response.json()).service !== "health-id-preview")
      throw Error("unreachable");
    const latency = performance.now() - start;
    const date = Date.parse(response.headers.get("Date") || "");
    const serverTime = Number.isFinite(date) ? date : null;
    failures = 0;
    const slow =
      latency > 1000 ||
      (
        (navigator as Navigator & { connection?: { effectiveType?: string } })
          .connection?.effectiveType || ""
      ).includes("2g");
    publish({
      state: slow ? "Slow connection" : "Online",
      reachable: true,
      latency: Math.round(latency),
      checkedAt: Date.now(),
      serverTime,
      offset:
        serverTime === null
          ? snapshot.offset
          : serverTime + latency / 2 - Date.now(),
    });
    return true;
  } catch {
    failures++;
    publish({
      state:
        failures >= 2 || navigator.onLine === false || override === "offline"
          ? "Offline"
          : "Reconnecting",
      reachable: false,
      checkedAt: Date.now(),
    });
    return false;
  } finally {
    busy = false;
  }
}
export async function requireConnection() {
  if (busy)
    for (let i = 0; i < 70 && busy; i++)
      await new Promise((r) => setTimeout(r, 50));
  if (!snapshot.reachable && !(await probe()))
    throw Error(
      "This action needs a connection to the local demonstration server. Your saved work is safe; try again when connected.",
    );
}
export function startNetwork() {
  if (started) return;
  started = true;
  void probe();
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void probe(), 1200);
  };
  window.addEventListener("online", schedule);
  window.addEventListener("offline", schedule);
  setInterval(() => void probe(), 15000);
}
