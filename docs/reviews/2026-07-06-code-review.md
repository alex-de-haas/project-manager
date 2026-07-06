# project-manager — Code Review

- **Date:** 2026-07-06
- **Baseline:** `main` @ `93abc8a`
- **Scope:** entire repo — `src/` (Next.js 16 / React 19 / TypeScript; app/, components/, features/, lib/, types/, `instrumentation.ts`, `otel-logs.ts`, `proxy.ts`), `manifest.json`, `Dockerfile`, `scripts/`, `.github/workflows`, `next.config.js`, repo hygiene.
- **Method:** full static read of the persistence/auth/proxy/OTel core and a pass over routes and web; the top finding re-verified line-by-line in the main session. No builds/tests were run.

**Persistence is SQLite via better-sqlite3** (`data/project_manager.db`), not JSON files. Auth is enforced both at the edge (`src/proxy.ts` Next 16 middleware) and per-route.

**Severity scale.** *Critical* — guaranteed data loss or remote-unauthenticated compromise. *High* — real security/data-loss path or actively misleading behavior. *Medium* — correctness/robustness with a plausible trigger. *Low* — hardening, UX, hygiene.

**Totals:** 1 Critical / 2 High / 6 Medium / 6 Low.

---

## Executive summary

Above-average codebase: two-layer auth (edge middleware revalidating the Hosty identity token at Core + per-route checks) is consistent and genuinely per-user/per-project; the Markdown renderer is XSS-safe (React nodes, no `dangerouslySetInnerHTML`, scheme-restricted hrefs); SSRF defense-in-depth exists; OTel wiring matches the fleet convention with correct recursion suppression; `tsconfig` is strict; git hygiene is clean (`.env.local`, `data/`, `.next/`, `*.db`, `.DS_Store` all untracked and gitignored).

But there is one **guaranteed-data-loss trap** that dominates everything else: any schema-version bump (or an older build meeting a newer DB) silently DROPs every table on boot. That is C1 and should be fixed before anything else ships. The High tier is a plaintext Azure DevOps PAT at rest and an unbounded-buffer DoS in the ICS importer.

---

## Repo hygiene (checked first)

`git ls-files` confirms **no junk or secrets are tracked**: `.env.local`, `data/`, `.next/`, `tsconfig.tsbuildinfo`, `next-env.d.ts`, `.playwright-cli`, `.DS_Store` are present on disk but untracked, and `.gitignore` covers each. `.env.local` holds two config vars (`PROJECT_MANAGER_DEV_ADMIN_IDENTITY`, `DOCKER_HOST_INTERNAL_ORIGIN`) — **neither is referenced anywhere in `src/`** (dead config) and neither is git-tracked. One gap: `.dockerignore` omits `.env.local` (see M5).

---

## Critical

### C1 — Any schema-version bump silently DROPs every table (total data loss)
`src/lib/db.ts:12,67-89`. `schemaVersion = "domain-model-v3"`. On startup `initDb()` runs, verbatim:
```
if (tableCount > 0 && currentSchemaVersion !== schemaVersion) {
  db.pragma("foreign_keys = OFF");
  db.exec(`DROP TABLE IF EXISTS checklist_items; … DROP TABLE IF EXISTS module_settings;`); // all 17 tables
}
```
*(Verified line-by-line.)* The only real "migration" is one additive `app_display_name` column (`:390-402`). **There is no migration path.** The moment anyone ships `domain-model-v4` — or a user runs an older build against a newer DB, or `module_settings` loses its row — every project, task, time entry, blocker, release, and backup record is destroyed on the next boot, with no warning and no automatic backup. The two DB files under `data/` (`project_manager.db` + a stale `time_tracker.db`) are evidence a rename already happened once. **Fix:** replace the drop-all with incremental, versioned migrations (a `PRAGMA user_version` step ladder, or per-version `ALTER` scripts); never destructively reset on mismatch; at minimum auto-backup before any destructive path and refuse to wipe without an explicit opt-in.

---

## High

### H1 — Azure DevOps PAT stored in plaintext at rest
`src/lib/azure-devops/settings.ts:164-179` (`upsertAzureDevOpsUserPat` writes the raw token to `user_credentials.value`) and `:123-136` (read back verbatim). PATs are long-lived org credentials sitting unencrypted in `project_manager.db`, which is also copied wholesale into every admin-created backup (`createDatabaseBackup` → `db.backup()`, `db.ts:461-483`). Anyone with filesystem/backup access to the app data dir gets working Azure DevOps tokens. **Fix:** encrypt credentials at rest (a key derived from the Hosty service token, or a libsodium sealed box) before persisting, and redact/encrypt them in backups; at minimum document the exposure.

