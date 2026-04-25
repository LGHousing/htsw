# Adding a New Action

When Hypixel adds a new action to Housing, it has to be wired through the parser, printer, types, GUI importer, and (sometimes) simulator + tests. This is the checklist.

The action's identifier is its discriminated-union tag — `SCREAMING_SNAKE_CASE` (e.g. `MESSAGE`, `CHANGE_VAR`, `TELEPORT`). The Housing-facing display name is whatever the GUI shows (e.g. `"Send a Chat Message"`). The HTSL keyword is the lowercase word users type (e.g. `chat`, `var`, `tp`).

## TL;DR — minimum viable action

To get a brand-new action parsing, printing, and importing into Housing you need to touch **seven** files. Skipping any of these means the action either doesn't compile, doesn't parse, doesn't print, or silently does nothing in the GUI.

| # | File | What to add |
|---|---|---|
| 1 | `language/src/types/actions.ts` | A `type ActionFoo = { type: "FOO"; ... }` and a new arm in the `Action` union. |
| 2 | `language/src/types/constants.ts` | An entry in `ACTION_NAMES` mapping `FOO` → Housing display name. |
| 3 | `language/src/types/actionSpecs.ts` | A row in `ACTION_SPECS` describing the keyword and the field list. |
| 4 | `language/src/htsl/parse/actions.ts` | A keyword branch in `parseAction` plus a `parseActionFoo` body. |
| 5 | `language/src/htsl/print/actions.ts` | A `case "FOO":` arm in `printActionHead`. |
| 6 | `ct_module/src/importer/actionMappings.ts` | An entry in `ACTION_MAPPINGS` with `displayName` and `loreFields`. |
| 7 | `ct_module/src/importer/actions.ts` | A spec in `ACTION_SPECS` (read/write functions, or an empty `{}` for zero-field add-and-return actions). |

The TypeScript compiler will yell at you for **#1, #2, #5, #6, and #7** if you forget them — those use required mapped types over `Action["type"]` (or, for #5, an exhaustive switch with a `never` tripwire). The two silent gaps in the required list are **#3** (`actionSpecs.ts` is a flat `ActionSpec[]` array) and **#4** (the parser's keyword dispatch chain). See the [Compiler-enforced vs. silent gaps](#compiler-enforced-vs-silent-gaps) section below for why those two haven't been tightened.

## Detailed checklist

### Language package — required

These define what the AST looks like and how source flows in/out of it. All of them are TS-enforced or load-bearing for the parser/printer to compile.

#### 1. `language/src/types/actions.ts`

Define the action shape and add it to the union.

```ts
export type ActionFoo = {
    type: "FOO";
    bar: string;
    baz?: number;       // mark optional fields with `?`
    note?: string;       // every action gets `note?: string` implicitly via the union
};

export type Action =
    | ActionMessage
    | ActionChangeVar
    | ActionFoo            // ← add here
    | ...
```

If the action has nested action lists (like `CONDITIONAL.ifActions`), use `Action[]` and remember the importer's diff engine in `ct_module/src/importer/actions/diff.ts` will recurse into it via `getNestedListFields`.

#### 2. `language/src/types/constants.ts`

Add the Housing display name. The mapped type `{ [key in Action["type"]]: string }` will refuse to compile until every variant has an entry, so this is the easiest forgotten step to spot.

```ts
export const ACTION_NAMES: { [key in Action["type"]]: string } = {
    ...,
    FOO: "Do The Foo Thing",
};
```

#### 3. `language/src/types/actionSpecs.ts`

The single source of truth for editor completions. One row per HTSL keyword, fields in parser-consumption order.

```ts
{
    kw: "foo",                                  // what the user types in .htsl
    fields: [
        f("bar", "string"),
        f("baz", "number", true),               // 3rd arg = optional
    ],
},
```

`ActionFieldKind` is a closed union (`"value" | "varName" | "boolean" | ...`) — pick the closest match or extend the union if your field doesn't fit. Editor snippets, hover tooltips, and (eventually) inlay hints all derive from this row.

#### 4. `language/src/htsl/parse/actions.ts`

Two changes here: a dispatch branch in `parseAction` and a body function.

```ts
// dispatch
if (p.eatKw("foo", true)) return parseActionFoo(p);

// body
function parseActionFoo(p: Parser): ActionFoo {
    const action = { type: "FOO" } as ActionFoo;
    setField(p, action, "bar", parseString);
    setField(p, action, "baz", () => p.parseBoundedNumber(0, 100), { optional: true });
    return action;
}
```

