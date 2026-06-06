# tasks

Server-side task manager storage and routes for OpenChamber workspaces.

## Ownership

- `runtime.js`: JSON persistence, migration/bootstrap of Default workspace, workspace CRUD, task CRUD, sticky task status timestamps.
- `routes.js`: Express route registration and SSE fanout over `/api/openchamber/events`.

## Storage

- `workspaces.json`: workspace registry.
- `workspace-tasks/<workspaceId>.json`: task list scoped to one workspace.

## Rules

- Workspaces are authoritative for project membership.
- Missing projects from settings are auto-attached to `Default` on read.
- `startedAt` is sticky after first transition to `in_progress`.
- `completedAt` is set on transition to `done` and cleared on reopen.