### H2 — Unbounded response buffering in ICS import (memory-exhaustion DoS)
`src/app/api/day-offs/import/route.ts:46,69-76`. `loadCalendarContent` returns `response.text()` — the **entire** remote body is buffered — and only afterward is `content.length > MAX_ICS_CONTENT_LENGTH (2 MB)` checked (`:71`). `safeServerFetch` imposes no size cap. Any authenticated user can point the importer at a URL that streams gigabytes and OOM the single Node process (which serves all users). **Fix:** stream with a hard byte cap (abort once received bytes exceed the limit) instead of `text()`-then-check; honor `Content-Length` up front.

---

## Medium

### M1 — Optimistic reorder never detects HTTP failures; silent UI/DB divergence
`src/app/(protected)/page.tsx:737-745`. The drag handler POSTs the new order with `fetch(...).catch(() => { …fetchTasks() })`. `fetch` rejects only on **network** errors, so a `4xx/5xx` from `/api/tasks/reorder` resolves normally, the `.catch` never fires, and the optimistic order stays in the UI while the DB was not updated — divergence until an unrelated refetch. The `fetch` is also fired **inside the `setTasks` updater** (an impure reducer), which double-invokes under `reactStrictMode` in dev → duplicate POSTs. **Fix:** move the network call out of the state updater; check `response.ok` and roll back (refetch) on any non-OK status.

### M2 — `fetchTasks`/`fetchDayOffs` have no request sequencing or AbortController (stale-response race)
`src/app/(protected)/page.tsx:641-683`, effects at `:770-776`. Rapid week/month navigation fires overlapping `/api/tasks` and `/api/day-offs` requests keyed on `dateRange`; whichever resolves **last** wins, not necessarily the latest requested range — the grid can show a previous period's data. Only `ImportModal` uses an AbortController anywhere. **Fix:** per-effect `AbortController` (abort on cleanup) or a monotonically increasing request id, as already done for the time-entries effect (`:971-1002`).

### M3 — SSRF DNS-rebinding TOCTOU in `safeServerFetch`
`src/lib/safe-fetch.ts:120-137,151`. The URL is validated by resolving `url.hostname` and rejecting private/reserved IPs, but `fetch(currentUrl.toString(), ...)` then **re-resolves** the hostname independently. A hostname public at validation time and loopback/metadata at fetch time bypasses the guard. Reachable by any authenticated user via `day-offs/import`, and by admins via `ai-provider/test` / `checklist/generate` (which pass `allowPrivateNetwork: true`). **Fix:** resolve once and connect to the validated IP (pin via a custom `lookup`/agent, or IP-as-host + `Host` header); or use an outbound-host allowlist.

### M4 — Manifest/package version drift
`manifest.json:6` declares `0.5.2` while `package.json` is `0.5.0`; `scripts/render-app-manifest.mjs` rewrites only the image repo/tag, never the version — the published manifest advertises a version the artifact doesn't carry (the exact "footer shows wrong version" drift class from platform history). **Fix:** single-source the version (derive `manifest.version` from `package.json` in the render script, or a CI check).

