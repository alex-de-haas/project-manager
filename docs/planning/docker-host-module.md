# Docker Host Module Migration

## Description

Project Manager will be migrated from a standalone, locally authenticated Next.js application into an authenticated Docker Host shell module. Docker Host will own authentication, user access, and module assignment. Project Manager will own only module-specific permissions, project configuration, user profile credentials, planning data, and time-management data.

The existing production data does not need a full database migration because the current installation has effectively been used by one person. Before destructive schema and identity changes, the current app must provide a narrow JSON export that captures enough personal time data to re-import later under a Host-provided user account.

The target module behavior is:

- Host users are the only users. The app does not maintain a separate user directory.
- The module stores module permissions for Host users, with only two roles: admin and user.
- Admins can see Settings, manage module permissions, manage projects, and configure project/module settings.
- Non-admin users can access Time Management, Planning, and Calendar pages.
- Project settings hold project-level configuration such as Azure DevOps organization and project.
- Each user stores their own Azure DevOps PAT in their profile for that organization/project.
- LLM provider URL is a module-level/global setting. The selected model is global unless a later requirement needs per-project selection.
- The app uses a top navigation menu suitable for Host shell embedding instead of its own sidebar.
- Persistent module state lives under Docker Host-managed module storage.

## Milestones

### Phase 0 - Add legacy personal data export

**Status**: Completed

Add a small export capability to the current standalone application before making identity, schema, or Host integration changes.

Tasks:

- Completed: Add an export button in Settings under Database.
- Completed: Export a JSON file with a simple, stable structure for one legacy user and one legacy project.
- Completed: Include task time data grouped by Azure DevOps numeric work item id and date.
- Completed: Include day-offs in a separate list.
- Completed: Keep authentication, user management, project management, DevOps settings, and Host module behavior unchanged in this phase.
- Completed: Document the exported JSON structure in this planning document.

Recommended JSON shape:

```json
{
  "schemaVersion": "project-manager-legacy-export/v1",
  "exportedAt": "2026-05-23T00:00:00.000Z",
  "timeEntries": [
    {
      "workItemId": 12345,
      "entries": [
        {
          "date": "2026-05-22",
          "hours": 4
        }
      ]
    }
  ],
  "dayOffs": [
    {
      "date": "2026-05-20",
      "description": "Vacation",
      "isHalfDay": false
    }
  ]
}
```

Recommendation:

- Keep the export intentionally narrow. Use `tasks.external_source = 'azure_devops'` and numeric `tasks.external_id` as the exported work item id.
- Skip local-only tasks in the legacy export unless a later requirement says they must be preserved.
- Export only the current authenticated user's data.
- Keep this phase deployable on the existing standalone app so the JSON can be downloaded before the database reset.

### Phase 1 - Define Host identity mode and remove standalone user ownership

**Status**: Not Started

Replace standalone application identity with Docker Host identity.

Tasks:

- Remove the temporary Docker image `legacy` publishing path after the standalone backup image has been created.
- Add a Host authentication mode for module deployments.
- Validate signed `X-Docker-Host-Identity` JWTs against Host JWKS.
- Require issuer `docker-host`, audience equal to the module id, and non-expired tokens.
- Use the Host token `sub` as the stable user principal.
- Stop trusting client-controlled user selectors such as `x-user-id`, `userId`, and writable user cookies.
- Disable or remove local login, bootstrap, invitations, password changes, and logout in Host mode.
- Add a small local development identity fallback only if needed for standalone development.

Recommendation:

- Do not attempt to map legacy local users. Reset the database for the Host module version and create module records from Host identities as users arrive.

### Phase 2 - Add module-owned roles and scoped Host user directory integration

**Status**: Not Started

Keep Docker Host authorization separate from Project Manager module permissions.

Tasks:

- Use Docker Host scoped directory API to list users assigned to this module.
- Store module roles by Host user id, not by email.
- Support exactly two module roles: admin and user.
- Let admins assign or remove module admin rights from assigned Host users.
- Show Settings only to module admins.
- Keep all main work pages available to every assigned module user.
- Define bootstrap behavior for the first module admin.

Recommendation:

- Use `host.admin` only for bootstrap or emergency administrative access. Persist normal module administration in module-owned storage.

### Phase 3 - Reset and reshape persistence

**Status**: Not Started

Move from local user ownership to Host-user principals and module/project scoped storage.

Tasks:

- Replace local user directory assumptions with Host user references.
- Decide which tables need `host_user_id` owner fields versus project-only fields.
- Keep projects as module-owned records managed by module admins.
- Keep project membership/assignment against Host user ids.
- Move project settings to project-level storage.
- Add global module settings for values that should not vary by user or project.
- Add user profile settings for per-user secrets and personal preferences.
- Add import support for the Phase 0 legacy JSON export under the currently authenticated Host user.

