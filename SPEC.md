# SPEC — Pulse

**healthchecks.io for AI agents: uptime + delivery confirmation for scheduled agent tasks. Know within minutes when your agent silently stopped showing up.**
Repo: `pulse` · License: MIT (SDKs + self-host core) · Track: Money (first recurring revenue) · Target: 3–4 weeks

---

## 0. Mission & Positioning

Scheduled agents fail by *absence*: the nightly digest doesn't send, the cron skill dies, the delivery never lands — and no error fires anywhere (OpenClaw issues #33815, #77520, #90822 are exactly this class). Pulse is a dead-man's switch: agents check in; silence triggers alerts.

Positioning: **"Your agent promised to show up every morning at 7. Pulse notices when it doesn't."**

**Principles:**
1. **The evaluator is the product.** A missed-ping detector that itself misses pings is dead on arrival. Correctness of schedule evaluation > every feature.
2. **Integration in 60 seconds.** One curl line makes any agent monitorable. SDKs are sugar, not requirements.
3. **Boring, reliable stack.** This is infrastructure; novelty is a liability.

## 1. Scope

### P0
- **Ping API:** `POST /api/ping/:token` with `?state=start|success|fail`, optional JSON body (`meta`, `delivery: { channel, provider_message_id }`). Idempotent, <50ms p95, accepts out-of-order.
- **Monitors:** name, schedule (interval `every: 24h` or cron expr + timezone), grace window, expected-delivery flag, tags.
- **Evaluator:** worker that derives monitor state (`up | late | down | failing`) from ping stream vs. schedule; opens/closes incidents; DST-safe, timezone-correct.
- **Delivery confirmation (the differentiator):** monitors with `expected_delivery: true` alert when a run reports success **without** a `provider_message_id` — catching "completed but never sent." (V1 = attestation-based; verifying against channel APIs is P1.)
- **Alerts:** email, Telegram, Discord, Slack webhook, generic webhook. Incident open + resolve notifications, deduped, with "last seen" context and a fix hint.
- **Dashboard:** monitor list w/ live states, incident timeline, per-monitor detail (ping history sparkline), public status page per project (optional, unlisted URL).
- **Integrations gallery:** copy-paste snippets — curl, TypeScript SDK, Python SDK, OpenClaw skill wrapper, Claude Code hook, GitHub Actions step. Blackbox forwarder documented.
- **Billing:** Stripe. Free: 3 monitors, 1 channel. Solo $9/mo: 20 monitors. Team $29/mo: 100 monitors, 5 teammates, status pages.
- **Accounts:** email magic-link + GitHub OAuth. Orgs with member invites (Team tier).

### P1
Channel-API delivery verification (Telegram/Discord bot checks message actually exists), maintenance windows, monitor auto-provisioning API, Terraform provider, self-host docker-compose distribution.

