# HTSW Agent Guide

This repository contains a small monorepo around the HTSL language and its tooling.
HTSL stands for Housing Text Scripting Language and is the syntax for transforming Hypixel Housing GUI-based programming 
into text via a scripting language. HTSW, a self-referential naming "HTSL but we don't take Ls" is a refined version of this system-
especially a new Importer ChatTriggers module that is intelligent. The important packages are:

- `language/`: the core parser, type system, diagnostic engine, import.json loader, NBT support, and runtime.
- `cli/`: a Node CLI that parses and checks or runs HTSW importable graphs using the `language` package.
- `ct_module/`: the ChatTriggers integration. This is the most operationally complex package in the repo. It parses HTSW importables inside Minecraft, drives GUI menus, syncs actions/conditions into Housing objects, and provides a local simulator.
- `editors/`: VS Code, Monaco, and shared editor features.
- `docs/`, `examples/`, `test/`: docs, sample content, and language-level tests.

## What The Repo Actually Does

At the center is the `htsw` package in `language/`. Its public entrypoint is `language/src/index.ts`. It exposes:

- `parseActionsResult` / `parseActions` for raw HTSL action files.
- `parseImportablesResult` / `parseImportables` for `import.json` graphs.
- `SourceMap`, diagnostics, spans, long-integer abstraction, runtime, and typed AST/importable definitions.

The basic flow is:

1. A file loader resolves `import.json` and nested references.
2. The parser builds typed importables and diagnostics.
3. The checker validates semantic constraints if parsing succeeded.
4. Consumers either:
   - print diagnostics and stop (`cli check`, editor features),
   - simulate behavior (`cli run`, `ct_module` simulator),
   - or import the result into Housing (`ct_module` importer).

## Package Map

### `language/`

- Owns the source of truth for syntax, diagnostics, importable types, runtime behavior, placeholder/value parsing, and NBT parsing.
- Exports subpaths for `types`, `htsw`, `runtime`, and `nbt`.
- Has the meaningful test coverage in the repo.

Important directories:

- `language/src/htsl/`: lexer/parser/typecheck for HTSL.
- `language/src/importjson/`: import graph parsing and merge/include handling.
- `language/src/runtime/`: runtime execution model used by CLI and simulator.
- `language/src/types/`: all discriminated unions for actions, conditions, importables, constants.
- `language/test/`: the best executable documentation for parser/runtime behavior.

### `cli/`

- `cli/src/main.ts` implements `htsw check [path]` and `htsw run [path]`.
- Uses a simple Node file loader with `fs` + `path`.
- Parses `import.json` via `htsw.parseImportablesResult`.
- `run` mode feeds the parsed result into a local runtime in `cli/src/runtime.ts`.

### `editors/`

- `editors/code/`: VS Code extension. Wires diagnostics and inlay hints.
- `editors/monaco/`: Monaco mode and language contributions.
- `editors/common/`: shared editor-side helpers.

### `ct_module/`

This package is a ChatTriggers module that:

- boots inside Minecraft/ChatTriggers,
- loads the HTSW parser/runtime into that environment,
- translates HTSW importables into Housing menu clicks,
- reads existing Housing state back from GUI lore,
- computes diffs to minimize edits,
- and provides a simulator for executing HTSW actions without importing them.

This is the package most future agents will need to understand before making changes.

## Build And Runtime Assumptions

### Root

- There is no single top-level workspace script.
- Each package has its own `package.json`.

### `language/`

- Build: `npm run build`
- Test: `npm test`

### `cli/`

- Build: `npm run build`

### `ct_module/`

- Build: `npm run build`
- Java helper build is part of the CT module build through `npm run build:java`.
- Install into ChatTriggers target: `python install.py`

`ct_module/install.py` expects a local `.env` with at least:

- `CT_MODULE_DESTINATION`: where the built ChatTriggers module should be copied.
- `HTSW_REPOSITORY_PATH`: used by `/htsw recompile` to re-run the installer from inside Minecraft.

`ct_module/vite.config.ts` intentionally outputs CommonJS and preserves modules because ChatTriggers/Rhino-like environments are restrictive.

### Runtime / Library Target — Read Before Writing Code

`ct_module/tsconfig.json` sets `"lib": ["ES5", "DOM"]` even though `target` is `ESNext`. The `lib` is what matters for what built-in methods you can call: ChatTriggers runs on a Rhino-like JS engine where modern `String`/`Array`/`Object` prototype methods are missing or unreliable, so the type system is deliberately constrained to ES5 to surface this in the editor.

