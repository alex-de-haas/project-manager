# Settings Feature

## Overview

Settings configure personal profile preferences and credentials, project administration, releases, AI provider settings, and database backups.

All assigned app users can open Settings. Non-admin users see only the Profile tab. Hosty administrators see Profile plus administrative tabs for projects, releases, backups, and AI provider settings. Profile and Releases are disabled until an active project exists because both edit project-scoped data.

## Profile Settings

Profile settings are scoped to the current Hosty user and active Project Manager project where project context is required. Each user has a default day length for each project. Project Manager starts missing profile schedules from the app-level `PROJECT_MANAGER_DEFAULT_DAY_LENGTH` environment value, which defaults to 8 hours. When no project exists or no project is selected, the Profile tab does not request project-scoped settings.

Profile also shows the external account link for the active project. Azure DevOps currently links the current Project Manager user to Azure DevOps with a project-scoped Personal Access Token. Saving the link resolves the provider identity represented by that token, stores the technical identity fields for assignment mapping by project, provider, and user, and shows the resolved Azure DevOps name and email so the user can verify which external account will be used for synchronization. The local user display name remains based on Hosty identity.

JSON import lives in Profile because imported time entries and days off are user-owned data. Time entries require an active project and are matched to work items. Days off are global per user and do not belong to a project.

## Project Management

Project settings support multiple projects in the same app installation. A fresh Project Manager install starts with no project; administrators create projects explicitly from Settings.

Project creation and editing use a dialog with:

- Project name.
- Optional project description.
- Integration provider selection: none or Azure DevOps.
- Azure DevOps project URL when Azure DevOps is selected.
- Explicit access checkboxes for non-admin users.

Project membership is managed inside Project Manager and is separate from Hosty app assignment. A Hosty user must be assigned to the app by Hosty before Project Manager can show or assign that user in project settings. Hosty administrators automatically have access to every project and do not need explicit project membership.

Project Manager does not provide separate application administrator role management. Hosty controls application access and administrative status; Project Manager only stores project membership for non-admin users.

Each Hosty user can set a personal default project. The default project is selected when there is no valid active project for that user, including after the Hosty identity changes in the embedded app frame. Explicit requests for inaccessible projects return clear project-context errors instead of silently falling back.

Administrators can delete any project, including the final remaining project. Deleting a project removes project-scoped data through database cascades. Global days off are not deleted with a project.

## Integration Settings

External integrations are optional project-level settings. A project can have no provider.

Azure DevOps integration is configured from the project dialog. Each Host user links their external account from Profile for the active project. Azure DevOps uses a project-scoped Personal Access Token for that link today; future providers can use their own account-linking method.

Administrators can disable provider sync for a project. Existing provider links are preserved as historical metadata and marked sync-disabled. Project Manager blocks switching to a different provider while provider-linked work items still exist.

## Release Management

The Releases tab lists releases for the active project as compact reorderable cards. Administrators create and edit releases from dialogs. Release items link releases to canonical Project Manager work items and store release-specific order and notes. When no project exists or no project is selected, the Releases tab is disabled and Project Manager does not request release data.

## Backups

The Backups tab allows administrators to create database snapshot files and review existing backup files in a table. New automatic backup files use the `project_manager_backup_YYYYMMDD_HHMMSS.db` naming pattern. Each backup row has actions for restoring from that backup or deleting the backup file.

The app creates `project_manager.db` from the current fresh schema when it starts with empty storage. The legacy `time_tracker.db` database name is not reused for the new domain model.

## AI Settings

AI settings configure the app-level OpenAI-compatible provider base URL and selected model used for checklist generation. Only Hosty administrators can view or change these settings.

The provider base URL must be reachable from inside the app container. For a provider running on the Docker host machine, use a container-reachable address such as `http://host.docker.internal:1234` instead of `localhost`.

Checklist generation is available only after both the provider base URL and model have been saved. The connection test calls the provider's `/v1/models` endpoint and can be used to discover available model names before saving.

## Typical Workflow

1. Open Settings from the top navigation.
2. Open Projects and create a project.
3. Select an integration provider only if the project needs external sync.
4. Configure the Azure DevOps URL if Azure DevOps is selected.
5. Assign non-admin Host users to the projects they should access.
6. Open Profile to change the app default work schedule for the active project.
7. Link your external account in Profile if you use external provider features.
8. Create a database backup before major operational changes.

## Operational Notes

- Access to Settings requires a valid Hosty app identity.
- Administrative tabs require Hosty administrator rights.
- Profile is available to all assigned app users.
- Keep Azure DevOps tokens current, project-specific, and scoped to the permissions needed by the team.
- Create backups before restoring data or making broad administrative changes.
