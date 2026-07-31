# HTSW Agent Guide

HTSW = "HTSL but we don't take Ls" — a refined HTSL (Housing Text Scripting Language) that expresses Hypixel Housing GUI programming as text.

## How to read this guide

This guide says **what each part is for and the rules it must keep**. Do not copy details an agent can learn just by reading the code; those go stale. When you add to this file, write only:

- **What an area is for**
- **A reason the code can't tell you on its own**

## Layout

- `language/` — parser, type system, diagnostics, `import.json` loader, NBT, runtime. Where syntax and types are defined. Entrypoint `language/src/index.ts`. **Ask before editing.**
- `ct_module/` — loads HTSW into Minecraft: drives Housing menus, diffs, imports/exports, simulates. Runs on Rhino with `lib: ["ES5", "DOM"]`; anything bundled into ChatTriggers (including emitted `language/` JS) is constrained to that.
- `cli/` — Node CLI (`htsw check [path]`, `htsw run [path]`).
- `editors/` — VS Code, Monaco, shared editor features.
- `docs/`, `examples/` — guide content and example projects. Tests live per package (`language/test`, `ct_module/test`).

| area            | build           | test       | notes                                                         |
| --------------- | --------------- | ---------- | ------------------------------------------------------------- |
| `language/`     | `npm run build` | `npm test` | `lib: es2022`                                                 |
| `cli/`          | `npm run build` | —          |                                                               |
| `editors/code/` | `npm run build` | —          |                                                               |
| `ct_module/`    | `npm run build` | `npm test` | Java helper via `build:java`; deploy with `npm run deploy:ct` |

**After changing code, assets, metadata, or build setup that ships in `ct_module/`, run `npm run deploy:ct` from the repo root** so `/ct reload` picks it up. It runs the deploy build (typecheck + Vite + Java) and atomically replaces the deployed module; lint + knip run separately via `npm run verify` in `ct_module/` (and automatically during releases). `ct_module/.env` provides `CT_MODULE_DESTINATION` and `HTSW_REPOSITORY_PATH` (used by `/htsw recompile`).

**After changing code, assets, metadata, or build setup that ships in `editors/code/`, run `npm run package` from `editors/code/` and install the generated `.vsix` with `code --install-extension <file>.vsix --force`** so the local VS Code installation uses the change.

## Comments

**Default to NO comment.** AI-written comments tend to (a) restate what well-named code already says and (b) phrase guessed reasoning as established fact. The second is the worse failure: a confident-sounding "this works because X" misleads the next reader into trusting incorrect rationale and leaving real bugs in place. A wrong comment is worse than no comment.

Before writing a comment: **did you verify this, or are you narrating your mental model?** If you didn't verify it (an assumed MC/Rhino quirk, a guessed "this is needed because…"), leave it out. If the reader can recover the WHY from the code, leave it out.

**Do not write:**

- Restatements of the next line — `// increment i`, `// dark slate, primary panel bg` next to `COLOR_PANEL`.
- Narration of removed code or past bugs — `// previously this re-called scheduleReparse()…`, `// fix for ticket X`. Git has the diff; PRs have the context. Comments rot, history doesn't.
- Task / PR breadcrumbs — `// added for the export flow`, `// used by the importer`. Renames silently make these wrong.
- Section dividers inside functions — `// --- Double-click detection ---`. The function is too long; extract a helper instead.
- Speculative MC/CT/Rhino internals — `// works because MC reads X during runTick`, unless you've actually traced it. If you can't reproduce the claim on demand, don't assert it in prose.
- TODOs without a tracked issue and a concrete next step.
- Docstrings that restate the type signature or list every parameter.

**When a comment earns its place, make it stand on its own.** Write it for a reader who doesn't yet know the codebase's vocabulary. Don't lean on an undefined internal term or a bare local variable name — say what the thing costs or does and why it matters, in plain words. Plain sentences, not dense shorthand.

**Fix the name before reaching for a comment.** When a comment exists only to decode an under-named thing, rename the thing instead. A clear name removes the need for the comment; keep it only if a real _why_ remains after renaming.

## Code style

- Prefer refactoring over explanatory comments.
- If code is needlessly hard to understand, improve it.
- If a state object has fields that many files update by hand, improve it. Put the repeated updates behind functions on the state owner instead. For example, callers should say `state.completeEdit(op)` instead of manually doing `completedOps++`, progress emit, snapshot refresh, and event emit in every phase. The goal is fewer files needing to know the bookkeeping rules.
- Read the `gui-development` skill before touching anything under `ct_module/src/gui/`.

## Working style

- Short progress updates before edits, builds, installs, and when findings change the plan.
- Be direct about what changed and why. No vague reassurance.
- Release notes are user-facing update text. Write the important changes in plain language, avoid internal jargon, and do not publish changelog-only Markdown into the CT updater feed.
- A release is not done until the autoupdater feeds are published. After the version-bump commit, run `python publish.py release --tag <tag> --notes-file <path>` from the repo root. It builds CT, VS Code, and CLI artifacts, deploys all three feeds, and creates or updates the GitHub release. Use `stage`, `deploy`, and `verify` only when performing part of that workflow intentionally.
- If you are not fully sure how Hypixel Housing behaves, ask Callan before implementing, documenting, or relying on that behavior.
- When answering an architecture or code question, don't only describe current behavior — judge it. Say whether a responsibility belongs where it is, and what to change if the design is accidental, overbuilt, or misleading.
- When auditing code, look for two paths doing the same job, abstractions that don't earn their place, and names that hide who owns what. If two mechanisms feed the same caller, first look for one shared path. Keep them separate when they do different jobs, run at different times, or need different state — and make that difference clear in the design.

