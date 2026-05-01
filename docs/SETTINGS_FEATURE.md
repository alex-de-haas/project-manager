# Settings Feature

## Overview

Settings provide a central place to configure application behavior, project administration, Azure DevOps connectivity, and database maintenance.

## General Settings

General settings control defaults used throughout the app. The current working-day length setting is used when calculating expected hours and comparing planned time against recorded time.

## Azure DevOps Settings

Azure DevOps settings let a project connect to an Azure DevOps organization and project with a Personal Access Token. Users can test the connection before saving settings, which helps catch incorrect organization names, project names, expired tokens, or insufficient permissions.

These settings enable Azure DevOps import, export, refresh, and status synchronization features elsewhere in the app.

The Personal Access Token is a project-level secret. Project owners and administrators can manage it, and the saved token is not displayed back to the browser after it is stored.

## User Management

The Settings area supports managing users who can access the app. Administrators can invite users, review existing users, and support account setup through invitation links.

## Project Management

Project settings support multiple projects in the same app installation. Users can belong to projects, switch between projects, and keep project-specific work separated.

## Database Maintenance

Database maintenance tools allow administrators to create backups, view existing backups, delete backups that are no longer needed, and restore the application from a selected backup.

Calendar imports can fetch public HTTP or HTTPS calendar URLs. The app blocks private, reserved, and loopback network targets for calendar imports. LM Studio connectivity is intended for loopback endpoints on the server running Project Manager.

## Typical Workflow

1. Open Settings from the sidebar.
2. Review general app defaults.
3. Configure Azure DevOps if the project uses it.
4. Manage users and project membership.
5. Use database backup tools before major operational changes.

## Operational Notes

- Configure a strong `AUTH_SECRET` for production deployments. Production authentication fails closed when it is missing.
- Keep Azure DevOps tokens current and scoped to the permissions needed by the team.
- Create backups before restoring data or making broad administrative changes.
