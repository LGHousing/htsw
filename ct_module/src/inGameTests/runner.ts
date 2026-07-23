import type { Action, Condition, Importable, ImportableMenu } from "htsw/types";

import TaskContext from "../tasks/context";
import { getCurrentHousingUuid } from "../importCache";
import {
    buildTrustPlan,
    deleteImportableCache,
    importableHash,
    readImportableCache,
} from "../importCache";
import { importableCanonicalParts } from "../importCache/hash";
import { importableIdentity, importableKey } from "../importables/identity";
import { createProjectItemIndex } from "../importables/items/projectItems";
import { createItemDependencyIndex } from "../importables/items/dependencyIndex";
import { createItemFieldResolver } from "../importables/items/resolveItem";
import {
    orderImportablesForSession,
    runImportSession,
} from "../importables/import/session";
import {
    readImportablePlan,
    type ImportablePlan,
    type ImportablePlanDetails,
} from "../importables/import/importers";
import type { ImportContext } from "../importables/import/context";
import { createImportedItemPlacementSession } from "../housingSync/items/heldItem";
import { listAllFunctionNames } from "../importables/functions/listFunctions";
import { resetFunctionNameSession } from "../importables/functions/listFunctions";
import {
    listAllCommandNames,
    resetCommandNameSession,
} from "../importables/commands/listCommands";
import {
    HOUSE_READERS,
    HOUSE_READABLE_TYPES,
} from "../importables/export/readers";
import { deleteTeam } from "../importables/teams/listTeams";
import { deleteGroup } from "../importables/groups/listGroups";
import { createNpcLookupCache } from "../importables/npcs/listNpcs";
import { listAllRegionNames } from "../importables/regions/listRegions";
import { listAllMenuNames, resetMenuNameSession } from "../importables/menus/listMenus";
import type { SyncEventHandler } from "../housingSync/syncEvents";
import type {
    ActionListOperation,
    ConditionListOperation,
    ChildListDiff,
} from "../housingSync/actions/diff/types";
import {
    HOTBAR_ZERO_PACKET_SLOT,
    SET_SLOT_ACK_TIMEOUT_MS,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "../housingSync/menus/packets";
import { ItemCaptureRegistry } from "../importables/items/captureRegistry";
import {
    restorePlayerInventory,
    snapshotPlayerInventory,
} from "../housingSync/items/playerInventory";
import { gmcOnImportStart, waitForCreativeMode } from "../housingSync/sideEffects";
import { getTaskTracePath, setTaskTraceEnabled } from "../housingSync/trace/taskTrace";
import { projectItemsFromParsedImportJson } from "../importables/export/projectDestination";
import { loadTestFixtures, type ParsedTestFixture } from "./fixtures";
import { coverageForFixtures, emitCoverageReport } from "./report";

type FixtureResult = {
    fixture: ParsedTestFixture;
    passed: boolean;
    failures: string[];
};

export async function runLiveTestSuite(ctx: TaskContext, slice?: string): Promise<void> {
    const fixtures = loadTestFixtures(slice);
    if (fixtures.length === 0) {
        ctx.displayMessage("&c[htsw test] no fixtures matched.");
        return;
    }
    if (hasParseFailures(ctx, fixtures)) return;

    // The suite is the diagnostic harness for intermittent importer hangs, so
    // every run leaves a post-mortem trace whether or not it failed — there's
    // no "turn it on first, then reproduce" step to forget.
    const tracePath = setTaskTraceEnabled(true);
    ctx.displayMessage(`&7[htsw test] task trace → &f${tracePath}`);
    try {
        gmcOnImportStart();
        if (!(await waitForCreativeMode(ctx))) {
            ctx.displayMessage(
                "&e[htsw test] Still not in creative after /gmc; region and item tests may fail."
            );
        }

        const housingUuid = await getCurrentHousingUuid(ctx);
        ctx.displayMessage(`&7[htsw test] house &f${housingUuid}`);
        if (!(await assertHouseStartsEmpty(ctx))) return;

        const results: FixtureResult[] = [];
        for (let i = 0; i < fixtures.length; i++) {
            const result = await runFixture(ctx, housingUuid, fixtures[i]);
            results.push(result);
            if (!result.passed) {
                ctx.displayMessage("&c[htsw test] aborting after failed fixture.");
                break;
            }
        }

        emitResultSummary(ctx, results);
        const coveredFixtures = results.map((result) => result.fixture);
        emitCoverageReport(
            (message) => ctx.displayMessage(message),
            coverageForFixtures(coveredFixtures),
            coveredFixtures.length
        );
    } finally {
        setTaskTraceEnabled(false);
        ctx.displayMessage(`&7[htsw test] trace saved → &f${getTaskTracePath()}`);
    }
}

async function runFixture(
    ctx: TaskContext,
    housingUuid: string,
    fixture: ParsedTestFixture
): Promise<FixtureResult> {
    const failures: string[] = [];
    const importFailures: string[] = [];
    const events = createSuiteEventHandler(importFailures);

    ctx.displayMessage(`&7[htsw test] running &f${fixture.id}`);
    try {
        await runImportSession(ctx, {
            importables: fixture.parsed.value,
            trustMode: false,
            housingUuid,
            sourcePath: fixture.importJsonPath,
            parsed: fixture.parsed,
            events,
        });
        for (let i = 0; i < importFailures.length; i++) {
            failures.push(importFailures[i]);
        }
        if (failures.length === 0) {
            const verifyFailures = await verifyFixture(ctx, housingUuid, fixture);
            for (let i = 0; i < verifyFailures.length; i++) {
                failures.push(verifyFailures[i]);
            }
        }
        if (failures.length === 0) {
            const trustFailures = await trustModeVerifyFixture(ctx, housingUuid, fixture);
            for (let i = 0; i < trustFailures.length; i++) {
                failures.push(trustFailures[i]);
            }
        }
        if (failures.length === 0) {
            const readFailures = await deepReadVerifyFixture(ctx, housingUuid, fixture);
            for (let i = 0; i < readFailures.length; i++) {
                failures.push(readFailures[i]);
            }
        }
    } catch (e) {
        failures.push(String(e));
    } finally {
        try {
            await cleanupFixture(ctx, housingUuid, fixture);
            const cleanupFailures = await cleanupResiduals(ctx);
            for (let i = 0; i < cleanupFailures.length; i++) {
                failures.push(cleanupFailures[i]);
            }
        } catch (e) {
            failures.push(`cleanup failed: ${String(e)}`);
        }
    }

    const passed = failures.length === 0;
    ctx.displayMessage(
        passed
            ? `&a[htsw test] PASS &f${fixture.id}`
            : `&c[htsw test] FAIL &f${fixture.id}`
    );
    for (let i = 0; i < failures.length; i++) {
        ctx.displayMessage(`&c[htsw test]   ${failures[i]}`);
    }
    return { fixture, passed, failures };
}

async function verifyFixture(
    ctx: TaskContext,
    housingUuid: string,
    fixture: ParsedTestFixture
): Promise<string[]> {
    resetFunctionNameSession();
    resetCommandNameSession();
    resetMenuNameSession();
    const ordered = orderImportablesForSession(
        fixture.parsed.value,
        fixture.parsed.value
    );
    const itemCaptures = createFixtureItemCaptures(fixture);
    const session = fixtureImportContext(
        fixture,
        housingUuid,
        buildTrustPlan(housingUuid, ordered, false),
        itemCaptures
    );

    const failures: string[] = [];
    const inventorySnapshot = snapshotPlayerInventory();
    try {
        for (let i = 0; i < ordered.length; i++) {
            const importable = ordered[i];
            const plan = await readImportablePlan(ctx, importable, session);
            const residuals = residualPlanOperations(plan);
            for (let j = 0; j < residuals.length; j++) {
                failures.push(
                    `${importable.type} ${importableIdentity(importable)}: ${residuals[j]}`
                );
            }
        }
    } finally {
        try {
            await restorePlayerInventory(ctx, inventorySnapshot);
        } catch (e) {
            failures.push(`inventory restore failed: ${String(e)}`);
        }
    }
    return failures;
}

// Deep-read verification: wipe each importable's cache entry, re-read it from
// the live house through the reader in read-only mode, and require the
// reader-written entry to hash-match the fixture source — the same comparison
// the GUI's drift status makes, so a reader that stores a different shape than
// the parse (menu slot nbt, command defaults) fails here.
async function deepReadVerifyFixture(
    ctx: TaskContext,
    housingUuid: string,
    fixture: ParsedTestFixture
): Promise<string[]> {
    const failures: string[] = [];
    const importables = fixture.parsed.value;
    const rootDir = fixture.importJsonPath
        .split("\\")
        .join("/")
        .replace(/\/[^/]*$/, "");

    for (let t = 0; t < HOUSE_READABLE_TYPES.length; t++) {
        const type = HOUSE_READABLE_TYPES[t];
        const reader = HOUSE_READERS[type];
        const items: Importable[] = [];
        for (let i = 0; i < importables.length; i++) {
            if (importables[i].type === type) items.push(importables[i]);
        }
        if (items.length === 0) continue;

        const names: string[] = [];
        for (let i = 0; i < items.length; i++) {
            const identity = importableIdentity(items[i]);
            names.push(identity);
            deleteImportableCache(housingUuid, type, identity);
        }

        ctx.displayMessage(
            `&7[htsw test] deep-read verify &f${type.toLowerCase()}&7 (${items.length})`
        );
        const result = await reader(ctx, {
            importJsonPath: fixture.importJsonPath,
            rootDir,
            names,
            // Seed item captures with the fixture's declared items so an item
            // read back from the house resolves to its project name instead of
            // minting a fresh one (which would fail the hash comparison).
            projectItems: projectItemsFromParsedImportJson(fixture.parsed),
            output: { kind: "cache", housingUuid },
        });
        if (result.failed > 0) {
            failures.push(
                `${type} deep read: ${result.failed} of ${result.total} failed`
            );
        }

        for (let i = 0; i < items.length; i++) {
            const identity = importableIdentity(items[i]);
            const entry = readImportableCache(housingUuid, type, identity);
            if (entry === null) {
                failures.push(`${type} ${identity}: deep read wrote no cache entry`);
                continue;
            }
            if (importableHash(entry.importable) !== importableHash(items[i])) {
                const diffKeys = hashDiffKeys(items[i], entry.importable);
                failures.push(
                    `${type} ${identity}: deep-read cache differs from source (keys: ${diffKeys.join(", ")})`
                );
                appendHashDiffDetail(
                    type,
                    identity,
                    items[i],
                    entry.importable,
                    diffKeys
                );
                ctx.displayMessage(
                    `&7[htsw test] full canonical diff → &f${HASH_DIFF_LOG}`
                );
            }
        }
    }
    return failures;
}

// Trust-mode verification for the real edit-source-then-import loop. It runs
// against the importer-written cache (the source itself), never a house read,
// so it mirrors how menus are actually developed. Two invariants per menu:
// re-importing the unchanged source is a whole-trusted no-op (the hash skip
// decision and buildMenuDiff agree nothing changed), and a source with one
// mutated slot is detected by the hash and produces exactly one op for that
// slot. This is the menu counterpart to the function trust coverage in
// trust.test.ts.
async function trustModeVerifyFixture(
    ctx: TaskContext,
    housingUuid: string,
    fixture: ParsedTestFixture
): Promise<string[]> {
    resetMenuNameSession();
    const failures: string[] = [];
    const importables = fixture.parsed.value;
    for (let i = 0; i < importables.length; i++) {
        const menu = importables[i];
        if (menu.type !== "MENU") continue;

        const session = trustModeSessionFor(housingUuid, fixture, [menu]);
        const trust = session.actions.trust.importables.get(
            importableKey("MENU", importableIdentity(menu))
        );
        if (trust === undefined || !trust.wholeImportableTrusted) {
            failures.push(
                `menu ${menu.name}: re-importing the unchanged source is not whole-trusted`
            );
        }
        const plan = await readImportablePlan(ctx, menu, session);
        const residuals = residualPlanOperations(plan);
        for (let j = 0; j < residuals.length; j++) {
            failures.push(
                `menu ${menu.name}: trusted re-import wants to write ${residuals[j]}`
            );
        }

        if (menu.slots.length === 0) continue;
        const targetSlot = menu.slots[0].slot;
        const itemFailures = await expectSingleMenuSlotOp(
            ctx,
            housingUuid,
            fixture,
            mutateMenuSlotItem(menu, 0),
            targetSlot,
            "item"
        );
        for (let j = 0; j < itemFailures.length; j++) failures.push(itemFailures[j]);
        const actionFailures = await expectSingleMenuSlotOp(
            ctx,
            housingUuid,
            fixture,
            mutateMenuSlotActions(menu, 0),
            targetSlot,
            "actions"
        );
        for (let j = 0; j < actionFailures.length; j++) failures.push(actionFailures[j]);
    }
    return failures;
}

function trustModeSessionFor(
    housingUuid: string,
    fixture: ParsedTestFixture,
    importables: Importable[]
): ImportContext {
    return fixtureImportContext(
        fixture,
        housingUuid,
        buildTrustPlan(housingUuid, importables, true),
        createFixtureItemCaptures(fixture)
    );
}

function fixtureImportContext(
    fixture: ParsedTestFixture,
    housingUuid: string,
    trust: ReturnType<typeof buildTrustPlan>,
    captures: ItemCaptureRegistry
): ImportContext {
    const items = createProjectItemIndex(fixture.parsed.value, fixture.parsed.gcx);
    const itemDependencies = createItemDependencyIndex(fixture.parsed.value, items);
    return {
        items,
        itemDependencies,
        itemPlacement: createImportedItemPlacementSession(),
        parsed: fixture.parsed,
        housingUuid,
        npcLookup: createNpcLookupCache(),
        ensuredReferencedShells: {
            functions: new Set(),
            menus: new Set(),
            regions: new Set(),
        },
        actions: {
            canonicalizeItemName: (name) => items.canonicalizeObservedName(name),
            resolveItem: createItemFieldResolver(items, itemDependencies, housingUuid),
            trust,
            conflicts: [],
            events: undefined,
            itemRead: { mode: "verify", captures },
        },
    };
}

async function expectSingleMenuSlotOp(
    ctx: TaskContext,
    housingUuid: string,
    fixture: ParsedTestFixture,
    mutated: ImportableMenu,
    targetSlot: number,
    mode: "item" | "actions"
): Promise<string[]> {
    const failures: string[] = [];
    const session = trustModeSessionFor(housingUuid, fixture, [mutated]);
    const trust = session.actions.trust.importables.get(
        importableKey("MENU", importableIdentity(mutated))
    );
    if (trust !== undefined && trust.wholeImportableTrusted) {
        failures.push(
            `menu ${mutated.name}: a ${mode} change went undetected — the hash still whole-trusts it, so trust mode would skip a real change`
        );
    }

    const plan = await readImportablePlan(ctx, mutated, session);
    if (plan.kind !== "MENU") {
        failures.push(`menu ${mutated.name}: expected a MENU plan`);
        return failures;
    }
    const ops = plan.details.diff.ops;
    if (ops.length !== 1) {
        const touched = ops.map((op) => op.slot).join(", ");
        failures.push(
            `menu ${mutated.name}: a single ${mode} change produced ${ops.length} ops (slots: ${touched}), expected exactly 1`
        );
        return failures;
    }

    const op = ops[0];
    if (op.slot !== targetSlot) {
        failures.push(
            `menu ${mutated.name}: ${mode} change wrote slot ${op.slot}, expected only slot ${targetSlot}`
        );
    }
    if (mode === "item") {
        if (op.setItem === undefined) {
            failures.push(`menu ${mutated.name}: item change produced no item write`);
        }
        if (op.syncActions !== undefined) {
            failures.push(
                `menu ${mutated.name}: item change also rewrote the slot's actions`
            );
        }
    } else {
        if (op.syncActions === undefined) {
            failures.push(
                `menu ${mutated.name}: actions change produced no action write`
            );
        }
        if (op.setItem !== undefined) {
            failures.push(
                `menu ${mutated.name}: actions change also rewrote the slot's item`
            );
        }
    }
    return failures;
}

// Deep-clone the menu and swap one slot's item id, so the trusted diff must see
// exactly one item change against the cached copy.
function mutateMenuSlotItem(menu: ImportableMenu, slotIndex: number): ImportableMenu {
    const clone = JSON.parse(JSON.stringify(menu)) as ImportableMenu;
    const nbt = clone.slots[slotIndex].nbt as {
        value?: Partial<Record<string, { type: string; value: unknown }>>;
    };
    const currentId =
        nbt.value !== undefined && typeof nbt.value.id?.value === "string"
            ? nbt.value.id.value
            : "";
    const swappedId =
        currentId === "minecraft:diamond" ? "minecraft:stone" : "minecraft:diamond";
    if (nbt.value !== undefined) {
        nbt.value.id = { type: "string", value: swappedId };
    }
    return clone;
}

// Deep-clone the menu and prepend one action to a slot, so the trusted diff
// must see exactly one actions change against the cached copy.
function mutateMenuSlotActions(menu: ImportableMenu, slotIndex: number): ImportableMenu {
    const clone = JSON.parse(JSON.stringify(menu)) as ImportableMenu;
    const slot = clone.slots[slotIndex];
    const probe: Action = { type: "MESSAGE", message: "htsw trust probe" };
    slot.actions = [probe, ...(slot.actions ?? [])];
    return clone;
}

const HASH_DIFF_LOG = "./htsw/test-hash-diff.log";

function canonicalPartsByKey(importable: Importable): Partial<Record<string, string>> {
    const parts = importableCanonicalParts(importable);
    const byKey: Partial<Record<string, string>> = {};
    for (let i = 0; i < parts.length; i++) byKey[parts[i].key] = parts[i].serialized;
    return byKey;
}

function hashDiffKeys(source: Importable, cached: Importable): string[] {
    const a = canonicalPartsByKey(source);
    const b = canonicalPartsByKey(cached);
    const keys: string[] = [];
    for (const key in a) {
        if (b[key] !== a[key]) keys.push(key);
    }
    for (const key in b) {
        if (a[key] === undefined) keys.push(key);
    }
    return keys;
}

function appendHashDiffDetail(
    type: string,
    identity: string,
    source: Importable,
    cached: Importable,
    diffKeys: string[]
): void {
    const a = canonicalPartsByKey(source);
    const b = canonicalPartsByKey(cached);
    const lines: string[] = [
        `=== ${type} ${identity} — differing keys: ${diffKeys.join(", ")}`,
    ];
    for (let i = 0; i < diffKeys.length; i++) {
        const key = diffKeys[i];
        lines.push(`--- ${key}`);
        lines.push(`source: ${a[key] ?? "(absent)"}`);
        lines.push(`house:  ${b[key] ?? "(absent)"}`);
    }
    const text = lines.join("\n") + "\n";
    try {
        FileLib.append(HASH_DIFF_LOG, text);
    } catch (_e) {
        FileLib.write(HASH_DIFF_LOG, text, true);
    }
}

function createFixtureItemCaptures(fixture: ParsedTestFixture): ItemCaptureRegistry {
    const captures = new ItemCaptureRegistry("live");
    const importables = fixture.parsed.value;
    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        if (importable.type !== "ITEM") continue;
        captures.seedNbtOnly(importable.name, importable.nbt);
    }
    return captures;
}

