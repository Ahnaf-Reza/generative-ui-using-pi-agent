# Ubuntu setup (Bun + Elysia + Vite + TanStack Router)

This doc is intentionally minimal: keep only documentation + two code folders:

- `frontend/` (Vite + React + TypeScript + TanStack Router)
- `backend/` (Elysia API + filesystem + execution engine + Pi ACP bridge)

This app runs directly on the user’s machine (no sandbox; no Docker required).

---

## What you are building

High-level flow (simple, realistic, and shippable):

1) User types a natural-language request in the frontend.
2) Frontend calls the backend (`POST /api/agent`).
3) Backend calls Pi via ACP (Agent Communication Protocol) to get:
  - proposed operations (exec/system + optional shell/js/sqlite/python + filesystem actions)
  - a UI schema update (JSON)
4) Backend executes the operations and streams progress.
5) Backend returns:
   - updated file tree + logs
   - updated UI schema
6) Frontend renders the UI from the schema.

Important constraint: the browser talks only to the backend. Pi is never called directly from the frontend.

---

## Tech stack (must match)

- Runtime + package manager: Bun
- Backend: Elysia
- Frontend: Vite + TanStack Router (fully dynamic, no SSR)
- Tests: Vitest
- Lint/format: oxlint + oxfmt (not ESLint/Prettier)
- Optional DB: drizzle-orm + `bun:sqlite`
- Optional cache: `bun:redis`

Repo tooling note (“Vite+”): this means we lean on the Vite ecosystem for repo workflows (Vite + Vitest) and use the oxc toolchain (oxlint/oxfmt) instead of ESLint/Prettier.

Notes on inspiration (we implement similar ideas in-repo; do not use these libs directly):

- https://github.com/vercel-labs/json-render (schema-driven UI rendering)
- https://github.com/vercel-labs/just-bash (structured execution + command registry patterns)

---

## 1) Prereqs on Ubuntu

### Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL
bun --version
```

### Useful system packages (optional but common)

```bash
sudo apt update
sudo apt install -y git ca-certificates
```

If you plan to ship “utility packs” (archives/media/pdf/etc), install those separately as-needed.

### Pi (required for ACP bridge)

Pi must already be installed and authenticated on the machine.

Minimum check:

```bash
pi --version
```

If Pi exposes ACP over a local socket/port, capture it as config (example env vars below). If your Pi install uses a different command/config, update the env var names to match.

---

## 2) Create repo folders

Run these from the repo root:

```bash
mkdir -p frontend backend workspace
```

Expected structure:

```text
docs/
frontend/
backend/
workspace/
```

Convention: keep all “agent output” changes under `workspace/`.

---

## 3) Frontend: Vite + React + TanStack Router

Scaffold:

```bash
bun create vite frontend --template react-ts
cd frontend
bun install
```

Add TanStack Router:

```bash
bun add @tanstack/react-router
```

Dev scripts:

```bash
bun run dev
```

Frontend responsibilities (keep it thin):

- Render file tree
- Render schema-driven UI from backend responses
- Send user prompts to the backend
- Never executes commands locally

---

## 4) Backend: Elysia + structured workspace actions

Scaffold:

```bash
cd backend
bun init -y
bun add elysia
```

Recommended dev command:

```bash
bun --hot src/index.ts
```

Backend responsibilities:

- Owns the filesystem (all reads/writes)
- Maintains a workspace root (`workspace/`) as the default working directory
- Executes commands through a structured runner (program + args)
- Talks to Pi via ACP and converts Pi output into:
  - a list of proposed operations
  - a JSON UI schema for the frontend

---

## Week 1 features

- Repo scaffolding exists and runs: `frontend/`, `backend/`, `workspace/`.
- Frontend (TanStack Router): a single page with a prompt box + run button + logs panel + file tree panel.
- Backend (Elysia): `GET /health`.
- Backend: `POST /api/agent` accepts `{ "prompt": string }` and returns a single JSON response containing:
  - `ui` (initial UI spec snapshot)
  - `fileTree` (workspace tree)
  - `logs` (array of log lines)
- Workspace I/O: backend reads/writes only under `workspace/` and always reports the updated tree.
- Execution engine MVP: supports `executor: "system"` with `program + args[]` and runs commands in `cwd: "workspace"`.
- Pi ACP bridge: backend can call Pi via ACP (or a stub during bring-up) and translate the response into `ops + ui`.

## Week 2 features

- Streaming: `POST /api/agent` supports SSE (`text/event-stream`) and streams incremental updates.
- Events: `spec` (full snapshot), `specPatch` (JSON Patch), `log`, `fileTree`.
- UI catalog/registry: only allow known component `type`s and known actions.
- Actions: `POST /api/action` handles UI actions and returns updated `ui` or `specPatch`.
- State + watchers (minimal): state updates and watcher-triggered actions on change.
- Execution engine upgrade: add `shell` (when required), `js` (in-process via Bun), optional `sqlite` via `bun:sqlite`, optional `python`, and explicit `pipeline` ops.
- Optional persistence/caching only if needed: Drizzle + `bun:sqlite`, `bun:redis`.
- UX rule: no “approval” prompts; run immediately and stream results.

## Vitest

Install (per folder):

```bash
cd backend
bun add -d vitest
cd ../frontend
bun add -d vitest
```

Run:

```bash
# from backend/
bun run test

# from frontend/
bun run test
```

Suggested test coverage:

- Backend: `GET /health` ok.
- Backend: `POST /api/agent` returns `{ ui, fileTree, logs }` (Week 1).
- Backend: SSE formatting and event ordering (Week 2).
- Backend: JSON Patch apply to `ui`.
- Backend: workspace tree generation after file writes.
- Backend: execution runner runs `system` ops and captures `stdout/stderr/exitCode`.
- Frontend: renders from `ui` spec and maps `type` → component.
- Frontend: action dispatch payload shape.
- Frontend: SSE client consumes events and applies `specPatch`.