Use `setField` (it wires up source spans for diagnostics). Argument helpers live in `parse/arguments.ts` — `parseValue`, `parseString`, `parseBoolean`, `parseNumericValue`, `parseLocation`, etc. Match the kind you used in `actionSpecs.ts`.

#### 5. `language/src/htsl/print/actions.ts`

Add a `case "FOO":` to the `switch (action.type)` in `printActionHead`. This switch is exhaustive — TS will error out (`Type 'never' has no...`) if you miss a case.

```ts
case "FOO":
    return `foo ${quoteStringOrPlaceholder(action.bar)}` +
        (action.baz !== undefined ? ` ${printNumber(action.baz)}` : "");
```

Use the helpers in `print/helpers.ts` — `quoteName` for var/function names, `quoteStringOrPlaceholder` for string fields that allow bare placeholders, `quoteString` when you must always quote, etc.

If your action has nested action lists (like `CONDITIONAL`), call `printActionList(action.inner, depth + 1, ctx)` and wrap with `{ ... }` block syntax — see the `CONDITIONAL` arm for the pattern.

### CT module — required for GUI sync

Without these the action will parse and print fine but `/import` will silently skip it (or worse, throw mid-import).

#### 6. `ct_module/src/importer/actionMappings.ts`

Add an entry to `ACTION_MAPPINGS`:

```ts
FOO: {
    displayName: "Do The Foo Thing",      // must match ACTION_NAMES exactly
    loreFields: {
        "Bar":  { prop: "bar",  kind: "value" },
        "Baz":  { prop: "baz",  kind: "value" },
    },
},
```

The keys of `loreFields` are the **GUI label** strings as they appear in the Housing item lore (`"Bar:"` minus the colon). `prop` is the AST field name. `kind` is one of `"boolean" | "value" | "cycle" | "select" | "item" | "nestedList"` and drives both observation parsing and selective comparison cost — see the `UiFieldKind` type and `parseFieldValue` in `importer/loreParsing.ts`.

If you have nested action lists, use `kind: "nestedList"` and the importer will pick them up via `getNestedListFields`.

#### 7. `ct_module/src/importer/actions.ts`

Add an entry to `ACTION_SPECS`. Three shapes:

```ts
// (a) zero-field action (KILL, HEAL, RESET_INVENTORY, etc.) — empty spec
FOO: {},

// (b) editor-opens-on-click action — implement read and write
FOO: {
    read: async (ctx, action) => {
        // read in-menu fields that lore alone can't see (most actions DON'T need this)
    },
    write: async (ctx, action) => {
        await setStringValue(ctx, ctx.getItemSlot("Bar"), action.bar);
        if (action.baz !== undefined) {
            await setNumberValue(ctx, ctx.getItemSlot("Baz"), action.baz);
        }
        // every write function ends with the editor open; the importer
        // calls clickGoBack afterward
    },
},
```

If you only define `write`, the importer assumes the action opens an editor when added/edited and clicks `Go Back` for you. If you define neither (case (a)), the action is treated as add-and-return — just inserted at the end of the list with no editor interaction.

For nested action lists, use `syncActionList(ctx, action.inner)` inside `write` after navigating into the nested editor — see `CONDITIONAL` and `RANDOM` for examples.

### Optional but strongly recommended

These don't block GUI sync but will leave gaps in tooling.

#### Test fixtures (`language/test/cases/actions/`)

Add a fixture file (`foo.htsl`) covering canonical syntax. The `parseAndGenerate.test.ts` round-trip suite will automatically include it and verify parse → print → parse fixed-point.

#### Runtime simulator behavior (`language/src/runtime/behaviors/actions.ts`)

If you want the action to *do something* in the local simulator (`/sim` command):

```ts
.with("FOO", async (ctx, action) => {
    // call ctx.player APIs to mutate state
})
```

Without this, the simulator runs the action as a no-op. Fine for actions whose behavior can't reasonably be modeled outside Housing (e.g. `SET_COMPASS_TARGET`, `APPLY_INVENTORY_LAYOUT`).

#### CT-module simulator behavior (`ct_module/src/simulator/actions.ts`)

The CT-side simulator has its own behavior registry — it's the one that actually runs inside Minecraft when the user does `/sim start`. Same shape as the language one but uses CT-specific Player APIs (titles, sounds, teleport packets, etc.). Worth wiring if the action has Minecraft-side effects.

### Optional (rarely needed)

#### `editors/code/src/completions.ts`

The completion machinery auto-generates a snippet from `ACTION_SPECS`. **You only need to add to `ACTION_SNIPPETS` here if your action has syntax the spec format can't express** — currently that's just `if` (needs `( ... ) { ... }` block syntax) and `tp` (defaults to `custom_coordinates` mode). A regular keyword + space-separated args needs no completion override.

