# HTSW Agent Guide

HTSW = "HTSL but we don't take Ls" — a refined HTSL (Housing Text Scripting Language) that expresses Hypixel Housing GUI programming as text.

## How to read this guide

This guide records **what each part is responsible for and the rules it must keep** — and nothing you could find by reading the code, so it can't go stale. When you add to this file, write only one of three things:

- **What an area is for**
- **Where something is defined**
- **A reason the code can't tell you on its own**

## Layout

- `language/` — parser, type system, diagnostics, `import.json` loader, NBT, runtime. Where syntax and types are defined. Entrypoint `language/src/index.ts`. **Ask before editing.**
- `ct_module/` — loads HTSW into Minecraft: drives Housing menus, diffs, imports/exports, simulates. Runs on Rhino with `lib: ["ES5", "DOM"]`; anything bundled into ChatTriggers (including emitted `language/` JS) is constrained to that.
- `cli/` — Node CLI (`htsw check [path]`, `htsw run [path]`).
- `editors/` — VS Code, Monaco, shared editor features.
- `docs/`, `examples/` — guide content and example projects. Tests live per package (`language/test`, `ct_module/test`).

| area | build | test | notes |
|---|---|---|---|
| `language/` | `npm run build` | `npm test` | `lib: es2022` |
| `cli/` | `npm run build` | — | |
| `ct_module/` | `npm run build` | `npm test` | Java helper via `build:java`; deploy with `python install.py` |

**After any `ct_module/` change, run `python install.py` from `ct_module/`** so `/ct reload` picks it up. It runs the full build (typecheck + lint + Vite + Java) and copies `dist/` to the deploy. `.env` provides `CT_MODULE_DESTINATION` and `HTSW_REPOSITORY_PATH` (used by `/htsw recompile`).

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

**Fix the name before reaching for a comment.** When a comment exists only to decode an under-named thing, rename the thing instead. Name a variable for what it holds (a noun), not how it was produced (an adjective). A clear name removes the need for the comment, and a comment can't cite a name the reader hasn't met; keep the comment only if a real *why* remains after renaming.

## Code style

- Prefer refactoring over explanatory comments.
- Obviously, if something isn't immediately obvious what it does, change it.
- If a state object has fields that many files update by hand, improve it. Put the repeated updates behind functions on the state owner instead. For example, callers should say `state.completeEdit(op)` instead of manually doing `completedOps++`, progress emit, snapshot refresh, and event emit in every phase. The goal is fewer files needing to know the bookkeeping rules.
- Read the `gui-development` skill before touching anything under `ct_module/src/gui/`.

## Working style

- Short progress updates before edits, builds, installs, and when findings change the plan.
- Be direct about what changed and why. No vague reassurance.
- Release notes are user-facing update text. Write the important changes in plain language, avoid internal jargon, and do not publish changelog-only Markdown into the CT updater feed.
- If you are not fully sure how Hypixel Housing behaves, ask Callan before implementing, documenting, or relying on that behavior.
- When answering an architecture or code question, don't only describe current behavior — judge it. Say whether a responsibility belongs where it is, and what to change if the design is accidental, overbuilt, or misleading.
- When you see two code paths doing the same job, an abstraction that doesn't earn its place, or a name that hides who owns what, say so and suggest the better design instead of keeping the current shape by default. If two mechanisms feed the same caller, suggest merging them into one — don't keep them split just because one side carries more math, state, or weight.

## ct_module importer reference

Split across `ct_module/src/housingSync/` (read/diff/write live menus), `importables/` (per-type import/export), `exporter/` (cross-type export wiring), and `importCache/` (per-house cache). Reads and writes real Housing menus through async tasks, not callbacks. The procedures and coverage shift every PR — read the code for those; the rules below are what the code can't tell you.

**Where the current behavior is defined:**

- Which importable types are wired — the switches in `importables/imports.ts` / `exports.ts`.
- Per-type import/export procedure — that type's `importables/<type>/import.ts` / `export.ts`.
- Read/write + child-list coverage per action/condition — `ACTION_SPECS` / `CONDITION_SPECS`, via `getActionSpec` / `getConditionSpec`.
- Simulator coverage (`ct_module/src/simulator/`, separate from import) — `createActionBehaviors()` / `createConditionBehaviors()`.

**Structure rules:**

- `imports.ts` / `exports.ts` only dispatch — never inline per-type bodies.
- A type's import + export live together under `importables/<type>/`; logic shared between the two directions stays in that folder. `exporter/` is cross-type wiring only — never `exporter/exportFunction.ts`.
- Exporters reuse importer reads (`readActionList`, `readConditionList`, `parse*ListItem`) — never duplicate read logic.
- Adding an action/condition type: update `housingSync/fields/actionMappings.ts` / `conditionMappings.ts` first — they drive parsing, list-item observation, and diff cost.