function residualPlanOperations(wrapped: ImportablePlan): string[] {
    const plan = wrapped.details;
    switch (plan.kind) {
        case "FUNCTION": {
            const failures = actionPlanFailures("actions", plan.actionsPlan);
            const settingsFailures = functionSettingsPlanFailures(plan);
            for (let i = 0; i < settingsFailures.length; i++) {
                failures.push(settingsFailures[i]);
            }
            return failures;
        }
        case "EVENT":
            return actionPlanFailures("actions", plan.actionsPlan);
        case "COMMAND": {
            const failures = actionPlanFailures("actions", plan.actionsPlan);
            if (!plan.settingsHandled) failures.push("settings differ");
            return failures;
        }
        case "REGION": {
            const failures: string[] = [];
            if (plan.liveRegion === null) {
                failures.push("region is missing");
            } else if (!plan.boundsMatch) {
                failures.push("bounds differ");
            }
            const enterFailures = actionPlanFailures("onEnterActions", plan.enterPlan);
            for (let i = 0; i < enterFailures.length; i++)
                failures.push(enterFailures[i]);
            const exitFailures = actionPlanFailures("onExitActions", plan.exitPlan);
            for (let i = 0; i < exitFailures.length; i++) failures.push(exitFailures[i]);
            return failures;
        }
        case "MENU": {
            const diff = (
                plan as {
                    diff: {
                        setSize: number | null;
                        ops: Array<{
                            slot: number;
                            setItem?: unknown;
                            syncActions?: Action[];
                            clear?: boolean;
                            itemCompare?: { read: string; desired: string };
                        }>;
                    };
                }
            ).diff;
            const failures: string[] = [];
            if (diff.setSize !== null) failures.push(`size differs: ${diff.setSize}`);
            for (const op of diff.ops) {
                const parts: string[] = [];
                if (op.clear) parts.push("clear");
                if (op.setItem !== undefined) {
                    parts.push(
                        op.itemCompare !== undefined
                            ? `item: read=${op.itemCompare.read} want=${op.itemCompare.desired}`
                            : "item differs"
                    );
                }
                if (op.syncActions !== undefined) {
                    parts.push(
                        `actions differ (desired: ${op.syncActions.map((a) => a.type).join(", ")})`
                    );
                }
                failures.push(
                    `slot ${op.slot}: ${parts.length > 0 ? parts.join("; ") : "?"}`
                );
            }
            return failures;
        }
        case "ITEM":
            return [];
        case "NPC": {
            const failures: string[] = [];
            if (!plan.nameHandled) failures.push("name differs");
            if (!plan.leftClickRedirectHandled)
                failures.push("leftClickRedirect differs");
            const leftFailures = actionPlanFailures("leftClickActions", plan.leftPlan);
            for (let i = 0; i < leftFailures.length; i++) failures.push(leftFailures[i]);
            const rightFailures = actionPlanFailures("rightClickActions", plan.rightPlan);
            for (let i = 0; i < rightFailures.length; i++)
                failures.push(rightFailures[i]);
            return failures;
        }
        case "TEAM": {
            const failures: string[] = [];
            if (!plan.exists) failures.push("team is missing");
            if (!plan.tagHandled) failures.push("tag differs");
            if (!plan.colorHandled) failures.push("color differs");
            if (!plan.friendlyFireHandled) failures.push("friendly fire differs");
            return failures;
        }
        case "GROUP": {
            const failures: string[] = [];
            if (!plan.exists) failures.push("group is missing");
            if (!plan.tagHandled) failures.push("tag differs");
            if (!plan.tagShownInChatHandled) failures.push("tag-in-chat differs");
            if (!plan.colorHandled) failures.push("color differs");
            if (!plan.priorityHandled) failures.push("priority differs");
            if (!plan.permissionsHandled) failures.push("permissions differ");
            if (!plan.chatSpeedHandled) failures.push("chat speed differs");
            if (!plan.defaultGameModeHandled) failures.push("default game mode differs");
            return failures;
        }
        default: {
            const _exhaustive: never = plan;
            return _exhaustive;
        }
    }
}

