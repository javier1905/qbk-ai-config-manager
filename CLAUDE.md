# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (run without building)
npm run dev

# Build TypeScript to dist/
npm run build

# Run built CLI
npm start
# or
node dist/index.js
```

No test suite is configured.

## Architecture

**qbk-ia** is an interactive terminal UI (no CLI flags) for managing AI configuration files (`.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`) across multiple Git repositories and branches.

The tool runs in the user's working directory (`cwd = process.cwd()`), managing those AI files locally and syncing them to/from a dedicated remote Git repository.

### Core concepts

- **Repository**: A remote Git repo used as a storage backend for AI config files. Multiple repos can be configured.
- **Profile**: A Git branch within a repo. Each branch holds a different set of AI config files.
- **Version**: A specific commit hash (7-char short) within a profile. Tracked as `currentVersion` in config.
- **Managed files**: `AI_FILES = ['.agents', '.claude', 'AGENTS.md', 'CLAUDE.md']` — these are copied between the temp clone and the user's `cwd`.

### Data flow

1. Config is stored at `cwd/.ai-config.json` (the `AiConfig` type in `src/config.ts`).
2. All Git operations use a temp directory `cwd/.qbk-temp/` cloned via `simple-git`.
3. When switching repos/profiles/versions, the tool clones the remote, copies the managed files to `cwd`, then deletes the temp dir.
4. When publishing, local files are copied into the temp clone, committed, and pushed.

### Key files

| File | Role |
|------|------|
| `src/index.ts` | Entry point; renders header UI, builds menu choices, runs the main interactive loop |
| `src/config.ts` | `AiConfig`/`RepoEntry` types, read/write config, format migration from old single-repo format |
| `src/git.ts` | `GitManager` class — all Git operations (clone, branch, commit, push, diff, apply) |
| `src/utils.ts` | Logging helpers (`logSuccess`, `logError`, etc.), `qbkInput`/`qbkSelect`/`qbkConfirm` wrappers with Escape key support, file utilities |
| `src/commands/shared.ts` | `handlePendingChanges()` — reusable save/discard flow used across profile, repo, and version switching |
| `src/commands/repo.ts` | Add repo, switch repo |
| `src/commands/profile.ts` | Switch/add/remove profile (branch) |
| `src/commands/version.ts` | Switch version (commit checkout) |
| `src/commands/publish.ts` | Commit and push local changes |

### Interactive UI conventions

- All prompts use `qbkInput`, `qbkSelect`, `qbkConfirm` from `utils.ts` — wrappers around `@inquirer/prompts` that add Escape key support via `AbortController`.
- Commands return `boolean`: `true` means "cancelled/go back to menu", `false` means "completed (show press-Enter)".
- Escape key on the main menu exits the process; Escape within a command returns to the main menu.

### Module system

The project uses `"type": "module"` (ESM). All local imports must use `.js` extension (e.g., `import { ... } from './config.js'`). TypeScript is compiled to `dist/` with `NodeNext` module resolution.
