# Settings Feature

## Overview

Settings provide a central place to configure personal profile preferences and credentials, project administration, Azure DevOps project connectivity, AI provider settings, and database backups.

All assigned module users can open Settings. Non-admin users see only the Profile tab. Docker Host administrators see Profile plus the administrative tabs for projects, releases, backups, and AI provider settings.

## Profile Settings

Profile settings are scoped to the current Host user and active Project Manager project. Each user sets their own default day length for each project before using the time tracker. This value is used when calculating expected hours and comparing planned time against recorded time.

Profile also stores the current user's Azure DevOps Personal Access Token. The profile page shows the active project's Azure DevOps organization and project when that integration is configured, but project-level Azure DevOps settings are managed from the Projects tab by administrators.

JSON import lives in Profile because imported time entries and day-offs are scoped to the current Host user and active project. It imports the supported Project Manager JSON export format, matches time entries by Azure DevOps work item ID, and creates missing work items as Azure DevOps-linked local tasks for the current user.

## Project Management

Project settings support multiple projects in the same module installation. A fresh Project Manager install starts with no project; administrators create projects explicitly from Settings.

The Projects tab lists all projects and provides an Add new project action. Project creation and editing use a dialog with the project name, optional Azure DevOps project URL, and explicit access checkboxes for non-admin users.

Project membership is managed inside Project Manager and is separate from Docker Host module assignment. A Host user must be assigned to the module by Docker Host before Project Manager can show or assign that user in project settings. Docker Host administrators automatically have access to every project and do not need explicit project membership.

Project Manager does not provide separate application administrator role management. Docker Host controls application access and administrative status; Project Manager only stores project membership for non-admin users.

Each Host user can set a personal default project. The default project is selected when there is no valid active project for that user, including after the Docker Host identity changes in the embedded module frame. The active project cookie is scoped with the current Project Manager user id so a project selected by one Host user is not reused for another Host user.

Administrators can delete any project, including the final remaining project. Deleting a project also removes its project-scoped data through database cascades.

## Backups

The Backups tab allows administrators to create database snapshot files and review existing backup files in a table. Each backup row has an actions menu for restoring from that backup or deleting the backup file.

The module creates its SQLite database from the current fresh schema when it starts with empty storage. Legacy local-auth database migrations and local-auth export flows are not part of the Docker Host module.

## Azure DevOps Settings

Azure DevOps project settings are configured from the project create/edit dialog. A Docker Host administrator can connect a Project Manager project to an Azure DevOps organization and project by pasting the Azure DevOps project URL. Each Host user stores their own Personal Access Token in Profile, and users can test the connection with their personal credential.

These settings enable Azure DevOps import, export, refresh, and status synchronization features elsewhere in the app.

The Personal Access Token is a user credential. It is not returned to the browser after storage; API responses expose only `hasPat` for the current user.

## AI Settings

AI settings configure the module-level OpenAI-compatible provider base URL and selected model used for checklist generation. Only Docker Host administrators can view or change these settings.

The provider base URL must be reachable from inside the Docker Host module container. For a provider running on the Docker host machine, use a container-reachable address such as `http://host.docker.internal:1234` instead of `localhost`.

Checklist generation is available only after both the provider base URL and model have been saved. The connection test calls the provider's `/v1/models` endpoint and can be used to discover available model names before saving.

## Typical Workflow

1. Open Settings from the top navigation.
2. Open Projects and create the project explicitly.
3. Configure the project's Azure DevOps URL if the project uses Azure DevOps.
4. Open Profile and set your default day length for the active project.
5. Save a personal Azure DevOps PAT if you use Azure DevOps features.
6. Import migration JSON from Profile if needed.
7. Assign non-admin Host users to the projects they should access.
8. Create a database backup before major operational changes.

## Operational Notes

- Access to Settings requires a valid Docker Host identity. Administrative tabs require Docker Host administrator rights.
- Access to Profile is available to all assigned module users from Settings.
- Keep Azure DevOps tokens current and scoped to the permissions needed by the team.
- Create backups before restoring data or making broad administrative changes.