The language package is built separately with `lib: ["es2022"]`, but its emitted JS is consumed by `ct_module` and runs in the same Rhino runtime — so the ES5 constraint applies to **anything that ends up in the ChatTriggers bundle**, not just files under `ct_module/src/`.

In practice:

- **Avoid newer prototype methods.** `String.prototype.padStart` / `padEnd` / `replaceAll` / `matchAll` / `at`, `Array.prototype.flat` / `flatMap` / `at`, `Object.entries` / `values` / `fromEntries` are the common offenders. Use the obvious ES5 equivalents: a `while` loop for padding, `split(...).join(...)` for `replaceAll`, `Object.keys(o).map(k => [k, o[k]])` for entries.
- **Syntax features are fine.** `??`, `?.`, async/await, template literals, classes, spread, destructuring, etc. are all transpiled by Vite/Babel before reaching Rhino. ct_module already uses `??` and `?.` extensively.
- **`tsc --noEmit` may not catch this.** `@types/node` and other transitive type packages can pull in lib defs that hide the missing-method problem from the CLI typechecker. The IDE (VS Code language server) honors the project's `lib` setting more strictly and will flag these — trust the squiggle. Bundling with Vite/Rollup also won't catch this, since the methods exist on the build host's V8.
- **Reach for existing patterns.** Search ct_module for analogous needs before reinventing — e.g. `simulator/helpers.ts` already uses the `while (s.length < n) s = "0" + s` pad pattern.

If you genuinely need a modern method, polyfill it locally in `ct_module/src/polyfills/` and import the polyfill module before first use.

## `ct_module` Deep Dive

### Entry And Bootstrap

`ct_module/src/index.ts` is the entrypoint. It:

1. installs a Promise polyfill,
2. injects the long-integer implementation bridge (`injectLong.ts`),
3. loads the task manager/event waiters,
4. registers commands.

`ct_module/src/injectLong.ts` is important. The core `htsw` runtime relies on a pluggable long implementation. This file:

- loads `LongValue.class` from the built ChatTriggers module path,
- reflects static constructors and arithmetic methods,
- passes those methods into `htsw.setLongImplementation(...)`.

Without that bridge, long-based runtime behavior inside ChatTriggers would be slow as it would fallback.

### Command Surface

`ct_module/src/commands.ts` exposes:

- `/htsw`
- `/import`
- `/simulator` with alias `/sim`

Important behaviors:

- `/import [path]` parses importables using `SourceMap(new FileSystemFileLoader())`.
- Diagnostics are printed before import proceeds.
- Import work is run through `TaskManager.run(...)`.
- `/simulator start [path]` parses importables, constructs a simulator runtime, and registers event/command/tick/region triggers.
- `/htsw recompile` shells out to `python <repo>\\ct_module\\install.py` and runs `ct reload`.

There are also debug hooks in `commands.ts` for menu dumping and condition diff debugging. They are not cleaned up production UX; they are live debugging utilities.

### File Loading In CT

`ct_module/src/utils/files.ts` implements `FileSystemFileLoader` for ChatTriggers:

- root path is `./config/ChatTriggers/modules/HTSW`,
- relative paths resolve against that root,
- absolute paths remain absolute.

That loader is the bridge that lets the shared `language` parser work unchanged inside Minecraft.

## Task System And GUI Automation

The importer is built on a very small async task framework instead of callback soup.

### `TaskContext`

`ct_module/src/tasks/context.ts` provides:

- cancellation state,
- `runCommand` and `sendMessage` wrappers,
- `displayMessage`,
- cooperative `sleep`,
- `withTimeout`,
- re-exports of slot lookup and event waiting helpers.

The key point: almost all importer logic is written in terms of `TaskContext`, not raw ChatTriggers globals.

### `TaskManager`

`ct_module/src/tasks/manager.ts`:

- tracks running contexts,
- wraps callbacks with cancellation handling,
- can cancel all tasks.

There is also an example command registered at the bottom of this file; it is not part of the importer architecture.

### Event Waiters

`ct_module/src/tasks/specifics/waitFor.ts` implements a simple event multiplexer for:

- `tick`
- `packetReceived`
- `packetSent`
- `message`

Key detail:

