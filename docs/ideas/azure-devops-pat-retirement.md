# Azure DevOps PAT Retirement — Investigation & Deferred Plan

Created: 2026-06-25
Updated: 2026-06-25
Status: DRAFT — investigation parked, no implementation planned yet.

## Decision (TL;DR)

**Do nothing in code for now.** Microsoft is retiring **only global PATs** (tokens that
span every organization a user can access). **Organization-scoped PATs are not affected**
and keep working. Project Manager already authenticates per organization
(`https://dev.azure.com/{organization}`), so as long as users create org-scoped tokens the
integration keeps working without changes.

This document records the research so the question does not have to be investigated again.
It also captures a ready migration plan to Microsoft Entra OAuth for when (or if) PATs are
retired more broadly or an org disables PAT creation by policy.

### Revisit this when any of these becomes true

- Microsoft announces retirement of **org-scoped** PATs (not just global ones).
- A target organization disables PAT creation by tenant/admin policy.
- We want unattended/service-style sync that does not depend on a per-user token.

## Background — what Microsoft is changing

Source: <https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/>

- **Scope:** only **global** PATs in Azure DevOps **Services** (a single credential that
  reaches all accessible organizations). Azure DevOps **Server** is not affected.
- **Rationale:** "a single credential with broad reach creates a concentrated security risk."
- **Timeline:** creating/regenerating global PATs is blocked and existing global PATs stop
  working on **December 1, 2026** (postponed from the original March 15, 2026 date).
- **Microsoft's recommended replacement:** short-lived **Microsoft Entra-backed**
  authentication (OAuth 2.0). The two suggested transition paths are (a) split tokens per
  organization, or (b) move to Entra-based short-lived auth.
- **Not a viable target:** the legacy Azure DevOps OAuth app platform
  (`app.vssps.visualstudio.com`) is itself being deprecated — do not migrate to it.

## How Project Manager authenticates today

- Self-hosted, multi-user Hosty app (Next.js in Docker). Each user links their **own** PAT.
- PAT is stored per user, per project in the `user_credentials` table under key
  `azure_devops_pat` — `src/lib/azure-devops/settings.ts` (`upsertAzureDevOpsUserPat`).
- All Azure DevOps calls go through `azure-devops-node-api` with
  `getPersonalAccessTokenHandler(pat)` — `src/lib/azure-devops/settings.ts:456`
  (`createAzureDevOpsConnectionContext`) and the inline connection in
  `src/app/api/azure-devops/test/route.ts:40`.
- Per-user identity is core: queries use the `@Me` WIQL macro, resolved by Azure DevOps
  from the PAT-authenticated request identity
  (`src/app/api/azure-devops/work-items/route.ts:78`). The linked Azure DevOps identity is
  resolved and stored via `getAzureDevOpsAuthenticatedUser`
  (`src/lib/azure-devops/settings.ts:427`, called from
  `src/app/api/azure-devops/test/route.ts:46`).

### Code facts that make migration cheap (verified 2026-06-25)

All ~12 Azure DevOps API routes flow through **two choke points**:

1. `getAzureDevOpsSettingsForUser(userId, projectId)` — resolves the credential; currently
   returns `{ ...projectSettings, pat }`.
2. `createAzureDevOpsConnectionContext(settings)` — builds the auth handler from
   `settings.pat`. **Already `async`, and every caller already `await`s it.**

- The raw `.pat` value is consumed in only **2 places**: storage at
  `src/app/api/settings/route.ts:194` and handler construction at
  `src/lib/azure-devops/settings.ts:456`. A separate inline connection lives in
  `src/app/api/azure-devops/test/route.ts:40`.
- Because the connection builder is already async, token refresh can be added inside it
  **without changing any of the 12 calling routes**.

## Options considered

| # | Option | Keeps per-user identity? | Fits self-hosted? | Effort | Verdict |
|---|--------|--------------------------|-------------------|--------|---------|
| 1 | Org-scoped PAT (guidance only) | Yes | Yes (no code change) | ~0 | **Current choice** |
| 2 | Entra OAuth — Device Code flow | **Yes** | **Yes** (no redirect URI) | Medium | **Preferred migration target** |
| 3 | Entra OAuth — Auth Code + PKCE | Yes | Hard (redirect URI per deployment) | Medium/High | Rejected: per-deploy URLs |
| 4 | Service Principal (client credentials) | **No** (single app identity) | Yes | Medium | Only if we drop per-user attribution |
| 5 | Legacy Azure DevOps OAuth (`app.vssps`) | — | — | — | Rejected: itself deprecated |
| 6 | Managed Identity | No | No (Azure-only runtime) | — | Not applicable to Hosty/Docker |

Device Code flow (option 2) is preferred because it preserves per-user identity **and**
needs no redirect URI — which matters because every Hosty deployment runs on a different URL.

## Deferred migration plan (option 1 + 2 combined)

Goal: let each user choose **PAT or Microsoft sign-in**, keeping PAT working during the
transition. The cost is the OAuth machinery itself; supporting both methods side by side is
nearly free on top of it.

1. **Dependency & app registration:** add `@azure/msal-node`; register one **multi-tenant**
   Entra application (public client, device-code enabled). Azure DevOps scope:
   `499b84ac-1321-427f-aa17-267ca6975798/.default`.
2. **Credential storage:** keep `azure_devops_pat`; add `azure_devops_oauth` holding the
   refresh token plus cached access token and its expiry. The MSAL token cache must be
   **database-backed** (custom cache serializer), not in-memory — otherwise tokens are lost
   on container restart and not shared across multi-instance deployments.
3. **Credential resolver:** new `getAzureDevOpsUserCredential()` returning
   `{ type: 'pat' } | { type: 'oauth' } | null` (whichever is configured).
4. **Connection builder:** in `createAzureDevOpsConnectionContext`, branch on credential
   type — `pat` -> `getPersonalAccessTokenHandler`, `oauth` -> MSAL refresh +
   `getBearerHandler`. Apply the same branch to the inline connection in `test/route.ts`.
   Everything downstream is unchanged.
5. **Public settings:** replace `hasPat` with `credentialType: 'pat' | 'oauth' | null` in
   `getAzureDevOpsPublicSettings` / `getAzureDevOpsSettingsProblem`.
6. **Enrollment UX:** add a device-code flow (initiate -> show code + verification URL ->
   poll -> store refresh token), 1-2 new API endpoints, plus a "Connect via Microsoft"
   button next to the existing PAT field in
   `src/features/azure-devops/components/SettingsModal.tsx` and
   `src/features/settings/components/ProfileSettingsForm.tsx`.
7. **New error state:** handle expired/revoked refresh token -> surface "re-authenticate
   with Microsoft" (PAT has no equivalent because it is a static string).

### What this does NOT make free

The real cost lives entirely in option 2 regardless of coexistence: MSAL integration, the
access-token refresh lifecycle (~1h tokens), the interactive device-code enrollment flow,
and the refresh-failure re-auth state. Keeping PAT alongside OAuth adds only one branch in
the resolver and not deleting the existing PAT UI.

## Open questions (for when we pick this up)

- Single shared multi-tenant app registration vs. per-deployment registration, and whether
  admin consent is required in target tenants.
- Migration/coexistence window: do we ever auto-migrate existing PAT users, or only offer
  the new method going forward?
