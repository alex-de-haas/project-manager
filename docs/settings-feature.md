# Settings Feature

## Overview

Settings provide a central place to configure application behavior, module roles, project administration, Azure DevOps project connectivity, AI provider settings, and database maintenance.

## General Settings

General settings control defaults used throughout the app. The current working-day length setting is used when calculating expected hours and comparing planned time against recorded time.

## Module Roles

Project Manager runs as a Docker Host module, so Docker Host owns the user directory, authentication, and module assignment. The Settings area uses the Docker Host scoped directory to show Host users assigned to this module, including assigned users who have not opened Project Manager yet. If the scoped directory is unavailable, Settings falls back to Host users already known to this module.

Module administrators can grant or remove Project Manager administrator rights for assigned Host users. Module roles are stored against the stable Docker Host user id while local integer user ids remain internal join keys for project membership and work data.

Local user creation, invitations, password changes, and logout are not part of the application. Users are added or removed from the module through Docker Host assignment.

## Project Management

Project settings support multiple projects in the same module installation. Users can belong to projects, switch between projects, and keep project-specific work separated.

Project membership is managed inside Project Manager and is separate from Docker Host module assignment. A Host user must be assigned to the module by Docker Host before Project Manager can show or assign that user in project settings.

## Database Maintenance

Database maintenance tools allow administrators to import Project Manager JSON migration files, create backups, view existing backups, delete backups that are no longer needed, and restore the application from a selected backup.

The module creates its SQLite database from the current fresh schema when it starts with empty storage. Legacy local-auth database migrations and local-auth export flows are not part of the Docker Host module.

JSON import remains available for migration into a fresh module. It imports the supported Project Manager JSON export format into the current Docker Host user and active project. Time entries are matched by Azure DevOps work item ID, and missing work items are created as Azure DevOps-linked local tasks.

## Azure DevOps Settings

Azure DevOps settings let a module administrator connect a Project Manager project to an Azure DevOps organization and project. Each Host user stores their own Personal Access Token in Profile, and users can test the connection with their personal credential.

These settings enable Azure DevOps import, export, refresh, and status synchronization features elsewhere in the app.

The Personal Access Token is a user credential. It is not returned to the browser after storage; API responses expose only `hasPat` for the current user.

## AI Settings

AI settings configure the module-level OpenAI-compatible provider base URL and selected model used for checklist generation. Only module administrators can view or change these settings.

The provider base URL must be reachable from inside the Docker Host module container. For a provider running on the Docker host machine, use a container-reachable address such as `http://host.docker.internal:1234` instead of `localhost`.

Checklist generation is available only after both the provider base URL and model have been saved. The connection test calls the provider's `/v1/models` endpoint and can be used to discover available model names before saving.

## Typical Workflow

1. Open Settings from the sidebar.
2. Review general app defaults.
3. Configure Azure DevOps if the project uses it.
4. Open Profile and save a personal Azure DevOps PAT if you use Azure DevOps features.
5. Review assigned Docker Host users and module administrator roles.
6. Manage projects and project membership.
7. Import migration JSON if needed.
8. Create a database backup before major operational changes.

## Operational Notes

- Access to Settings requires a valid Docker Host identity and Project Manager administrator rights.
- Access to Profile requires a valid Docker Host identity and is available to all assigned module users.
- Keep Azure DevOps tokens current and scoped to the permissions needed by the team.
- Create backups before restoring data or making broad administrative changes.