function functionSettingsPlanFailures(
    plan: Extract<ImportablePlanDetails, { kind: "FUNCTION" }>
): string[] {
    if (plan.settingsPlan === null) return [];
    const failures: string[] = [];
    for (const change of plan.settingsPlan) {
        switch (change.key) {
            case "icon":
                failures.push("settings icon differs");
                break;
            case "repeatTicks":
                failures.push(
                    `settings automatic execution read=${change.current ?? 0} want=${change.desired ?? 0}`
                );
                break;
            default: {
                const _exhaustive: never = change;
                return _exhaustive;
            }
        }
    }
    return failures;
}

function actionPlanFailures(
    label: string,
    plan: { diff: { operations: ActionListOperation[] } } | null
): string[] {
    if (plan === null || plan.diff.operations.length === 0) return [];
    const failures = [`${label} has ${plan.diff.operations.length} residual op(s)`];
    for (let i = 0; i < plan.diff.operations.length; i++) {
        failures.push(
            `${label} ${i + 1}: ${actionOperationSummary(plan.diff.operations[i])}`
        );
    }
    return failures;
}

function actionOperationSummary(op: ActionListOperation): string {
    switch (op.kind) {
        case "add":
            return `add ${actionName(op.desired)} desired@${op.desiredIndex} to@${op.toIndex}`;
        case "delete":
            return `delete ${actionName(op.baselineAction)} @${op.fromIndex}`;
        case "move":
            return `move ${actionName(op.action)} ${op.fromIndex}->${op.toIndex}`;
        case "edit": {
            const childLists = childListDiffSummary(op.childListDiffs);
            const flags =
                op.noteOnly || op.noteDiffers
                    ? ` ${op.noteOnly ? "noteOnly" : "noteDiff"}`
                    : "";
            return `edit ${actionName(op.baselineAction)}->${actionName(op.desired)} @${op.fromIndex}->${op.desiredIndex}${flags}${childLists}`;
        }
        default: {
            const _exhaustive: never = op;
            return _exhaustive;
        }
    }
}

