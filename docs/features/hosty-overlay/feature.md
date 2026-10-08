---
created: 2026-10-08
updated: 2026-10-08
summary: HostyOverlay coordinates identity recovery, required-permission readiness and protected content visibility at the application root.
components: [src]
---

# Hosty Overlay

The protected client tree and notifications render inside `HostyOverlay` from
`@hosty-sdk/app/react`. The SDK owns loading, Core sign-in/recovery, required setup,
light/dark presentation and interaction blocking. The application retains its theme
and launch-mode bridges, app-code exchange, cookie namespace and the project/session API and local token-expiry policy.

`GET /api/hosty/session` reads the app bearer or app cookie and validates it with
Core before checking required permissions. Administrators receive the SDK review
action for missing required grants; ordinary users receive administrator guidance
without permission controls. Optional grants do not block the app. Responses use
`Cache-Control: no-store` and expose no service credential.

The client tree stays unmounted until readiness. During renewal the SDK hides and
makes retained content and portals inert. Same-user renewal restores the mounted
tree; changing the authenticated Host user reloads the document, resetting its
in-memory application state and caches. Application APIs retain their own access
checks.

## SDK Dependency

The package manifest requires SDK `^0.22.1`, and the checked-in registry lockfile
resolves published npm version `0.22.1` with its registry integrity. This release
includes the Overlay and renewal-metadata fix from
[Hosty PR #559](https://github.com/alex-de-haas/docker-host/pull/559).
Compatible SDK updates arrive through the existing Dependabot group and the normal
application build/release process.

## Testing Expectations

- Run unit tests, lint and the production build against the selected SDK.
- Exercise readiness with no identity, bearer-before-cookie, administrator/member
  required setup and the existing application session contract.
- Verify ordinary Core password login both standalone and embedded in Shell;
  verify same-user renewal, actor switching and hidden/inert content while blocked.
- Validate app manifest rendering/structure and the generated documentation index.
- Verify installation and checks using the committed registry lockfile. Do not
  commit a local tarball dependency.

Registry verification with SDK 0.22.1 passes `npm ci`, 183 unit tests, lint,
typechecking and the production build with Next.js 16.3.8. Manifest rendering and
documentation validation pass. Earlier Core-managed candidate acceptance covers
standalone and Shell-embedded password login, a real activity deadline hiding an
open project dialog, and renewal as a different administrator resetting the page
without creating a draft project.