## ct_module importer reference

Split across `ct_module/src/housingSync/` (read/diff/write live menus), `importables/` (per-type import/export and importable-owned export helpers), `tasks/` (async task/cancel plumbing), and `importCache/` (per-house cache). Reads and writes real Housing menus through async tasks, not callbacks. The procedures and coverage shift every PR — read the code for those; the rules below are what the code can't tell you.

**Where the current behavior is defined:**

- Which importable types are wired — the switch in `importables/imports.ts` for import; `HOUSE_READERS` in `importables/houseReaders.ts` for live-house read/deep-read coverage; and `HOUSE_EXPORT_TYPES` in `importables/houseExportTypes.ts` for name-based exports. `gui/left-panel/houses/contentTypes.ts` adds GUI-only behavior.
- Per-type import procedure — that type's `importables/<type>/import.ts`. Per-type house reads usually live in `importables/<type>/readHouse<Type>.ts` and use `makeReadHouse` from `importables/readHouse.ts`; `importables/read.ts` owns the shared loop. NPCs adapt their position-keyed export flow to the same `ReadFn` interface.
- Read/write + child-list coverage per action/condition — `ACTION_IO` / `CONDITION_IO`, via `getActionIo` / `getConditionIo`.
- Trust-mode conflict detection runs during action-list scanning, and `runImportSession` resolves conflicts after scanning, hydration, and planning finish but before application begins; v1 scan hashes cover only action types plus child-list type structure, and Cancel must leave `house.lock.json` untouched.
- Which import.json a NEW export lands in — `importJsonTargetForSectionEntry` (and the per-type `htslTargetFor*`/`snbtTargetForItemExport`) in `editors/common/src/project/exportTargets.ts`: an existing declaration wins, else the user's sticky sub-target (`gui/state/newExportTarget.ts`, set in the Houses "Change" picker) when it's reachable in the include tree, else the section folder, else the base file. Re-exports of already-declared importables ignore the sub-target. The choice threads in via `ReadOptions.newExportTargetImportJson` (set in `gui/export/taskController.ts:startExport`).
- Simulator coverage (`ct_module/src/simulator/`, separate from import) — `createActionBehaviors()` / `createConditionBehaviors()`.

**Structure rules:**

- Describe importer work as scanning → hydration → planning → application. Hydration may be skipped when scanning or trusted state already provides complete knowledge; planning is in-memory. Always name the stages directly instead of grouping or numbering them.
- `imports.ts` only dispatches — never inline per-type bodies. Live-house readers use the shared `ReadFn` interface; don't add separate per-caller lists of supported types when `HOUSE_READERS` or `HOUSE_EXPORT_TYPES` already owns that choice.
- A type's import + export live together under `importables/<type>/`; logic shared between the two directions stays in that folder. Importable-owned export helpers that cut across types live under the owning importable folder, such as `importables/items/`. Task state and cancellation helpers live under `tasks/`.
- Start every import, export, and deep read with `housingSync/taskRunner.ts:runHousingSyncTask` so one place starts and cleans up Housing menu work.
- Import, export, and deep-read reuse the same live-menu readers (`readActionList`, `readConditionList`, `parse*ListItem`) — never duplicate that read logic.
- A list/browser opener that walks `/hmenu` -> submenu (e.g. `openNpcBrowser`, `openGroupsList`) guards on `housingSync/menus/currentMenu.ts:isAtMenuTitle` and early-returns when already at that menu, so the list phase -> per-item phase doesn't re-run the whole `/hmenu` round-trip. It compares the _base_ title (pagination's `(page/total)` prefix stripped), which is safe because the paginated navigation reads the live page from the title and self-corrects from any page. Only guard _list_ openers this way — never early-return into a specific item's editor unless the menu title uniquely identifies that item (NPCs are position-keyed with non-unique names; the group edit menu title doesn't name the group).
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

- Actions and action containers: `.htsw/housing/concepts/actions.md`
- Conditions: `.htsw/housing/concepts/conditions.md`
- Functions: `.htsw/housing/concepts/functions.md`
- Houses: `.htsw/housing/concepts/house.md`
- Regions: `.htsw/housing/concepts/regions.md`
- Systems: `.htsw/housing/concepts/systems.md`
- Variables: `.htsw/housing/concepts/variables.md`

#### HTSW reference

- Importables: `.htsw/htsw/importables.md`
- Tooling and CLI: `.htsw/htsw/tooling.md`
- Basic syntax: `.htsw/htsw/htsl/basic-syntax.md`
- Actions: `.htsw/htsw/htsl/actions.md`
- Conditions: `.htsw/htsw/htsl/conditions.md`

#### Agent workflows

- Project structure and validation: `.htsw/agents/htsw-project-structure.md`
- Live import queue: `.htsw/agents/htsw-import-queue.md`
- Common Housing patterns: `.htsw/agents/list-of-common-patterns.md`

#### Essential commands

- Validate the entry `import.json` or `*.import.json` with `htsw check`.
- Use `htsw run` for local simulation.
- Follow the live import queue guide when in-game tools are available.
<!-- htsw:guides END -->
