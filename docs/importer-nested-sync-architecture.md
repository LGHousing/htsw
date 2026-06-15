# Importer Nested Sync Architecture Note

> **Status — historical design note.** Since this was written, the sync layer moved to a plan/apply model: there is no longer a `syncActionList`/`syncConditionList` or `actions/sync.ts`. The live code is `housingSync/actions/plan.ts` (`prereadActionList` = read + diff) and `housingSync/actions/applyDiff.ts` (`applyActionListPlan`, which recurses into nested lists itself). Read this for the *intent*; read those files for current behavior.

## Problem

Action writers currently do more than write scalar fields in an open Housing action editor. `writeConditional` and `writeRandom` also open nested list menus and call `syncActionList` / `syncConditionList` directly.

That forces GUI writers to know about importer orchestration details:

- action path string construction, such as `4.ifActions`
- progress scope offsets
- import event emission for live preview
- baseline reuse wiring for nested sync

The nested action/condition data belongs to the `Action` value, but progress paths and live-preview addressing belong to the sync/apply layer. Letting writers know both makes `WriteActionOptions` a mixed abstraction.

## Preferred Next Step

Replace `pathPrefix`, `nestedProgressScope`, and direct nested `syncActionList` / `syncConditionList` calls inside action writers with a nested-sync helper passed through `WriteActionOptions`.

The writer should say what nested field it needs synced:

```ts
await options?.nested?.actions("ifActions", {
    desired: action.ifActions,
    observed: current?.ifActions,
    offset,
});
```

The sync/apply layer should own how that request maps to importer mechanics:

```ts
nested.actions("ifActions", args) {
    const nestedPath = actionPathForNestedProp(parentPath, "ifActions");

    return syncActionList(ctx, args.desired, {
        observed: reuseObservedActions(args.observed),
        pathPrefix: nestedPath,
        progressScope: nestedProgressScope(nestedPath, args.offset),
        events,
    });
}
```

This keeps the GUI writer responsible for opening the correct Housing submenu and describing the nested field, while keeping action paths, progress scopes, and live-preview events in importer orchestration.

## Larger Option

A later, larger cleanup could move nested-list handling into action specs:

```ts
nested: [
    { prop: "conditions", kind: "conditions", fieldLabel: "Conditions" },
    { prop: "ifActions", kind: "actions", fieldLabel: "If Actions" },
    { prop: "elseActions", kind: "actions", fieldLabel: "Else Actions" },
]
```

Then a generic nested-list coordinator could drive CONDITIONAL/RANDOM nested sync, leaving action writers closer to pure scalar field writers. That is cleaner, but it is a bigger refactor than the first step.

