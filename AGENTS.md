# HTSW Agent Guide

## Layout

- `language/` — parser, type system, diagnostics, `import.json` loader, NBT, runtime. Where syntax and types are defined. Entrypoint `language/src/index.ts`. **Ask before editing.**
- `ct_module/` — loads HTSW into Minecraft: drives Housing menus, diffs, imports/exports, simulates. Runs on Rhino with `lib: ["ES5", "DOM"]`; anything bundled into ChatTriggers (including emitted `language/` JS) is constrained to that.
- `cli/` — Node CLI (`htsw check [path]`, `htsw run [path]`).
- `editors/` — VS Code, Monaco, shared editor features.
- `docs/`, `examples/` — guide content and example projects. Tests live per package (`language/test`, `ct_module/test`).

**After changing code, assets, metadata, or build setup that ships in `ct_module/`, run `npm run deploy:ct` from the repo root** so `/ct reload` picks it up. It runs the deploy build (typecheck + Vite + Java) and atomically replaces the deployed module; lint + knip run separately via `npm run verify` in `ct_module/` (and automatically during releases). `ct_module/.env` provides `CT_MODULE_DESTINATION` and `HTSW_REPOSITORY_PATH` (used by `/htsw recompile`).

**After changing code, assets, metadata, or build setup that ships in `editors/code/`, run `npm run package` from `editors/code/` and install the generated `.vsix` with `code --install-extension <file>.vsix --force`** so the local VS Code installation uses the change.

## Comments

Default to no comment. Prefer clearer names or refactoring. Comment only verified, non-obvious reasoning that the code cannot express, and write it in plain language that stands on its own.

- Read the `gui-development` skill before touching anything under `ct_module/src/gui/`.

## Working style

- Release notes are user-facing update text. Write the important changes in plain language, avoid internal jargon, and do not publish changelog-only Markdown into the CT updater feed.
- A release is not done until the autoupdater feeds are published. After the version-bump commit, run `python publish.py release --tag <tag> --notes-file <path>` from the repo root. It builds CT, VS Code, and CLI artifacts, deploys all three feeds, and creates or updates the GitHub release. Use `stage`, `deploy`, and `verify` only when performing part of that workflow intentionally.
- If you are not fully sure how Hypixel Housing behaves, ask Callan before implementing, documenting, or relying on that behavior.
- When answering architecture questions or auditing code, judge ownership and call out accidental complexity, duplicate paths, needless abstractions, and misleading names. Prefer one shared path when mechanisms do the same job; keep them separate when their work, timing, or state differs.

## ct_module importer reference

`ct_module/src/housingSync/` owns live-menu reads, diffs, and writes; `importables/` owns per-type import/export; `tasks/` owns async task lifecycle; and `importCache/` owns per-house cache state. Procedures and coverage change often, so read the canonical registries and implementations below.

**Where the current behavior is defined:**

- Importable coverage — `importables/imports.ts` for imports, `HOUSE_READERS` for live reads, `HOUSE_EXPORT_TYPES` for name-based exports, and `gui/left-panel/houses/contentTypes.ts` for GUI-only behavior.
- Read/write + child-list coverage per action/condition — `ACTION_IO` / `CONDITION_IO`, via `getActionIo` / `getConditionIo`.
- Trust-mode conflict detection runs during action-list scanning, and `runImportSession` resolves conflicts after scanning, hydration, and planning finish but before application begins; v1 scan hashes cover only action types plus child-list type structure, and Cancel must leave `house.lock.json` untouched.
- New-export targets are chosen in `editors/common/src/project/exportTargets.ts`: existing declaration, reachable sticky sub-target, section folder, then base file. Re-exports ignore the sticky sub-target.

**Structure rules:**

- Describe importer work as scanning → hydration → planning → application. Hydration may be skipped when scanning or trusted state already provides complete knowledge; planning is in-memory. Always name the stages directly instead of grouping or numbering them.
- `imports.ts` only dispatches. Keep a type's import, export, and shared logic under `importables/<type>/`; cross-type export helpers under their owning importable; and task state and cancellation under `tasks/`. Do not create per-caller support lists when the canonical registries own the choice.
- Start every import, export, and deep read with `runHousingSyncTask`, and reuse the shared live-menu readers.
- List/browser openers may reuse the current base menu through `isAtMenuTitle`; item editors may only do so when the title uniquely identifies the item.
- Adding an action/condition type: update `housingSync/fields/actionMappings.ts` / `conditionMappings.ts` first — they drive parsing, list-item observation, and diff cost.

<!-- htsw:guides START -->
## HTSW + Housing docs

These docs are managed by `htsw-docs sync`.

Before working on any HTSW or Housing task, read the relevant documentation
linked below and use it as the source of truth.

Use the Housing concept docs for game behavior, the HTSW reference for syntax
and formats, and the agent workflows for validation and live imports.

### Overview

Hypixel Housing is a gamemode on the Hypixel Network. Each player is given a
 plot to build on, expand, create games, and more. Almost anything is possible!
 Player's can also visit other people's houses and see what creations they've
 made.

The basis of Hypixel Housing are player houses. Players can create houses and
 open them to the public for others to join.

Hypixel Housing allows clients of both 1.8.9 and 1.21 to join. Internally, the
 servers run a heavily modified version of the 1.8.9 Minecraft server software.
 This means that most features of newer Minecraft versions are inaccessible in
 Housing.

HTSW is a near zero-abstraction framework and collection of formats for
 representing Housing entities as text. It consists of two main formats:
 `import.json` and HTSL.

HTSL (Housing Text Scripting Language) is the markup language used by HTSW to
 represent Housing actions in a textual format.

### Documentation

#### Housing concepts

- Actions and action containers: `.htsw/housing/actions.md`
- Conditions: `.htsw/housing/conditions.md`
- Functions: `.htsw/housing/functions.md`
- Houses: `.htsw/housing/house.md`
- Regions: `.htsw/housing/regions.md`
- Systems: `.htsw/housing/systems.md`
- Variables: `.htsw/housing/variables.md`

#### HTSW reference

- Importables: `.htsw/htsw/importables.md`
- Tooling and CLI: `.htsw/htsw/tooling.md`
- Basic syntax: `.htsw/htsw/htsl/basic-syntax.md`
- Actions: `.htsw/htsw/htsl/actions.md`
- Conditions: `.htsw/htsw/htsl/conditions.md`
- Vanilla item names: `.htsw/htsw/vanilla-item-names.md`

#### Agent workflows

Read these workflows before writing code.
- Project structure and validation: `.htsw/agents/htsw-project-structure.md`
- Live import queue: `.htsw/agents/htsw-import-queue.md`
- Writing import-efficient HTSL: `.htsw/agents/writing-import-efficient-htsl.md`
- Common Housing patterns: `.htsw/agents/list-of-common-patterns.md`

#### Essential commands

- Validate the entry `import.json` or `*.import.json` with `htsw check`.
- Use `htsw run` for local simulation.
- Follow the live import queue guide when in-game tools are available.
<!-- htsw:guides END -->