#### `language/src/check/passes/`

Only if your action has semantic constraints beyond syntax — e.g. `CHANGE_VAR` validating that the operation matches the value type, or item-bearing actions checking the NBT shape (`checkNbt.ts`). Most actions don't need a check pass.

## Compiler-enforced vs. silent gaps

If you're going through this list and rely on `tsc` to catch your mistakes, these are the spots where the compiler **will** stop you (all use a required mapped type `{ [K in Action["type"]]: ... }` over the closed union, or an exhaustive switch with a `never` tripwire):

- `language/src/types/constants.ts:ACTION_NAMES` — required mapped type.
- `language/src/htsl/print/actions.ts:printActionHead` switch — exhaustive `default` arm with `const _: never = action`.
- `ct_module/src/importer/actionMappings.ts:ACTION_MAPPINGS` — `satisfies { [K in Action["type"]]: ... }` (required).
- `ct_module/src/importer/actions.ts:ACTION_SPECS` — `satisfies ActionSpecMap` where `ActionSpecMap = { [K in Action["type"]]: ActionSpec<Extract<Action, { type: K }>> }`.

These are the spots where TS **won't** catch a missing entry — keep these on the manual checklist:

- `language/src/types/actionSpecs.ts:ACTION_SPECS` — `readonly ActionSpec[]`, just a flat array of `{ kw, fields }` rows. The `kw` is a string with no link to `Action["type"]`, so there's no exhaustiveness check. (Could be tightened, but the file mixes action and condition keywords plus shorthand aliases like `var`/`stat`/`globalvar`, so making it `Action["type"]`-keyed isn't a one-line fix.)
- `language/src/htsl/parse/actions.ts:parseAction` — keyword-driven `if (eatKw(...))` chain. There's no compile-time way to enforce coverage without making `actionSpecs.ts` the source of truth and generating the dispatch from it.
- `language/src/runtime/behaviors/actions.ts` and `ct_module/src/simulator/actions.ts` — both use `Behaviors<Action, void>` which is intentionally `Partial`. Forcing every variant would mean shipping ~35 stub behaviors that throw "not implemented" — worse than the current "silently no-op" because it'd block `/sim` runs of any program containing an unimplemented action.
- Test fixtures.

## Same picture for conditions

Everything above translates 1:1 to `Condition`:

- `CONDITION_NAMES`, printer's condition switch, `CONDITION_MAPPINGS`, and importer `CONDITION_SPECS` all use the same required-mapped-type pattern → all compiler-enforced.
- `actionSpecs.ts` covers conditions too (entries like `hasGroup`, `inRegion`, `isFlying`) with the same lack of exhaustiveness — same caveat.
- `parse/conditions.ts` is the same keyword-driven dispatch — same caveat.
- Behaviors: same `Partial` registry pattern — same caveat.

So when adding a new condition, mirror this guide with `Condition` substituted for `Action`. The seven required files are:

| Action file | Condition equivalent |
|---|---|
| `language/src/types/actions.ts` | `language/src/types/conditions.ts` |
| `language/src/types/constants.ts` (`ACTION_NAMES`) | same file (`CONDITION_NAMES`) |
| `language/src/types/actionSpecs.ts` | same file (entries are mixed in, just add a row) |
| `language/src/htsl/parse/actions.ts` | `language/src/htsl/parse/conditions.ts` |
| `language/src/htsl/print/actions.ts` | `language/src/htsl/print/conditions.ts` |
| `ct_module/src/importer/actionMappings.ts` | `ct_module/src/importer/conditionMappings.ts` |
| `ct_module/src/importer/actions.ts` (`ACTION_SPECS`) | `ct_module/src/importer/conditions.ts` (`CONDITION_SPECS`) |

The two condition-specific quirks worth knowing (called out in `CLAUDE.md` too):

- Every condition editor is assumed to expose an `Inverted` toggle. Writers don't need to handle invert manually — `setOpenConditionInverted` is called centrally.
- Conditions don't have move/reorder operations in the diff engine — the differ deletes/edits/adds rather than preserving order. So nested-list cost-of-move logic in `actions/diff.ts` doesn't have a condition equivalent.

## Quick "did I forget anything?" grep

After adding `FOO`:

```bash
# every spot that mentions an existing action should also mention yours
grep -rn "CHANGE_VAR" language/src ct_module/src editors --include="*.ts" | wc -l
grep -rn "FOO"        language/src ct_module/src editors --include="*.ts" | wc -l
```

The two counts should be in the same ballpark (CHANGE_VAR has nested-list-style writers so it'll be a few higher; bare actions like `KILL` are a useful baseline). A `FOO` count under 5 means you skipped something.