- `waitForMenu` in importer helpers depends on `S30PacketWindowItems` plus a tracked `lastWindowID...` global to distinguish new windows from already-seen ones.
- After the packet arrives, it waits one tick because Minecraft applies the window data on the main thread afterward.

This is the foundation for all reliable menu navigation.

### Slot Abstraction

`ct_module/src/tasks/specifics/slots.ts` wraps container slots with `ItemSlot`.

Capabilities:

- left/right/middle click,
- shift-click variants,
- drop,
- name-based or predicate-based lookup,
- stripped-format title lookup.

Most importer code does not talk to `Player.getContainer()` directly. It goes through `ItemSlot`.

## Importer Architecture

The importer lives in `ct_module/src/importer/`.

Files to know:

- `importables.ts`: high-level dispatch for functions, events, regions, and items.
- `helpers.ts`: menu waits, lore parsing, value entry, boolean/select/cycle/string/number setters, note handling.
- `actionMappings.ts`: mapping from action type to Housing display name and lore field definitions.
- `conditionMappings.ts`: same for conditions.
- `actions.ts`: action list reading, nested action reading, writing, sync application.
- `actions/diff.ts`: nontrivial diff/matching algorithm for action lists.
- `conditions.ts`: condition list reading, diffing, inversion handling, sync application.
- `compare.ts`: normalization used before object comparison.

### Normalization Rules

`compare.ts` normalizes actions and conditions before equality checks:

- object keys are sorted,
- `undefined` fields are dropped,
- empty arrays are dropped,
- `note` is normalized via `normalizeNoteText`.

This matters a lot. A large part of sync stability relies on comparisons ignoring incidental shape differences.

### Menu/Field Helpers

`importer/helpers.ts` is a core file. Important behavior:

- `waitForMenu`: waits for a new non-player container window.
- `waitForUnformattedMessage`: exact stripped chat match.
- `getSlotPaginate`: scans paginated option menus by repeatedly clicking `"Left-click for next page!"`.
- `setAnvilItemName` / `acceptNewAnvilItem`: direct reflection hack for anvil input UIs.
- `parseLoreKeyValueLine`: extracts `Label: Value` pairs while ignoring item/NBT dump lines.
- `parseFieldValue`: converts lore into typed non-nested values depending on field kind.
- `readListItemNote` / `setListItemNote`: note support is list-item based, not editor-field based.
- `setBooleanValue`, `setSelectValue`, `setCycleValue`, `setNumberValue`, `setStringValue`: generic UI mutators with short-circuit checks.
- `enterValue`: detects whether the Housing UI is expecting chat input or an anvil GUI and writes through the correct path.

This file is the lowest-level generic GUI API. Most higher-level importer work is declarative on top of it.

## Importable-Level Import Logic

`ct_module/src/importables/imports.ts` handles top-level importables. Its export-side counterpart `ct_module/src/importables/exports.ts` mirrors the same per-type dispatch shape for `/export`.

Supported importable types right now:

- `FUNCTION`
- `EVENT`
- `REGION`
- `ITEM`

Unsupported importable kinds fall through to an exhaustive-check comment and are effectively not implemented.

### Function Import

Flow for `ImportableFunction`:

1. `/function edit <name>`
2. Race between menu open and `"Could not find a function with that name!"`
3. If missing, `/function create <name>`
4. `syncActionList(...)`
5. If `repeatTicks` is set:
   - go back,
   - open function list slot via `getSlotPaginate`,
   - right-click to open auto execution settings,
   - parse `"Current"` lore,
   - set tick count with `setNumberValue` if needed.

### Event Import

Flow for `ImportableEvent`:

1. `/eventactions`
2. click the event slot by name
3. `syncActionList(...)`

### Region Import

Flow for `ImportableRegion`:

1. teleport to `bounds.from`, run `//pos1`
2. teleport to `bounds.to`, run `//pos2`
3. `/region edit <name>`
4. if missing, `/region create <name>` and re-open
5. if existing, use `"Move Region"` to update bounds
6. sync entry and/or exit action lists

The code re-opens the region after moving so subsequent menu operations happen from a fresh state.

### Item Import

Flow for `ImportableItem`:

1. Skip immediately if there are no left/right click actions.
2. Run `/wtfmap` and parse the map UUID from chat.
3. Hash the entire importable with `cyrb53`.
4. If `./htsw/.cache/<uuid>/items/<hash>.snbt` exists, skip import entirely.
5. Convert HTSW NBT to a Minecraft `ItemStack`.
6. Inject the item into creative slot 36 via `C10PacketCreativeInventoryAction`.
7. Force held slot 0 via `C09PacketHeldItemChange` if needed.
8. `/edit`, then open `"Edit Actions"`.
9. Sync left-click and right-click action lists.
10. Read back slot 0 NBT and cache it as SNBT.

