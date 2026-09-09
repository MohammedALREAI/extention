# Running the server from this worktree

## What this is

The project is a Node.js Express server (with a Vite-backed React frontend in dev mode) that also exposes extension and developer API routes.

- Dev entry point: `npm run dev` → `tsx watch server/_core/index.ts`.
- The server auto-picks a port starting at `PORT` (default 3001) and logs `Server running on http://localhost:<port>/`.

## Prerequisites from the main checkout

Copy the environment file from the main checkout. The project's `.env` is gitignored, so a fresh worktree has none.

**Procedure:** copy `.env` (or `.env.local`) from the main checkout into this worktree's root. Do **not** symlink — the copy is the safe, self-contained option. The copied file must keep `DATABASE_URL` and `JWT_SECRET` set; the server logs a clear error on startup when they are missing. For a purely local frontend view you can point `DATABASE_URL` at any reachable Postgres and set `JWT_SECRET` to any non-empty string; those two values are the ones wired into the server at startup.

The project uses `pnpm`. Dependencies are already present in this worktree under `node_modules/.pnpm`; if they are ever missing, run `pnpm install` from the project root. Do not use `npm install` — the lockfile is `pnpm-lock.yaml`.

## Reproducing the artifacts

There are no build artifacts to pre-generate for dev mode; the dev server starts the Vite frontend and the Express API together. The only schema artifact worth noting is the drizzle migration state:

- `drizzle.config.ts` declares `dialect: "postgresql"`.
- The drizzle meta under `drizzle/meta/` currently still says `"dialect": "mysql"` and does **not** contain an `imageUploads` table yet.
- Running `npm run db:push` (which is `drizzle-kit generate && drizzle-kit migrate`) reconciles the dialect from the config and generates/migrates the missing `imageUploads` table. That is expected and desired — the schema already defines `imageUploads`, but it has not been pushed yet.
- If `drizzle-kit generate` complains about the MySQL/Postgres mismatch in the meta, the correct fix is to let it run from `drizzle.config.ts` (the config is the source of truth) and review whatever migration it produces; do not hand-edit the old MySQL snapshots unless drizzle-kit specifically asks for it.

## Running the server

From the project root:

```
npm run dev
```

The server binds to `http://localhost:<port>/` where `<port>` is the first free port at or above `PORT` (default 3001). It prints the chosen port on startup. The Vite dev server is embedded in the same process via middleware, so the React frontend, the API routes, and the `/eval` static directory are all served from one URL.

API routes exposed in dev mode include:

- `POST /api/extension/semantic-evaluate`
- `POST /api/extension/visual-localize`
- `POST /api/v1/moderate/text`
- `POST /api/v1/images/detect`
- `GET /api/v1/images/:name`
- `GET /api/v1/openapi.json`
- tRPC under `/api/trpc/*`

## One-time schema step (when you want the image-upload table)

When you are ready to use `POST /api/v1/images/detect` against a real database:

```
npm run db:push
```

This generates and applies the migration that creates `imageUploads`. Until that is run, the table does not exist in the database even though the schema defines it.

## Known gaps worth knowing about

- The drizzle meta still records a MySQL dialect while `drizzle.config.ts` says postgresql. The mismatch is cosmetic for `db:push` as long as the config is the authority, but it is stale and should be reconciled by the migration run rather than by editing old snapshots by hand.
- There is no delete/destroy path for uploaded images yet. `POST /api/v1/images/detect` stores files under `.data/uploads/` (content-addressed by SHA-256) and records a row in `imageUploads`, but nothing removes old uploads or their rows. That is fine for a local dev preview; it is a real operational gap if this ever runs long enough to accumulate storage.
- The server will start and serve the frontend even with an unusable `DATABASE_URL`, but any route that needs the database will log a warning and return errors rather than crash. That is intentional for local development.

## Windows detached-run gotchas (discovered 2026-09-09)

- PORT=0 trap: the ambient shell exports PORT=0; dotenv (import "dotenv/config") does not override existing env vars, so the server binds to port 0 and is unreachable. When starting detached with Start-Process, set PORT in the parent shell first (e.g. `$env:PORT="3001"` before Start-Process). Symptom: log prints `Server running on http://localhost:0/`.
- Start-Process + Redirect hangs the caller: `(Start-Process npm.cmd ... -PassThru).Id` does not return promptly when output is redirected on this box; the invoking shell blocks ~30s and the command times out even though the process started fine. Do not treat that timeout as failure - check the log file and `Get-NetTCPConnection -State Listen` instead.
- Verify by port, not by pid: `Get-Process -Id <pid>` on the npm.cmd wrapper pid is unreliable on Windows (the wrapper spawns node children). `Get-NetTCPConnection -LocalPort 3001 -State Listen` returning an OwningProcess is the reliable up-signal.
