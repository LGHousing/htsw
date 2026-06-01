# HTSW Agent Guide

HTSW = "HTSL but we don't take Ls" — a refined HTSL (Housing Text Scripting Language) that expresses Hypixel Housing GUI programming as text.

## How to read this guide

This guide records **responsibilities and invariants only**. Anything you can learn by reading the code is deliberately left out so it can't go stale. When you add to this file, write one of three things and nothing else:

- **What an area is for**
- **Where the source of truth lives**
- **Non-recoverable WHY**

## Layout

- `language/` — parser, type system, diagnostics, `import.json` loader, NBT, runtime. Source of truth for syntax and types. Entrypoint `language/src/index.ts`. **Ask before editing.**
- `ct_module/` — loads HTSW into Minecraft: drives Housing menus, diffs, imports/exports, simulates. Runs on Rhino with `lib: ["ES5", "DOM"]`; anything bundled into ChatTriggers (including emitted `language/` JS) is constrained to that.
- `cli/` — Node CLI (`htsw check [path]`, `htsw run [path]`).
- `editors/` — VS Code, Monaco, shared editor features.
- `docs/`, `examples/`, `test/` — content and language tests.

| area | build | test | notes |
|---|---|---|---|
| `language/` | `npm run build` | `npm test` | `lib: es2022` |
| `cli/` | `npm run build` | — | |
| `ct_module/` | `npm run build` | `npm test` | Java helper via `build:java`; deploy with `python install.py` |

**After any `ct_module/` change, run `python install.py` from `ct_module/`** so `/ct reload` picks it up. It runs the full build (typecheck + lint + Vite + Java) and copies `dist/` to the deploy. `.env` provides `CT_MODULE_DESTINATION` and `HTSW_REPOSITORY_PATH` (used by `/htsw recompile`).

## Comments

**Default to NO comment.** AI-written comments tend to (a) restate what well-named code already says and (b) phrase guessed reasoning as established fact. The second is the worse failure: a confident-sounding "this works because X" misleads the next reader into trusting incorrect rationale and leaving real bugs in place. A wrong comment is worse than no comment.

Before writing a comment: **did you verify this, or are you narrating your mental model?** If you didn't verify it (an assumed MC/Rhino quirk, a guessed "this is needed because…"), leave it out. If the reader can recover the WHY from the code, leave it out.

Write a comment only when ALL hold:

- The WHY cannot be recovered from reading the code.
- It is non-obvious AND load-bearing — a future edit that ignores it would introduce a real bug.
- You actually know the reason — verified by tracing, testing, or repo history, not inferred.

**Do not write:**

- Restatements of the next line — `// increment i`, `// dark slate, primary panel bg` next to `COLOR_PANEL`.
- Narration of removed code or past bugs — `// previously this re-called scheduleReparse()…`, `// fix for ticket X`. Git has the diff; PRs have the context. Comments rot, history doesn't.
- Task / PR breadcrumbs — `// added for the export flow`, `// used by the importer`. Renames silently make these wrong.
- Section dividers inside functions — `// --- Double-click detection ---`. The function is too long; extract a helper instead.
- Speculative MC/CT/Rhino internals — `// works because MC reads X during runTick`, unless you've actually traced it. If you can't reproduce the claim on demand, don't assert it in prose.
- TODOs without a tracked issue and a concrete next step.
- Docstrings that restate the type signature or list every parameter.

**Comments worth keeping (good patterns already in this repo):**

- Hidden MC / CT 1.8.9 quirks you can demonstrate — placeholder `GuiScreen` swap, `displayGuiScreen(null)` side effects, `Image.fromAsset` being non-functional in this CT build.
- Concrete race-condition or timing assumptions in async / event code (e.g. capturing a `GuiScreen` ref before listener registration to avoid a close-event race).
- Non-obvious design choices a future agent would otherwise undo — fixed overlay scale of 4, action sync order `delete → edit → move → add`, per-housing item SNBT cache.
- Short docstrings on exported APIs covering the *contract*, not the implementation.

When in doubt: delete the comment. If a single line truly needs prose to be understandable, rename the symbol or extract a function — prose is the last resort.