### Out of scope (v1)
Metrics/APM ambitions, log ingestion, on-call rotations/paging policies (integrate, don't rebuild PagerDuty).

## 2. Architecture

```
apps/
  web/         # Next.js (app router): dashboard, marketing page, status pages, auth
  worker/      # evaluator + alert dispatcher (Node, long-running)
packages/
  core/        # schedule evaluation engine (PURE — the tested heart)
  db/          # Drizzle schema + migrations (Postgres)
  sdk-ts/      # @pulse/ping
  sdk-py/      # pulse-ping (published to PyPI)
integrations/  # openclaw-skill/, claude-code-hook/, github-action/
fixtures/      # ping-stream scenarios for evaluator tests
```

- **Stack:** Next.js + Postgres (Neon) + Drizzle; worker on Fly.io (2 instances, leader-elected via advisory lock); **pg-boss** for jobs (no Redis — one database, fewer moving parts); Resend (email), Stripe (billing). Rate limiting via a Postgres token bucket.
- **Evaluator design:** pure function `evaluate(monitor, pings[], now) → state + dueIncidents` in `packages/core`, exhaustively property-tested (fast-check) across timezones/DST/late-and-out-of-order pings. The worker is a thin loop: fetch due monitors (indexed `next_expected_at`), run pure evaluator, persist, dispatch.
- **Idempotency everywhere:** ping ingest dedupes on (token, state, client_ts window); alert dispatch dedupes on incident id + channel; worker restarts are safe by construction.

### Data model (Postgres)
```
orgs(id, name, plan, stripe_customer_id)
users(id, email) / memberships(user_id, org_id, role)
projects(id, org_id, name)
monitors(id, project_id, name, schedule_kind, schedule_expr, tz, grace_s,
         expects_delivery, status, next_expected_at, last_ping_at, paused)
pings(id, monitor_id, state, received_at, client_ts, meta_jsonb, delivery_jsonb)   -- partitioned by month
incidents(id, monitor_id, kind, opened_at, resolved_at, summary)                    -- kind: missed|failed|no_delivery
alert_channels(id, project_id, kind, config_jsonb, verified)
alert_events(id, incident_id, channel_id, sent_at, status, dedupe_key)
api_keys(id, org_id, hash, scopes)
```

## 3. Milestones & Acceptance

### M0 — Scaffold + deploy pipeline (days 1–2)
Monorepo, CI, staging + prod environments on Fly/Vercel from day one (deploy is a feature), Drizzle migrations wired, `make golden` = seed → simulated ping stream → expected incident opens.
**Accept:** hello-world deployed to staging + prod via CI; migrations run automatically; golden stub green.

### M1 — Ping ingest + evaluator core (week 1) ← the heart
Ping endpoint (validated, idempotent, fast) + `packages/core` evaluator with property tests: interval schedules, cron schedules across 6 timezones, DST spring/fall transitions, grace windows, late pings, out-of-order pings, flapping.
**Accept:** property-test suite (≥1,000 generated cases) green; simulated-clock scenario suite in `fixtures/` matches expected state transitions 100%; ingest p95 <50ms under k6 load test (500 rps sustained); zero missed-detection in a 10,000-monitor simulated day.

### M2 — Incidents + alerts (week 2)
Incident lifecycle, all 5 alert channels with verification step ("send test alert"), dedupe, resolve notifications, alert copy: *"⏰ 'morning-digest' is 22 min late (expected 07:00 EDT, grace 15m). Last successful run: yesterday 07:02. → pulse.dev/m/abc"*.
**Accept:** induced miss → alert within evaluator-tick + 30s; failed channel retries ×3 with backoff then surfaces a channel-health warning; every alert includes last-seen context + link; resolve alert fires exactly once.

### M3 — Dashboard + status pages + delivery confirmation (week 2–3)
Monitor CRUD with schedule preview ("next 5 expected check-ins" — kills config errors), live states, incident timeline, ping sparklines; delivery-confirmation monitors + `no_delivery` incident kind; unlisted status pages.
**Accept:** create-monitor flow from zero to first ping <60s (usability test scripted); schedule preview matches evaluator across tz/DST cases; success-ping-without-delivery-id opens `no_delivery` incident; status page loads <500ms, no auth leaks (only public fields).

### M4 — SDKs + integrations + docs (week 3)
TS + Python SDKs (ping + wrap-decorator: `@pulse.watch("morning-digest")`), OpenClaw skill wrapper, Claude Code hook example, GitHub Action, docs site with copy-paste-first layout.
**Accept:** each integration has a runnable example in `integrations/` verified in CI; SDKs published (npm + PyPI) with typed APIs; quickstart tested on a fresh machine <5 min.

### M5 — Billing + limits + hardening (week 4)
Stripe checkout + portal, plan limits enforced (monitor counts, channels, members), rate limits, API keys, abuse guards (ping flood → per-token throttle), backup/restore runbook, external uptime monitoring on Pulse itself (eat your own dog food: a Pulse monitor for Pulse's worker, alerting to your phone via an independent path).
**Accept:** upgrade/downgrade/cancel flows tested in Stripe test mode; limits enforced with humane upsell copy; k6 soak (24h simulated) with zero evaluator drift; disaster-recovery drill documented (restore staging from prod backup).

### M6 — Launch (week 4+)
Landing page (the pitch: silent absence, with a live demo monitor you can watch miss), Show HN, integrations gallery as SEO surface, Blackbox cross-promo.
**Accept:** first 10 external users onboarded; TTFHW (time to first heartbeat) median <10 min measured; billing live.

## 4. Quality Bar

- **Correctness:** evaluator = pure + property-tested; simulated-clock suite is the regression firewall; any evaluator bug fix ships with a new fixture.
- **Reliability target:** 99.9% (worker leader-election, dual instance, health endpoint watched externally + independent alert path); status page for Pulse itself; incident postmortems public from day one (trust product).
- **Security:** ping tokens ≥128-bit, unguessable, revocable; API keys hashed; org isolation tested (cross-tenant access test in CI); least-privilege DB roles; no PII in pings encouraged (docs) + meta size caps.
- **Operations:** structured logs, error tracking (Sentry), migration rollback plan, runbook.md covering the 6 likely 3am pages.

## 5. Interlock & Monetization

- Blackbox M6 ships "Forward to Pulse" (one config line) — Blackbox catches wrongness, Pulse catches absence; together = the full trust story.
- Free tier is the top of the funnel from OSS audiences; $9 solo tier targets the 300–400K personal-agent self-hosters; $29 team tier targets small agencies running client agents.

## 6. Prompting Opus 4.8 for this repo

- "packages/core is pure. If evaluator code needs IO, stop and write an ADR."
- "Every timezone/DST behavior gets a fixture before implementation. Test names read as specs: `spring_forward_gap_does_not_false_alarm`."
- "Alert copy is product copy: humane, contextual, one link. No raw JSON in alerts."
- "Deploy early: staging must exist by M0. Every milestone ends deployed."