Recommendation:

- Preserve local integer ids for internal joins where useful, but make Host user id the source of truth for user identity.

### Phase 4 - Rework Azure DevOps integration

**Status**: Not Started

Split Azure DevOps project configuration from user credentials.

Tasks:

- Store Azure DevOps organization and project in project settings.
- Store each user's PAT in their own profile credentials.
- Use the current Host user's PAT for import, export, refresh, and status synchronization.
- Block DevOps import/export/sync features when the current user has no PAT.
- Keep manual task and time-management functionality available without a PAT.
- Test that Azure DevOps changes are attributed to the PAT owner in Azure DevOps history.
- Redact PAT values in all API responses and UI forms.

Recommendation:

- Store only `hasPat` in API responses. If secrets remain in SQLite, encrypt them with a module secret supplied by Docker Host settings.

### Phase 5 - Rework LLM provider configuration

**Status**: Not Started

Move AI provider configuration out of per-user/per-project settings.

Tasks:

- Add a global/module-level LLM provider base URL setting.
- Add a global selected model setting.
- Replace loopback-only LM Studio assumptions with a configured provider URL that works from inside the module container.
- Restrict LLM provider configuration to admins.
- Keep checklist generation available only when the provider and model are configured.

Recommendation:

- Configure provider URL through Docker Host module settings when possible, then mirror only non-secret display/configuration state in the app database.

### Phase 6 - Replace app sidebar with Host-friendly top navigation

**Status**: Not Started

Make the module UI fit inside Docker Host shell.

Tasks:

- Remove the application sidebar.
- Add top navigation for Time Management, Planning, Calendar, and Settings.
- Hide Settings for non-admin users.
- Move project switching into the top bar or a compact project selector.
- Add a user profile entry for personal settings such as Azure DevOps PAT and legacy data import.
- Remove local logout behavior in Host mode.

Recommendation:

- Keep navigation paths stable so module `ui.navigation` metadata can point to the same pages.

### Phase 7 - Add Docker Host module metadata and runtime contract

**Status**: Not Started

Package Project Manager as an installable Docker Host module.

Tasks:

- Add `metadata.json` with `schemaVersion: "0.2"`.
- Use a stable reverse-DNS module id, for example `com.haas.project-manager`.
- Declare one app container using the existing image and port `3000`.
- Add a public endpoint hint for the Host shell app entrypoint.
- Add `ui` metadata with entrypoint path `/` and navigation paths for the main pages.
- Add module storage mapping for `/app/data`.
- Add required Host-provided environment settings such as module id, Host internal origin, service token, auth mode, and secret keys.
- Add a health endpoint that does not require browser cookies.

Recommendation:

- Keep metadata strict. Do not add unsupported fields because schema `0.2` rejects unknown fields.

### Phase 8 - Validate module behavior

**Status**: Not Started

Verify the application as both an app and a Docker Host shell module.

Tasks:

- Run project lint/build checks after each implementation phase.
- Build the production Docker image.
- Install the module metadata through Docker Host developer mode or a local metadata URL.
- Verify Host identity token validation, module audience validation, and rejection of unsigned identity headers.
- Verify assigned Host users can access the app.
- Verify non-admin users cannot access Settings APIs or Settings UI.
- Verify admins can manage roles, projects, project settings, and global LLM settings.
- Verify per-user Azure DevOps PAT behavior.
- Verify legacy JSON import attaches time entries and day-offs to the logged-in Host user.

Recommendation:

- Treat Host identity validation as a release blocker. Do not consider the module migration complete while the app still accepts standalone session cookies or client-provided user ids in Host mode.

## Open Questions

- Question: Should the legacy export include local-only tasks with no Azure DevOps work item id?
  Answer: Current requirement only needs numeric work item ids, time by date, and day-offs.
  Recommendation: Do not include local-only tasks in Phase 0 unless a concrete data-loss case appears before export.

- Question: Should selected LLM model be global or per project?
  Answer: Current direction is global.
  Recommendation: Start global. Add per-project override only if different projects need different model behavior.

- Question: Should Host users automatically receive access to all projects?
  Answer: Host controls module access; Project Manager still needs project-level assignment.
  Recommendation: Keep project membership inside the module and let module admins assign Host users to projects.

- Question: Should the app keep any standalone mode after Docker Host migration?
  Answer: Docker Host will own production authentication.
  Recommendation: Keep only a development-only identity shim if it materially speeds local development; do not ship it as the production path.