function childListDiffSummary(childListDiffs: readonly ChildListDiff[]): string {
    if (childListDiffs.length === 0) return "";
    const parts: string[] = [];
    for (let i = 0; i < childListDiffs.length; i++) {
        const childList = childListDiffs[i];
        const detail =
            childList.prop === "conditions"
                ? childList.diff.operations.map(conditionOpSummary).join("; ")
                : childList.diff.operations.map(actionOperationSummary).join("; ");
        parts.push(`${childList.prop}:${childList.diff.operations.length}{${detail}}`);
    }
    return ` childLists(${parts.join(",")})`;
}

function conditionOpSummary(op: ConditionListOperation): string {
    switch (op.kind) {
        case "add":
            return `add ${op.desired.type}`;
        case "delete":
            return `delete ${op.baselineCondition?.type ?? "empty"}`;
        case "edit":
            return `edit ${op.baselineCondition.type}: ${conditionFieldDiff(op.baselineCondition, op.desired)}`;
        default: {
            const _exhaustive: never = op;
            return _exhaustive;
        }
    }
}

// Field-level diff of read-back (baseline) vs desired condition, for residual
// reporting: shows exactly which property fails to round-trip (read≠write).
function conditionFieldDiff(baseline: Condition, desired: Condition): string {
    const keys = new Set<string>([...Object.keys(baseline), ...Object.keys(desired)]);
    const diffs: string[] = [];
    keys.forEach((key) => {
        const b = JSON.stringify((baseline as Record<string, unknown>)[key]);
        const d = JSON.stringify((desired as Record<string, unknown>)[key]);
        if (b !== d) diffs.push(`${key}: read=${b} want=${d}`);
    });
    return diffs.length === 0 ? "(equal raw — normalize diff)" : diffs.join(", ");
}

