# Pulse 🫀

**healthchecks.io for AI agents.** Your agent promised to run every morning at 7. Pulse notices when it doesn't — and, uniquely, when it *ran* but never actually delivered.

> Scheduled agents fail by *absence*: the nightly digest doesn't send, the cron skill dies, the delivery never lands — and no error fires anywhere. Pulse is the dead-man's switch.

---

## Status: `M0` — the evaluator core

This repo currently ships the **pure schedule-evaluation engine** (`src/evaluate.ts`) — the tested heart of the product — plus its test suite. The hosted API, worker loop, dashboard, SDKs, and Stripe billing land in later milestones (see [`SPEC.md`](./SPEC.md)); every one of them is a thin layer around this function.

Why start here? *A missed-ping detector that itself misses pings is dead on arrival.* Correctness of schedule evaluation outranks every feature, so it gets built and proven first.

## Quickstart

```bash
npm install
npm run typecheck
npm test          # evaluator suite: up / late / down / failing / no_delivery / pending
```

## The core in one call

```ts
import { evaluate } from "@agenttrust/pulse-core";

const monitor = { id: "m1", name: "morning-digest", intervalMs: 86_400_000, graceMs: 3_600_000, expectsDelivery: true };
const pings = [{ state: "success", receivedAt: Date.now() - 26 * 3_600_000, deliveryId: null }];

evaluate(monitor, pings, Date.now());
// → { status: "down", reason: "no check-in for ...s past the expected time", ... }
```

### State model

| Status | Meaning |
|--------|---------|
| `up` | On schedule |
| `late` | Overdue, still inside the grace window |
| `down` | Overdue beyond grace — the loud, actionable signal (absence beats everything) |
| `failing` | The most recent completed run reported failure |
| `no_delivery` | Run succeeded but reported no delivery id — the message may never have been sent |
| `pending` | Never checked in yet, or paused |

The delivery-confirmation state (`no_delivery`) is Pulse's differentiator: it catches the "completed but never sent" failure that ordinary uptime monitors miss.

## Design principles

1. **The evaluator is the product** — pure, exhaustively tested, no IO.
2. **Integration in 60 seconds** — one `curl` line makes any agent monitorable; SDKs are sugar.
3. **Boring, reliable stack** — this is infrastructure; novelty is a liability.

## License

MIT — see [`LICENSE`](./LICENSE). Part of the **Agent Trust Suite**; pairs with [Blackbox](https://github.com/Kaushik-hub306/blackbox) (which catches *wrongness* while Pulse catches *absence*).