Important nuance:

- item import is cache-based, not diff-based.
- the cache key is derived from full importable JSON plus current map UUID.

## Action Importer

`ct_module/src/importer/actions.ts` is the biggest importer file.

### Action Metadata

`actionMappings.ts` maps each `Action["type"]` to:

- the Housing GUI display name,
- lore labels,
- target property names,
- field kinds: `boolean`, `value`, `cycle`, `select`, `item`, `nestedList`.

This mapping drives both:

- parsing list items back into HTSW actions,
- and selective comparison cost logic in the diff engine.

### Reading Actions

`readActionList(...)`:

1. returns to page 1,
2. reads each page with `readActionsListPage(...)`,
3. advances through pagination using slot 53,
4. restores page 1 before returning.

`readActionsListPage(...)`:

- inspects the 3x7 action grid,
- parses action type from display name,
- parses non-nested lore fields and note,
- identifies nested-list fields that are not `- None`,
- clicks into nested editors only when needed.

Nested action reading is currently implemented for:

- `CONDITIONAL`
  - reads `conditions`
  - reads `ifActions`
  - reads `elseActions`
  - reads `matchAny`
- `RANDOM`
  - reads nested `actions`

If an action with required nested-list reading has no `read` implementation, the importer throws for that read path.

### Writing Actions

The action writer model is spec-driven: `ACTION_SPECS[type]` may define `read` and/or `write`.

Implemented meaningful action writers:

- `CONDITIONAL`
- `MESSAGE`
- `CHANGE_VAR`
- `RANDOM`

Behavior of those writers:

- `CONDITIONAL`: syncs nested conditions and nested action lists, sets `Match Any Condition`.
- `MESSAGE`: sets the `"Message"` field.
- `CHANGE_VAR`: sets holder, variable key, operation, value, and automatic unset.
- `RANDOM`: syncs nested `actions`.

Declared but currently stubbed writers with empty bodies:

- `SET_GROUP`
- `TITLE`
- `ACTION_BAR`
- `CHANGE_MAX_HEALTH`
- `GIVE_ITEM`
- `REMOVE_ITEM`
- `APPLY_POTION_EFFECT`
- `GIVE_EXPERIENCE_LEVELS`
- `SEND_TO_LOBBY`
- `TELEPORT`
- `FAIL_PARKOUR`
- `PLAY_SOUND`
- `SET_COMPASS_TARGET`
- `SET_GAMEMODE`
- `CHANGE_HEALTH`
- `CHANGE_HUNGER`
- `FUNCTION`
- `APPLY_INVENTORY_LAYOUT`
- `ENCHANT_HELD_ITEM`
- `PAUSE`
- `SET_TEAM`
- `SET_MENU`
- `DROP_ITEM`
- `SET_VELOCITY`
- `LAUNCH`
- `SET_PLAYER_WEATHER`
- `SET_PLAYER_TIME`
- `TOGGLE_NAMETAG_DISPLAY`

Actions with no write function because they are effectively zero-field list insertions:

- `KILL`
- `HEAL`
- `RESET_INVENTORY`
- `PARKOUR_CHECKPOINT`
- `CLEAR_POTION_EFFECTS`
- `CLOSE_MENU`
- `USE_HELD_ITEM`
- `EXIT`
- `CANCEL_EVENT`

Important nuance:

- `importAction(...)` treats no-write actions as add-and-return.
- If a write function exists, it assumes the action opens an editor and will click back afterward.

### Action Diff Engine

The action diff logic is in `ct_module/src/importer/actions/diff.ts`. This is the most sophisticated algorithm in the CT module.

It works in stages.

#### 1. Observation Model

Observed actions are richer than desired actions:

- they include current index,
- container slot id,
- slot reference,
- parsed action payload or `null` if unrecognized.

Unknown observed actions are always deleted by the diff.

#### 2. Matching Strategy

`matchActions(...)` matches observed to desired using three passes:

1. exact object equality,
2. note-only equality,
3. same-type minimum-cost matching.

The result classifies matches as:

- `exact`
- `note_only`
- `same_type`

#### 3. Cost Model