function actionName(action: Pick<Action, "type"> | null | undefined): string {
    if (action === null || action === undefined) return "empty";
    return action.type;
}

async function cleanupFixture(
    ctx: TaskContext,
    housingUuid: string,
    fixture: ParsedTestFixture
): Promise<void> {
    const importables = fixture.parsed.value;
    const eventsToReset: Importable[] = [];
    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        if (importable.type === "EVENT") {
            eventsToReset.push({
                type: "EVENT",
                event: importable.event,
                actions: [],
            });
        }
    }

    if (eventsToReset.length > 0) {
        await runImportSession(ctx, {
            importables: eventsToReset,
            trustMode: false,
            housingUuid,
            sourcePath: fixture.importJsonPath,
            parsed: fixture.parsed,
        });
    }

    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        if (importable.type === "FUNCTION") {
            await ctx.runCommand(`/function delete ${importable.name}`);
            await ctx.sleep(300);
        } else if (importable.type === "COMMAND") {
            await ctx.runCommand(`/command delete ${importable.name}`);
            await ctx.sleep(300);
        } else if (importable.type === "REGION") {
            await ctx.runCommand(`/region delete ${importable.name}`);
            await ctx.sleep(300);
        } else if (importable.type === "MENU") {
            await ctx.runCommand(`/menu delete ${importable.name}`);
            await ctx.sleep(300);
        } else if (
            importable.type === "ITEM" &&
            ((importable.leftClickActions?.length ?? 0) > 0 ||
                (importable.rightClickActions?.length ?? 0) > 0)
        ) {
            await clearImportedItemSlot(ctx);
        } else if (importable.type === "TEAM") {
            await deleteTeam(ctx, importable.name);
        } else if (importable.type === "GROUP") {
            await deleteGroup(ctx, importable.name);
        }
        deleteImportableCache(
            housingUuid,
            importable.type,
            importableIdentity(importable)
        );
    }
}

