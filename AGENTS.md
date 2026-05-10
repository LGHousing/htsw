# HTSW Agent Guide

HTSW = "HTSL but we don't take Ls" — a refined version of HTSL (Housing Text Scripting Language), which expresses Hypixel Housing GUI programming as text.

## Packages

- `language/` — parser, type system, diagnostics, `import.json` loader, NBT, runtime. Source of truth for syntax and types. Has the only meaningful test coverage. Public entrypoint: `language/src/index.ts`. Ask before editing.
- `cli/` — Node CLI. `htsw check [path]`, `htsw run [path]`.
- `ct_module/` — ChatTriggers module. Most operationally complex. Loads HTSW into Minecraft, drives Housing menus, diffs, simulates.
- `editors/` — VS Code, Monaco, shared editor features.
- `docs/`, `examples/`, `test/` — content and language tests.

## Build

Each package builds independently. No top-level workspace script.

| Package      | Build           | Test       | Notes                                                                        |
| ------------ | --------------- | ---------- | ---------------------------------------------------------------------------- |
| `language/`  | `npm run build` | `npm test` | `lib: es2022`                                                                |
| `cli/`       | `npm run build` | —          |                                                                              |
| `ct_module/` | `npm run build` | —          | Includes Java helper via `npm run build:java`. Install: `python install.py`. |

`ct_module/install.py` needs a local `.env` with `CT_MODULE_DESTINATION` (target ChatTriggers folder) and `HTSW_REPOSITORY_PATH` (used by `/htsw recompile`).

**After any change under `ct_module/`, run `python install.py` from `ct_module/` so the deployed module is ready for `/ct reload`.** The script runs `npm run build` (typecheck + lint + Vite + Java) and copies `dist/` to the deploy. Pass `--nobuild` only if you have already built and just want to redeploy.

## Rhino / ES5 Constraint — Read Before Writing CT Module Code

`ct_module` runs on a Rhino-like JS engine. `tsconfig.json` sets `lib: ["ES5", "DOM"]` deliberately so the editor surfaces missing methods. **Anything that ends up in the ChatTriggers bundle** is constrained, including emitted `language/` JS.

- **Avoid newer prototype methods.** No `String.padStart`/`replaceAll`/`matchAll`/`at`, no `Array.flat`/`flatMap`/`at`, no `Object.entries`/`values`/`fromEntries`. Use ES5 equivalents (`while` loops, `split(...).join(...)`, `Object.keys(o).map(k => [k, o[k]])`).
- **Syntax features are fine** — `??`, `?.`, async/await, classes, spread, etc. are transpiled.
- **`tsc --noEmit` may not catch this.** Trust the IDE squiggles. Bundling won't catch it either (host has V8).
- **Polyfill** in `ct_module/src/polyfills/` and import before first use if you really need a modern method.

## Core Flow

1. `FileLoader` resolves `import.json` and references.
2. Parser builds typed importables + diagnostics.
3. Checker validates if parsing succeeded.
4. Consumers either print diagnostics, simulate, or import into Housing.

## ct_module Bootstrap

`ct_module/src/index.ts`:

1. Promise polyfill.
2. `injectLong.ts` — loads `LongValue.class`, reflects arithmetic methods, calls `htsw.setLongImplementation(...)`. **Required**; without it long-runtime falls back to a slow path.
3. Task manager / event waiters.
4. Command registration.

## Commands

`/htsw`, `/import`, `/simulator` (alias `/sim`), `/export`. `/htsw recompile` shells out to `python install.py` and `ct reload`. `/import` and `/export` parse via `SourceMap(new FileSystemFileLoader())` and run work through `TaskManager.run(...)`. `commands.ts` also has live debug hooks (menu dump, condition diff) — not production UX.

## Task System

Importer is async-task based, not callbacks.