`actionCost(...)` is only defined for same-type candidates. Cost includes:

- circular move distance between observed and desired indices,
- non-nested lore field differences,
- note difference,
- nested list differences.

Nested list cost is recursive:

- nested `conditions` use `conditionListCost(...)`,
- nested action lists use `actionListCost(...)`.

Condition nested cost itself does bucketed same-type matching and field-difference scoring.

This means action diffing is not naive index-by-index replacement. It tries to preserve structurally similar actions and only edit what changed.

#### 4. Output Operations

`diffActionList(...)` emits a flat list of operations:

- `delete`
- `move`
- `edit`
- `add`

An action can generate both a `move` and an `edit`.

### Applying Action Diffs

`applyActionListDiff(...)` applies operations in a deliberate order:

1. deletes in reverse index order,
2. edits before moves,
3. moves sorted by target index,
4. adds sorted by target index.

Why this order matters:

- deleting first stabilizes subsequent indices,
- editing before moves avoids stale slot references from the original read,
- moves internally re-resolve slots by current index,
- adds import the new action at the end and then rotate it into place with shift-left/right clicks.

Movement logic:

- `moveActionToIndex(...)` treats the list as circular because Housing shift-click reordering wraps.
- It chooses left or right shift-click based on shorter circular distance.

### Action Sync Entry Point

`syncActionList(ctx, desired)`:

1. reads full observed list,
2. computes diff,
3. logs operation summary to chat,
4. applies the diff.

If you are extending importer behavior, this is the main orchestration entry point to preserve.

## Condition Importer

`ct_module/src/importer/conditions.ts` is simpler than actions but still important.

### Condition Metadata

`conditionMappings.ts` maps condition types to:

- Housing display names,
- lore labels,
- target property names.

Unlike actions, the condition reader relies much more heavily on list-item lore. The file explicitly notes that in-menu read functions are not necessary for most conditions because the list already exposes enough data.

### Reading Conditions

`readConditionList(...)`:

1. goes to page 1,
2. reads each page through `readConditionsListPage(...)`,
3. advances pagination using slot 50 left-click,
4. restores page 1.

`readConditionsListPage(...)`:

- filters visible condition slots to recognized condition display names,
- parses non-nested lore,
- preserves note,
- infers inversion by presence of lore line `"Inverted"`.

Only one explicit in-menu condition reader currently exists:

- `readRequireGroup(...)`

That reader exists because the selected group may need to be inferred from a submenu if the visible field is incomplete.

### Writing Conditions

Implemented meaningful condition writers:

- `REQUIRE_GROUP`
- `COMPARE_VAR`
- `REQUIRE_PERMISSION`
- `IS_IN_REGION`
- `REQUIRE_POTION_EFFECT`
- `COMPARE_HEALTH`
- `COMPARE_MAX_HEALTH`
- `COMPARE_HUNGER`
- `REQUIRE_GAMEMODE`
- `COMPARE_PLACEHOLDER`
- `REQUIRE_TEAM`
- `DAMAGE_CAUSE`
- `FISHING_ENVIRONMENT`
- `PORTAL_TYPE`
- `COMPARE_DAMAGE`

Partially implemented with explicit unsupported item-selection behavior:

- `REQUIRE_ITEM`
  - supports `whatToCheck`, `whereToCheck`, `amount`
  - throws if `itemName` must be written
- `BLOCK_TYPE`
  - throws if `itemName` must be written
- `IS_ITEM`
  - throws if `itemName` must be written

Zero-field conditions with no writer:

- `IS_DOING_PARKOUR`
- `IS_SNEAKING`
- `IS_FLYING`
- `PVP_ENABLED`

### Inversion Handling

Every condition editor is assumed to expose an invert toggle. The importer:

- opens the condition editor,
- writes fields,
- toggles invert state if required via `setOpenConditionInverted(...)`,
- always clicks go back.

That “always click go back” rule is explicitly different from actions.

### Condition Diff

`diffConditionList(...)` is intentionally simpler than action diff:

1. remove exact normalized matches,
2. for remaining desired conditions, try to pair with same-type observed conditions and mark them as edits,
3. unmatched observed become deletes,
4. unmatched desired become adds.

There is no explicit move operation for conditions.

This matches the current condition UI manipulation approach, which edits/deletes/adds rather than aggressively preserving order through dedicated reordering logic.

### Condition Sync Entry Point

`syncConditionList(ctx, desired)`:

1. reads observed conditions,
2. diffs them,
3. logs operation summary,
4. applies edits,
5. deletes in descending index order,
6. imports remaining adds.

## Exporter Status

There is now a narrow `ct_module` exporter implementation for functions.

What exists:

- `ct_module/src/exporter/`,
- a registered `/export function <name> [path]` command,
- full action-list reads through `readActionList(ctx, { kind: "full" })`,
- `.htsl` writing plus `import.json` upserts,
- best-effort knowledge-cache writes after export.

What does not exist:

- event, region, item, NPC, or menu export,
- full-project Housing export,
- canonical source generation for every importable type.

If future work extends the exporter, the closest starting points are:

- `ct_module/src/exporter/exportFunction.ts`
- `ct_module/src/exporter/importJsonWriter.ts`
- `readActionList(...)`
- `readConditionList(...)`
- `parseActionListItem(...)`
- `parseConditionListItem(...)`

## Simulator

The simulator in `ct_module/src/simulator/` is separate from GUI importing.

`Simulator`:

- stores parsed importables and a runtime,
- registers tick, command, event, and region triggers,
- creates runtime behaviors from CT-specific behavior registries.

Implemented action simulator behaviors include:

- `FUNCTION`
- `ACTION_BAR`
- `MESSAGE`
- `SET_VELOCITY`
- `TELEPORT`
- `TITLE`

`PLAY_SOUND` is currently stubbed.

Implemented condition simulator behaviors include:

- `COMPARE_HEALTH`
- `COMPARE_HUNGER`
- `COMPARE_MAX_HEALTH`
- `IS_FLYING`
- `IS_SNEAKING`
- `REQUIRE_GAMEMODE`
- `REQUIRE_ITEM` stub returns `false`
- `REQUIRE_POTION_EFFECT`

This simulator is useful for parser/runtime work but does not validate Housing GUI automation behavior.

## NBT And Item Helpers

`ct_module/src/utils/nbt.ts` converts HTSW NBT tags into Minecraft NBT classes and can materialize an `Item` from NBT.

This matters for `ImportableItem`, which creates a real item stack and edits its click actions through the Housing item editor.

## Practical Extension Notes

If you need to extend the CT module, keep these invariants in mind:

- Add or update action mapping data in `actionMappings.ts` and condition mappings in `conditionMappings.ts` first. They drive parsing, list-item observation, and diff cost behavior.
- Prefer typed helper accessors for mapping/spec tables instead of inline casts or indexing exact union objects with arbitrary strings. Examples: use `getActionSpec(...)` for `ACTION_SPECS`, `getActionLoreFields(...)` for action lore mappings, and `getNestedListFields(...)` for nested-list metadata.
- If a new action has nested lists, make sure `getNestedListFields(...)` can see them, make list-item lore summaries parse correctly, and add a `read` implementation if lore alone is insufficient.
- Action-list sync uses selective nested hydration: first shallow-read list items and nested summary types from lore, then use `createNestedHydrationPlan(...)` to choose which nested actions to open before final diffing. Full reads/export-style flows should use full action-list read mode so they hydrate everything.
- Preserve `normalizeActionCompare` / `normalizeConditionCompare` semantics unless you want widespread diff churn.
- For GUI interactions, use `TaskContext`, `waitForMenu`, and existing setter helpers. Do not hardcode sleeps unless there is no event-based alternative.
- Prefer direct, inline importer code for small one-off GUI flows. Do not extract tiny helpers just to avoid a few repeated lines when the call-site behavior is clearer inline.
- Notes live on list items, not inside editors.
- Conditions assume invert support on every editor; actions do not share that rule.
- Action sync order is intentionally delete -> edit -> move -> add.
- Item import caching is stateful and map-specific; be careful when debugging “why didn’t this re-import?”.

## User Collaboration Preferences

- Give short progress updates while working, especially before edits, builds, installs, or when a new finding changes the implementation plan.
- Be direct about what changed and why. Avoid vague reassurance.

## Likely Future Work Areas

The biggest unfinished areas in `ct_module` are:

- action writer coverage for most action types,
- condition item-selection writing,
- broader exporter coverage beyond functions,
- stronger simulator parity with Housing behavior,
- tests for diff/sync behavior inside `ct_module` itself.

If you are picking a place to improve the project, `ct_module/src/importer/actions.ts` and `ct_module/src/importer/actions/diff.ts` are the highest leverage files.