async function clearImportedItemSlot(ctx: TaskContext): Promise<void> {
    sendCreativeInventoryAction(ctx, HOTBAR_ZERO_PACKET_SLOT, null);
    try {
        await ctx.withTimeout(
            waitForAnySetSlot(ctx),
            "clearing imported test item slot",
            SET_SLOT_ACK_TIMEOUT_MS
        );
    } catch (_e) {
        void _e;
    }
    await ctx.waitFor("tick");
}

async function cleanupResiduals(ctx: TaskContext): Promise<string[]> {
    const state = await readHouseState(ctx);
    const failures: string[] = [];
    if (state.functions.length > 0) {
        failures.push(`cleanup left functions: ${state.functions.join(", ")}`);
    }
    if (state.regions.length > 0) {
        failures.push(`cleanup left regions: ${state.regions.join(", ")}`);
    }
    if (state.menus.length > 0) {
        failures.push(`cleanup left menus: ${state.menus.join(", ")}`);
    }
    if (state.commands.length > 0) {
        failures.push(`cleanup left commands: ${state.commands.join(", ")}`);
    }
    return failures;
}

async function assertHouseStartsEmpty(ctx: TaskContext): Promise<boolean> {
    const state = await readHouseState(ctx);
    const problems: string[] = [];
    if (state.functions.length > 0) {
        problems.push(`${state.functions.length} function(s)`);
    }
    if (state.regions.length > 0) {
        problems.push(`${state.regions.length} region(s)`);
    }
    if (state.menus.length > 0) {
        problems.push(`${state.menus.length} menu(s)`);
    }
    if (state.commands.length > 0) {
        problems.push(`${state.commands.length} command(s)`);
    }
    if (problems.length === 0) {
        ctx.displayMessage("&a[htsw test] empty-house gate passed.");
        return true;
    }
    ctx.displayMessage(
        `&c[htsw test] refusing to run: this house is not empty (${problems.join(", ")}).`
    );
    ctx.displayMessage(
        "&7[htsw test] Use an empty throwaway house for live importer tests."
    );
    return false;
}

