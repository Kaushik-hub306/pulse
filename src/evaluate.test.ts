import { describe, it, expect } from "vitest";
import { evaluate, type Monitor, type Ping } from "./evaluate";

const HOUR = 3_600_000;
const base: Monitor = { id: "m1", name: "morning-digest", intervalMs: 24 * HOUR, graceMs: HOUR };

describe("Pulse evaluate()", () => {
  it("is pending with no pings", () => {
    expect(evaluate(base, [], 0).status).toBe("pending");
  });

  it("is pending when paused, regardless of pings", () => {
    const pings: Ping[] = [{ state: "success", receivedAt: 0 }];
    expect(evaluate({ ...base, paused: true }, pings, 10 * HOUR).status).toBe("pending");
  });

  it("is up right after a successful check-in", () => {
    const pings: Ping[] = [{ state: "success", receivedAt: 0 }];
    expect(evaluate(base, pings, 1 * HOUR).status).toBe("up");
  });

  it("is late once past the interval but within grace", () => {
    const pings: Ping[] = [{ state: "success", receivedAt: 0 }];
    const now = 24 * HOUR + 30 * 60_000; // 24h30m, grace is 1h
    expect(evaluate(base, pings, now).status).toBe("late");
  });

  it("is down once past interval + grace", () => {
    const pings: Ping[] = [{ state: "success", receivedAt: 0 }];
    const now = 24 * HOUR + 2 * HOUR; // beyond grace
    const ev = evaluate(base, pings, now);
    expect(ev.status).toBe("down");
    expect(ev.reason).toContain("no check-in");
  });

  it("is failing when the last completed run failed (within schedule)", () => {
    const pings: Ping[] = [
      { state: "success", receivedAt: 0 },
      { state: "fail", receivedAt: 1000 },
    ];
    expect(evaluate(base, pings, 2000).status).toBe("failing");
  });

  it("absence outranks a prior failure", () => {
    const pings: Ping[] = [{ state: "fail", receivedAt: 0 }];
    const now = 24 * HOUR + 2 * HOUR;
    expect(evaluate(base, pings, now).status).toBe("down");
  });

  it("flags no_delivery when a delivery-expecting monitor succeeds without an id", () => {
    const pings: Ping[] = [{ state: "success", receivedAt: 0, deliveryId: null }];
    expect(evaluate({ ...base, expectsDelivery: true }, pings, 1 * HOUR).status).toBe("no_delivery");
  });

  it("is up when a delivery-expecting monitor reports a delivery id", () => {
    const pings: Ping[] = [{ state: "success", receivedAt: 0, deliveryId: "msg_123" }];
    expect(evaluate({ ...base, expectsDelivery: true }, pings, 1 * HOUR).status).toBe("up");
  });

  it("handles out-of-order pings by sorting on receivedAt", () => {
    const pings: Ping[] = [
      { state: "success", receivedAt: 5000 },
      { state: "start", receivedAt: 0 },
    ];
    const ev = evaluate(base, pings, 6000);
    expect(ev.lastPingAt).toBe(5000);
    expect(ev.status).toBe("up");
  });
});
