/**
 * Pulse schedule-evaluation core.
 *
 * This is the heart of the product: a PURE function that derives a monitor's
 * state from its ping history and the current time. It performs no IO, which
 * is what lets us property-test it exhaustively across schedules, grace
 * windows, and out-of-order pings. The worker is a thin loop around this.
 *
 * A missed-ping detector that itself misses pings is dead on arrival — so
 * correctness here outranks every feature in the product.
 */

export type MonitorStatus =
  | "pending" // never checked in yet, or paused
  | "up" // on schedule
  | "late" // overdue but inside the grace window
  | "down" // overdue beyond the grace window (the loud signal)
  | "failing" // most recent completed run reported failure
  | "no_delivery"; // run succeeded but reported no delivery id

export interface Monitor {
  id: string;
  name: string;
  /** Expected time between check-ins, in milliseconds. */
  intervalMs: number;
  /** Extra lateness tolerated before a monitor is considered down. */
  graceMs: number;
  /** When true, a successful run must report a delivery id or it is flagged. */
  expectsDelivery?: boolean;
  paused?: boolean;
}

export type PingState = "start" | "success" | "fail";

export interface Ping {
  state: PingState;
  /** Unix epoch milliseconds. */
  receivedAt: number;
  /** Provider message id, when the run reports a delivery. */
  deliveryId?: string | null;
}

export interface Evaluation {
  status: MonitorStatus;
  lastPingAt: number | null;
  nextExpectedAt: number | null;
  reason: string;
}

function isCompleted(p: Ping): boolean {
  return p.state === "success" || p.state === "fail";
}

export function evaluate(
  monitor: Monitor,
  pings: readonly Ping[],
  now: number,
): Evaluation {
  if (monitor.paused) {
    return { status: "pending", lastPingAt: null, nextExpectedAt: null, reason: "monitor is paused" };
  }

  const sorted = [...pings].sort((a, b) => a.receivedAt - b.receivedAt);
  const lastPing = sorted.at(-1) ?? null;

  if (lastPing === null) {
    return { status: "pending", lastPingAt: null, nextExpectedAt: null, reason: "no check-ins recorded yet" };
  }

  const lastPingAt = lastPing.receivedAt;
  const nextExpectedAt = lastPingAt + monitor.intervalMs;
  const deadline = nextExpectedAt + monitor.graceMs;

  // 1. Absence beats everything: a monitor that stopped checking in is the
  //    loudest, most actionable signal, regardless of what its last run said.
  if (now > deadline) {
    const overdueSec = Math.round((now - nextExpectedAt) / 1000);
    return { status: "down", lastPingAt, nextExpectedAt, reason: `no check-in for ${overdueSec}s past the expected time` };
  }

  const lastCompleted = [...sorted].reverse().find(isCompleted) ?? null;

  // 2. The most recent completed run explicitly failed.
  if (lastCompleted?.state === "fail") {
    return { status: "failing", lastPingAt, nextExpectedAt, reason: "the most recent run reported failure" };
  }

  // 3. Succeeded, but claims delivery it can't evidence.
  if (
    monitor.expectsDelivery &&
    lastCompleted?.state === "success" &&
    (lastCompleted.deliveryId === undefined ||
      lastCompleted.deliveryId === null ||
      lastCompleted.deliveryId === "")
  ) {
    return { status: "no_delivery", lastPingAt, nextExpectedAt, reason: "run succeeded but reported no delivery id — the message may never have been sent" };
  }

  // 4. Late but inside grace.
  if (now > nextExpectedAt) {
    return { status: "late", lastPingAt, nextExpectedAt, reason: "check-in is late but within the grace window" };
  }

  // 5. All good.
  return { status: "up", lastPingAt, nextExpectedAt, reason: "on schedule" };
}
