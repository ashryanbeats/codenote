# AGENTS

This repo is a minimal full-stack scaffold for Codenote. Use this file as a quick guide to the stack and where pieces live.

## Stack overview

- Runtime: Deno (tasks in `deno.json`).
- Frontend: React + React Router v7 data APIs, built with Vite.
- UI: Tailwind CSS + shadcn/ui (slate theme).
- Editor: CodeMirror v6 via a React wrapper.
- Backend: Deno `serve` with a small REST API and static file serving.
- Database: Postgres via Drizzle ORM + drizzle-kit migrations.
- Persistence: Debounced autosave with IndexedDB drafts and coarse snapshots.

## Key paths

- Frontend entry: `src/main.tsx`
- Routes and data loaders/actions: `src/routes.tsx`
- App shell: `src/root.tsx`
- Code editor wrapper: `src/components/code-editor.tsx`
- Draft persistence helpers: `src/lib/drafts.ts`
- UI components: `src/components/ui/`
- Global styles: `src/styles/globals.css`
- Tailwind config: `tailwind.config.ts`
- PostCSS config: `postcss.config.cjs`
- shadcn config: `components.json`
- API server: `server/server.ts`
- API handlers: `server/api.ts`
- DB client: `db/client.ts`
- DB schema: `db/schema.ts`
- Migrations: `db/migrations/`
- Persistence strategy: `wiki/persistence.md`
- Vite config: `vite.config.ts`
- Drizzle config: `drizzle.config.ts`

## Common tasks (Deno)

- Dev UI: `deno task dev:web`
- Dev API: `deno task dev:api`
- Build UI: `deno task build`
- Start API + static UI: `deno task start`
- Generate migrations: `deno task db:generate`
- Apply migrations: `deno task db:migrate`

## Environment

- `PORT` is required for the API server.
- `DATABASE_URL` is required for project persistence and migrations.