// Housing creates /stuck and /clear in every house, so they always show up in
// the command list; the empty-house gate and residual checks must ignore them.
const DEFAULT_HOUSE_COMMANDS = ["stuck", "clear"];

function withoutDefaultCommands(names: string[]): string[] {
    return names.filter((name) => DEFAULT_HOUSE_COMMANDS.indexOf(name.toLowerCase()) < 0);
}

async function readHouseState(ctx: TaskContext): Promise<{
    functions: string[];
    regions: string[];
    menus: string[];
    commands: string[];
}> {
    return {
        functions: await listAllFunctionNames(ctx),
        regions: await listAllRegionNames(ctx),
        menus: await listAllMenuNames(ctx),
        commands: withoutDefaultCommands(await listAllCommandNames(ctx)),
    };
}

function createSuiteEventHandler(failures: string[]): SyncEventHandler {
    return {
        emit: (event) => {
            if (event.kind !== "importableFinished" || event.status !== "failed") return;
            failures.push(`${event.key}: ${event.error ?? "import failed"}`);
        },
    };
}

function hasParseFailures(
    ctx: TaskContext,
    fixtures: readonly ParsedTestFixture[]
): boolean {
    let failed = false;
    for (let i = 0; i < fixtures.length; i++) {
        const fixture = fixtures[i];
        if (fixture.blockingDiagnostics.length === 0) continue;
        failed = true;
        ctx.displayMessage(
            `&c[htsw test] fixture ${fixture.id} has ${fixture.blockingDiagnostics.length} parse error(s).`
        );
    }
    return failed;
}

function emitResultSummary(ctx: TaskContext, results: readonly FixtureResult[]): void {
    let passed = 0;
    for (let i = 0; i < results.length; i++) {
        if (results[i].passed) passed++;
    }
    const failed = results.length - passed;
    ctx.displayMessage(
        failed === 0
            ? `&a[htsw test] ${passed}/${results.length} fixture(s) passed.`
            : `&c[htsw test] ${passed}/${results.length} fixture(s) passed; ${failed} failed.`
    );
}