- `tasks/context.ts` — `TaskContext`: cancellation, `runCommand`, `displayMessage`, `sleep`, `withTimeout`, slot/event helpers. Almost all importer logic uses `TaskContext`, not raw CT globals.
- `tasks/manager.ts` — tracks contexts, can cancel all.
- `tasks/specifics/waitFor.ts` — event multiplexer over `tick` / `packetReceived` / `packetSent` / `message`. `waitForMenu` keys on `S30PacketWindowItems` + a tracked window ID, then waits one tick because Minecraft applies window data on the main thread after the packet.
- `tasks/specifics/slots.ts` — `ItemSlot` wraps container slots (left/right/middle/shift click, drop, name/predicate/stripped-title lookup). Importer code uses `ItemSlot`, not `Player.getContainer()` directly.

## Importer Architecture

Lives in `ct_module/src/importer/`:

- `helpers.ts` — lowest-level GUI API: `waitForMenu`, `setNumberValue`/`setStringValue`/`setSelectValue`/`setBooleanValue`/`setCycleValue` (all short-circuit when current value matches), `getSlotPaginate`, anvil helpers, `parseLoreKeyValueLine`/`parseFieldValue`, `enterValue` (auto-detects chat vs anvil input), list-item note read/write.
- `actionMappings.ts` / `conditionMappings.ts` — type → display name + lore labels + property names + field kinds (`boolean`/`value`/`cycle`/`select`/`item`/`nestedList`). Drive parsing AND diff cost.
- `actions.ts` — `readActionList`, `syncActionList`, `ACTION_SPECS` (read/write per type). Biggest importer file.
- `actions/diff.ts` — diff/matching algorithm.
- `conditions.ts` — analogous; `CONDITION_SPECS`.
- `compare.ts` — normalizes objects before comparison: keys sorted, `undefined` dropped, empty arrays dropped, notes normalized. Sync stability depends on this.

### Action Diff

Three-pass match: exact → note-only → same-type minimum-cost. Cost is circular move distance + lore-field differences + note difference + recursive nested-list cost. Outputs a flat list of `delete`/`move`/`edit`/`add`. Applied in the order **delete → edit → move → add** (deletes stabilize indices, edits before moves avoid stale slot refs from the original read, moves resolve slots by current index, adds are appended and rotated). Movement is circular because Housing shift-click reorder wraps. See `actions/diff.ts`.

### Condition Diff

Simpler: edit/delete/add, no moves. See `conditions.ts`.

## Importables Layout

`importables/` owns everything per-importable-type — BOTH directions (import + export) — so the two stay symmetric.

    importables/
    ├── imports.ts          ← pure dispatcher: switch on type → importImportable<X>
    ├── exports.ts          ← pure dispatcher: switch on type → exportImportable<X>
    ├── importSession.ts    ← /import session orchestration
    ├── itemRegistry.ts     ← shared item lookup
    └── <type>/
        ├── importX.ts      ← per-type IMPORT body
        ├── exportX.ts      ← per-type EXPORT body
        └── (other files)   ← shared between import/export of this type;
                              naming is a judgment call.

**Rules.** `imports.ts`/`exports.ts` are pure dispatchers — never inline per-type bodies. Logic shared between import and export of one type lives inside that type's folder. To know which types are wired, read the dispatch switches.

`exporter/` is reserved for cross-type wiring only:

- `exporter/index.ts` — `/export` command + subcommand routing.
- `exporter/importJsonWriter.ts` / `paths.ts` / `sanitize.ts` — cross-type infrastructure.

Per-type export bodies do NOT belong under `exporter/`. `importables/events/exportEvent.ts`, never `exporter/exportEvent.ts`. Exporters reuse importer reads — `readActionList(ctx, { kind: "full" })`, `readConditionList`, `parseActionListItem`, `parseConditionListItem`. Never duplicate read logic.

### Per-Type Import Flows