## Code style

- Prefer rename / extract over explanatory comments (see **Comments**). Delete unnecessary comments you come across.
- Prefer inline GUI code for small one-off flows over tiny extracted helpers.
- Use typed accessors over raw union indexing (`getActionSpec`, `getActionLoreFields`, `getNestedListFields`).
- In `ct_module/` async/event code: no hardcoded sleeps where an event wait exists. Go through `TaskContext` and `waitForMenu`, not raw CT globals.
- Read the `gui-development` skill before touching anything under `ct_module/src/gui/`.

## Working style

- Short progress updates before edits, builds, installs, and when findings change the plan.
- Be direct about what changed and why. No vague reassurance.
- When answering an architecture or code question, don't only describe current behavior — judge it. Say whether a responsibility belongs where it is, and what to change if the design is accidental, overbuilt, or misleading.
- When you see duplicate channels, fake abstractions, or names that obscure ownership, call out the better architecture instead of preserving the existing shape by default. If two mechanisms serve the same real consumer, propose collapsing them into one typed path — don't justify a split just because one path carries more math, state, or weight.

## ct_module importer reference

Lives in `ct_module/src/importer/`. Reads and writes real Housing menus through async tasks, not callbacks. The procedures and coverage shift every PR — read the code for those; the invariants below are what the code can't tell you.

**Where the live truth is:**

- Which importable types are wired — the switches in `importables/imports.ts` / `exports.ts`.
- Per-type import/export procedure — that type's `importables/<type>/import.ts` / `export.ts`.
- Read/write + nested-list coverage per action/condition — `ACTION_SPECS` / `CONDITION_SPECS`, via `getActionSpec` / `getConditionSpec`.
- Simulator coverage (`ct_module/src/simulator/`, separate from import) — `createActionBehaviors()` / `createConditionBehaviors()`.

**Structure invariants:**

- `imports.ts` / `exports.ts` are pure dispatchers — never inline per-type bodies.
- A type's import + export live together under `importables/<type>/`; logic shared between the two directions stays in that folder. `exporter/` is cross-type wiring only — never `exporter/exportFunction.ts`.
- Exporters reuse importer reads (`readActionList`, `readConditionList`, `parse*ListItem`) — never duplicate read logic.
- Adding an action/condition type: update `fields/actionMappings.ts` / `conditionMappings.ts` first — they drive parsing, list-item observation, and diff cost.

**Behavioral invariants** (a future edit would undo these):

- Action sync applies **delete → edit → move → add** — deletes stabilize indices, edits precede moves to avoid stale slot refs, moves resolve by current index, adds append then rotate. Action moves are circular (Housing shift-click reorder wraps). Conditions have no moves.
- A no-`write` action is add-and-return; do **not** add an empty `write` to mean "no-op" — it still triggers click-back. A present `write` assumes the editor is open and clicks back when done. Conditions also toggle invert before clicking back; actions don't.
- Field setters short-circuit on matching value, so writers are idempotent without per-field guards.
- Nested-list action types (CONDITIONAL, RANDOM, …) need an explicit `read` in their spec — lore alone is insufficient and the importer throws if it's missing. Sync hydrates nested lists selectively (shallow, then `createNestedHydrationPlan`); export always reads full.
- `previewHandler` is the one live preview/progress path — don't add a parallel diff/progress callback without a real second consumer.
- Don't casually change `normalizeActionCompare` / `normalizeConditionCompare` — it churns every diff.
- `waitForMenu` keys on `S30PacketWindowItems` + a tracked window ID, then waits one tick: MC applies window data on the main thread *after* the packet.
- Notes live on list items, not inside editors.

**Cache / trust / knowledge naming:** *cache* = stored baseline state, *trust* = permission to skip importer work, *Knowledge* = the user-facing name for both (the `/htsw knowledge` command and the Knowledge tab). Keep Knowledge user-facing; do **not** introduce new backend `knowledge` names. Item SNBT caches and the importable cache are stateful and per-housing (`interact_data` isn't portable — declare click actions in `leftClickActions` / `rightClickActions`). Debug "why didn't this re-import?" from cache state first.