### M5 — Dockerfile runs as root, unpinned base, and leaks `.env.local` into the build context
`Dockerfile` has no `USER` — Next runs as **root** (larger escape blast radius). Base `node:20-bookworm-slim` is a moving tag, not digest-pinned (non-reproducible). `.dockerignore` does not list `.env.local`, so `COPY . .` in the builder stage bakes it into that layer (the final runner stage doesn't copy it, so exposure is limited to the builder layer). **Fix:** add `USER node`, pin the base by digest, add `.env*.local` to `.dockerignore`.

### M6 — OTel console bridge can flood/leak via ubiquitous `console.error(err)`
`src/otel-logs.ts:61-77` bridges **all** `console.*` to OTLP; every route uses `console.error('Database error:', error)` (e.g. `tasks/route.ts:245`). Error objects can embed SQL fragments / parameter values, and high error rates ship unbounded structured logs. Gating (`instrumentation.ts:12`) and recursion suppression are correct, but there is no PII scrubbing or rate limiting. **Fix:** avoid logging raw error objects with user data; add redaction and a log-rate guard.

---

## Low

- **L1.** No automated tests at all — zero `*.test/*.spec`, no jest/vitest/playwright config (the three `test/route.ts` files are API endpoints, not tests). For a data-mutation-heavy app, notable; C1/M1/M3 are exactly the logic that most needs coverage.
- **L2.** CI does no explicit lint/typecheck job — it relies on `next build` (partial). Add `eslint` + `tsc --noEmit` steps.
- **L3.** Backup/restore has no schema-version guard (`db.ts:515-587` uses `INSERT … SELECT *`, relying on identical column count/order); restoring an older-schema backup fails with an opaque SQLite error. Store the schema version per backup and check it.
- **L4.** Admin fallback project is arbitrary (`user-context.ts:49-54` → `ORDER BY created_at LIMIT 1`); mutations can silently land in an unexpected project. Prefer requiring an explicit project for admins too.
- **L5.** Release reordering is not manager-gated (`releases/reorder/route.ts:27-39` updates by `project_id` only); any project member can reorder shared releases for everyone. Confirm intent or gate with `canManageProject`.
- **L6.** No SQLite `WAL`/`busy_timeout`. Safe today (single synchronous shared connection serializes queries on the event loop), but `db.backup()`/restore `ATTACH` or any future second connection could surface `SQLITE_BUSY`. Consider `journal_mode=WAL` + `busy_timeout`.

---

## Architecture observations

- **Two-layer auth is solid.** `src/proxy.ts` revalidates the Hosty app-identity token/cookie against Core, **strips then re-injects** the internal `x-project-manager-host-*` headers (`:136-151`, `host-identity.ts:198-227`), and every route independently calls `getRequestUserId`/`requireAdminUser`. Header spoofing is prevented while the proxy runs (matches all dot-less paths). CSRF is mitigated for cookie-auth mutations via `sec-fetch-site` (`proxy.ts:35-38`).
- **Authorization is genuinely per-user/per-project** — row-level scoping via `getWorkItemForUser`, `canAccessProject`, `getUserProjectMembership`, and `time_tracking_items` EXISTS subqueries. No unprotected mutation route found.
- **Concurrency is handled implicitly by better-sqlite3** — all DB calls synchronous on one shared connection, so concurrent route handlers are serialized; multi-step writes use `db.transaction(...)` correctly.
- **XSS surface is well-contained** — `MarkdownContent.tsx` builds React nodes; `getSafeHref` restricts to `http/https/mailto`; the only `dangerouslySetInnerHTML` (`layout.tsx:64`) injects a static theme-bootstrap string.
- **SSRF defense-in-depth exists** (`safe-fetch.ts` scheme/credential checks, private-range blocklist, manual redirect re-validation) — weakened only by the M3 TOCTOU.
- **OTel matches fleet convention** — gated on `OTEL_EXPORTER_OTLP_ENDPOINT` + `NEXT_RUNTIME === "nodejs"`, no localhost fallback, console→OTLP bridge with both a synchronous `emitting` flag and an `AsyncLocalStorage` export-suppression guard.

## Test / tooling gaps

- **Zero tests** for a persistence- and auth-heavy app; the DB migration wipe (C1), reorder failure handling (M1), and SSRF guards (M3) most need coverage.
- **CI is minimal** (`ci.yml` = `npm ci` + `npm run build`; `docker-publish.yml` builds/pushes multi-arch + a `latest` manifest). No lint/typecheck/test job, no manifest-vs-package version check.
- **tsconfig strict** (good). **ESLint** extends `next/core-web-vitals` but disables `react-hooks/set-state-in-effect` — precisely the rule that would have flagged the impure `setState` side-effect in M1.

## Priority

1. **C1** replace drop-all-on-mismatch with incremental migrations + pre-migration backup (data safety — do first).
2. **H1** encrypt the Azure DevOps PAT at rest; **H2** cap the ICS import buffer.
3. **M1 / M2** reorder failure handling + fetch race (silent divergence / wrong-period data).
4. **M3** SSRF TOCTOU; **M4** version single-sourcing; **M5** non-root + `.dockerignore` + digest pin.
5. **L1/L2** add a test + lint/typecheck CI job (would have caught several of the above).