- **FUNCTION** — `/function edit <name>` → race menu vs `"Could not find a function..."` → `/function create` if missing → `syncActionList`. If `repeatTicks`: go back, paginate to function slot, right-click for auto-execution settings, set tick count.
- **EVENT** — `/eventactions` → click event slot by name → `syncActionList`.
- **REGION** — TP to `bounds.from` + `//pos1`, TP to `bounds.to` + `//pos2`, `/region edit <name>` (race vs missing). Create if missing, else `"Move Region"`. Re-open after move for fresh menu state. Sync entry/exit lists.
- **ITEM** — Resolve UUID + hash. If there are no declared click actions, materialize/inject the source item and skip `/edit`; no per-house SNBT cache is needed because references can use the raw item. For action-bearing items, an exact cache hit at `./htsw/.cache/<uuid>/items/<hash>.snbt` short-circuits and refreshes knowledge. Otherwise, if knowledge points to a previous cached SNBT for the same item shell, inject that cached housing-tagged item, `/edit`, open Edit Actions, diff/sync changed click-action lists, then capture slot 0 NBT via `getRawNBT()` and write the new cache. If no usable prior cache exists, start from source NBT and perform a full action sync. Item SNBT caches are **per-housing**; source `interact_data` is not portable, so declare click actions in `leftClickActions`/`rightClickActions`.

## ACTION_SPECS / CONDITION_SPECS

Source of truth for read/write coverage and nested-list reading per type. Access via `getActionSpec(type)` / `getConditionSpec(type)`. The doc does not enumerate per-type coverage because it shifts every PR.

Spec-driven invariants:

- `importAction(...)` treats no-`write` actions as add-and-return — do NOT define an empty-bodied `write` to mean "no-op" (would still trigger click-back).
- If `write` exists, it assumes the editor opened and clicks back when done. Conditions ALSO toggle invert before clicking back. Actions don't share the invert rule.
- Field setters short-circuit when current value matches — writers can be idempotent without per-field guards.
- Nested-list-bearing action types (CONDITIONAL, RANDOM, ...) need an explicit `read` in their spec — lore-only is insufficient. Importer throws when a required nested read is missing.

## Simulator

`ct_module/src/simulator/` — separate from GUI import. Stores parsed importables + runtime, registers tick/command/event/region triggers. Behaviors come from `createActionBehaviors()` (`simulator/actions.ts`) and `createConditionBehaviors()` (`simulator/conditions.ts`); read those for current coverage. Useful for parser/runtime work and end-to-end testing — does NOT validate GUI automation.

## NBT Helpers

`ct_module/src/utils/nbt.ts` converts HTSW NBT ↔ Minecraft NBT and materializes ItemStacks. Used by item import/cache.

## Extension Invariants

- New importable types live under `importables/<type>/`. `importX.ts` + `exportX.ts` + shared-as-needed. Dispatchers stay pure. Per-type export files don't go under `exporter/`.
- Update `actionMappings.ts` / `conditionMappings.ts` first when adding action/condition types. They drive parsing, list-item observation, and diff cost.
- Use typed accessors (`getActionSpec`, `getActionLoreFields`, `getNestedListFields`) — don't index unions with arbitrary strings.
- New action with nested lists: make `getNestedListFields` see them, ensure list-item lore parses, add a `read` if lore is insufficient.
- Action sync uses selective nested hydration (shallow read first, then `createNestedHydrationPlan`). Export flows always use full-mode reads.
- Preserve `normalizeActionCompare` / `normalizeConditionCompare` semantics — changes cause widespread diff churn.
- Use `TaskContext` + `waitForMenu` + existing setters. No hardcoded sleeps without an event-based alternative.
- Prefer inline GUI code for small one-off flows over tiny extracted helpers.
- Notes live on list items, not inside editors.
- Conditions: every editor exposes invert. Actions: no such rule.
- Action sync order is **delete → edit → move → add** by design.
- Item cache is stateful and map-specific — be careful when debugging "why didn't this re-import?"

## Code Style

- No unnecessary comments. Docstrings on exported APIs and non-obvious internals are fine, but don't overuse them — let well-named code carry the meaning. Drop noise like `// increment i` or restating what the next line obviously does.

## Working Style

- Short progress updates before edits, builds, installs, and when findings change the plan.
- Be direct about what changed and why. No vague reassurance.
- For meaningful code changes, especially under `ct_module/`, `language/`, importer/exporter logic, or editor behavior, run CodeRabbit CLI before handing work back when available: `cr --type uncommitted`.
