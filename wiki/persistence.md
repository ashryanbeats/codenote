# Persistence Strategy (Codenote)

This document describes how Codenote will persist editor content with a fast autosave feel while keeping server writes reasonable.

## Goals

- Autosave that feels instant for single-user editing.
- Crash recovery across refreshes and tab crashes.
- Safe handling of multiple tabs for the same user.
- Coarse snapshots for history without heavy storage.

## Non-goals (for now)

- Real-time collaborative editing (OT/CRDT).
- Multi-file projects.
- Git-backed versioning.

## Summary of the approach

- Client keeps editor state in memory.
- Client writes drafts to IndexedDB for crash recovery.
- Client debounces PATCH requests to the server.
- Server uses optimistic concurrency (revision-based) to detect conflicts.
- Server periodically creates coarse snapshots.

## Data model (proposed)

Projects table:

- `id` (uuid)
- `content` (text)
- `language` (text)
- `revision` (int, increments on successful PATCH)
- `updated_at` (timestamp)

Snapshots table (coarse history):

- `id` (uuid)
- `project_id` (uuid)
- `content` (text)
- `created_at` (timestamp)

## API shape

- `GET /api/projects` -> list
- `POST /api/projects` -> create
- `GET /api/projects/:id` -> fetch latest
- `PATCH /api/projects/:id`
  - body: `{ content, name?, baseRevision }`
  - success: 200 with updated project and new `revision`
  - conflict: 409 with latest project payload

## Save pipeline

1. **In-memory state**

   - Editor state updates on each keystroke.

2. **Local crash recovery (IndexedDB)**

   - Write draft to IndexedDB on change (throttled, e.g. every 250ms).
- Draft record: `{ projectId, name, content, updatedAt, baseRevision }`.
   - On page load, compare server `updated_at` / `revision` to draft.
   - If local draft is newer, show a restore prompt (shadcn Dialog):
     - "Restore local draft" -> populate editor, keep autosave.
     - "Discard" -> delete draft and use server copy.

3. **Server sync (debounced PATCH)**

   - Debounce after idle (e.g. 500ms).
   - Force a flush every N seconds while typing (e.g. 5s).
   - Include `baseRevision` from the last successful server response.

4. **Flush triggers**
   - On blur.
   - Before route changes.
   - Before "Run".
   - Before `pagehide` / `beforeunload` when possible.

## Conflict handling (single user, multiple tabs)

We will use **Level 1 optimistic concurrency**:

- Every PATCH includes `baseRevision`.
- Server rejects stale writes with 409 and the latest project.
- Client behavior on 409:
  - Pause autosave.
  - Prompt to reload or overwrite with local draft.
  - If overwrite, retry PATCH with the new base revision.

This avoids silent data loss without implementing cross-tab locks.

## Snapshot policy

Coarse snapshots are enough for now:

- Create a snapshot on PATCH if the last snapshot is older than a threshold
  (e.g. 30s) or after M changes (e.g. every 10 PATCHes).
- Snapshots store full content; storage is acceptable for small snippets.

## Phased implementation

1. Implement `revision` and `PATCH` behavior with 409 conflicts.
2. Add IndexedDB drafts + restore dialog.
3. Add snapshots table and periodic snapshot creation.

## Notes

- Single-user assumption simplifies conflict resolution.
- If collaboration is needed later, upgrade to a lock/lease or CRDT model.
