import type { Action, Condition, Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { getCurrentHousingUuid } from "../importCache";
import {
    buildTrustPlan,
    deleteImportableCache,
    importableHash,
    importableIdentity,
    itemSnbtCachePath,
} from "../importCache";
import { createItemRegistry } from "../importables/itemRegistry";
import {
    importSelectedImportables,
    orderImportablesForImportSession,
} from "../importables/importSession";
import {
    prereadImportable,
    type ImportablePlan,
    type ImportSession,
} from "../importables/imports";
import { listAllFunctionNames } from "../importables/functions/listFunctions";
import {
    resetFunctionNameSession,
} from "../importables/functions/listFunctions";
import { listAllRegionNames } from "../importables/regions/listRegions";
import {
    listAllMenuNames,
    resetMenuNameSession,
} from "../importables/menus/listMenus";
import type { ImportEventHandler } from "../housingSync/importEvents";
import type {
    ActionListOperation,
    ConditionListOperation,
    InnerListDiff,
} from "../housingSync/types";
import {
    HOTBAR_ZERO_PACKET_SLOT,
    SET_SLOT_ACK_TIMEOUT_MS,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "../housingSync/gui/packets";
import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
} from "../housingSync/itemCapture";
import {
    gmcOnImportStart,
    waitForCreativeMode,
} from "../housingSync/sideEffects";
import {
    getImportTracePath,
    setImportTraceEnabled,
} from "../housingSync/trace/importTrace";
import { loadTestFixtures, type ParsedTestFixture } from "./fixtures";
import { coverageForFixtures, emitCoverageReport } from "./report";

type FixtureResult = {
    fixture: ParsedTestFixture;
    passed: boolean;
    failures: string[];
};

export async function runLiveTestSuite(
    ctx: TaskContext,
    slice?: string
): Promise<void> {
    const fixtures = loadTestFixtures(slice);
    if (fixtures.length === 0) {
        ctx.displayMessage("&c[htsw test] no fixtures matched.");
        return;
    }
    if (hasParseFailures(ctx, fixtures)) return;

    // The suite is the diagnostic harness for intermittent importer hangs, so
    // every run leaves a post-mortem trace whether or not it failed — there's
    // no "turn it on first, then reproduce" step to forget.
    const tracePath = setImportTraceEnabled(true);
    ctx.displayMessage(`&7[htsw test] import trace → &f${tracePath}`);
    try {
        gmcOnImportStart();
        if (!(await waitForCreativeMode(ctx))) {
            ctx.displayMessage("&e[htsw test] Still not in creative after /gmc; region and item tests may fail.");
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
        setImportTraceEnabled(false);
        ctx.displayMessage(`&7[htsw test] trace saved → &f${getImportTracePath()}`);
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
        await importSelectedImportables(ctx, {
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
            failures.push(`cleanup failed: ${e}`);
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
    resetMenuNameSession();
    const ordered = orderImportablesForImportSession(
        fixture.parsed.value,
        fixture.parsed.value
    );
    const itemCaptures = createFixtureItemCaptures(housingUuid, fixture);
    const session: ImportSession = {
        parsed: fixture.parsed,
        items: createItemRegistry(fixture.parsed.value, fixture.parsed.gcx),
        housingUuid,
        trust: buildTrustPlan(housingUuid, ordered, false),
        events: undefined,
        itemCaptures,
    };

    const failures: string[] = [];
    const inventorySnapshot = snapshotInventory();
    try {
        for (let i = 0; i < ordered.length; i++) {
            const importable = ordered[i];
            const plan = await prereadImportable(ctx, importable, session);
            const residuals = residualPlanOperations(plan);
            for (let j = 0; j < residuals.length; j++) {
                failures.push(
                    `${importable.type} ${importableIdentity(importable)}: ${residuals[j]}`
                );
            }
        }
    } finally {
        try {
            await restoreInventoryToSnapshot(ctx, inventorySnapshot);
        } catch (e) {
            failures.push(`inventory restore failed: ${e}`);
        }
    }
    return failures;
}

function createFixtureItemCaptures(
    housingUuid: string,
    fixture: ParsedTestFixture
): ItemCaptureRegistry {
    const captures = new ItemCaptureRegistry();
    const importables = fixture.parsed.value;
    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        if (importable.type !== "ITEM") continue;
        const cachePath = itemSnbtCachePath(housingUuid, importableHash(importable));
        const cached = FileLib.exists(cachePath) ? FileLib.read(cachePath) : null;
        if (cached !== null) {
            captures.seedSnbtText(importable.name, String(cached));
        } else {
            captures.seed(importable.name, importable.nbt);
        }
    }
    return captures;
}

function residualPlanOperations(plan: ImportablePlan): string[] {
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
        case "REGION": {
            const failures: string[] = [];
            if (plan.liveRegion === null) {
                failures.push("region is missing");
            } else if (!plan.boundsMatch) {
                failures.push("bounds differ");
            }
            const enterFailures = actionPlanFailures("onEnterActions", plan.enterPlan);
            for (let i = 0; i < enterFailures.length; i++) failures.push(enterFailures[i]);
            const exitFailures = actionPlanFailures("onExitActions", plan.exitPlan);
            for (let i = 0; i < exitFailures.length; i++) failures.push(exitFailures[i]);
            return failures;
        }
        case "MENU": {
            const diff = (plan as {
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
            }).diff;
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
                    parts.push(`actions differ (desired: ${op.syncActions.map((a) => a.type).join(", ")})`);
                }
                failures.push(`slot ${op.slot}: ${parts.length > 0 ? parts.join("; ") : "?"}`);
            }
            return failures;
        }
        case "ITEM":
            return [];
        default: {
            const _exhaustive: never = plan;
            return _exhaustive;
        }
    }
}

function functionSettingsPlanFailures(
    plan: Extract<ImportablePlan, { kind: "FUNCTION" }>
): string[] {
    if (plan.settingsPlan === null) return [];
    const failures: string[] = [];
    if (plan.settingsPlan.iconNeedsApply) {
        failures.push("settings icon differs");
    }
    const automaticExecution = plan.settingsPlan.automaticExecution;
    if (automaticExecution.needsApply) {
        failures.push(
            `settings automatic execution read=${automaticExecution.current} want=${automaticExecution.desired}`
        );
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
        failures.push(`${label} ${i + 1}: ${actionOperationSummary(plan.diff.operations[i])}`);
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
            const inner = innerListDiffSummary(op.innerListDiffs);
            const flags =
                op.noteOnly || op.noteDiffers
                    ? ` ${op.noteOnly ? "noteOnly" : "noteDiff"}`
                    : "";
            return `edit ${actionName(op.baselineAction)}->${actionName(op.desired)} @${op.fromIndex}->${op.desiredIndex}${flags}${inner}`;
        }
        default: {
            const _exhaustive: never = op;
            return _exhaustive;
        }
    }
}

function innerListDiffSummary(innerListDiffs: readonly InnerListDiff[]): string {
    if (innerListDiffs.length === 0) return "";
    const parts: string[] = [];
    for (let i = 0; i < innerListDiffs.length; i++) {
        const inner = innerListDiffs[i];
        const detail =
            inner.prop === "conditions"
                ? inner.diff.operations.map(conditionOpSummary).join("; ")
                : inner.diff.operations.map(actionOperationSummary).join("; ");
        parts.push(`${inner.prop}:${inner.diff.operations.length}{${detail}}`);
    }
    return ` inner(${parts.join(",")})`;
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
    const keys = new Set<string>([
        ...Object.keys(baseline),
        ...Object.keys(desired),
    ]);
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
        await importSelectedImportables(ctx, {
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
    if (problems.length === 0) {
        ctx.displayMessage("&a[htsw test] empty-house gate passed.");
        return true;
    }
    ctx.displayMessage(
        `&c[htsw test] refusing to run: this house is not empty (${problems.join(", ")}).`
    );
    ctx.displayMessage("&7[htsw test] Use an empty throwaway house for live importer tests.");
    return false;
}

async function readHouseState(ctx: TaskContext): Promise<{
    functions: string[];
    regions: string[];
    menus: string[];
}> {
    return {
        functions: await listAllFunctionNames(ctx),
        regions: await listAllRegionNames(ctx),
        menus: await listAllMenuNames(ctx),
    };
}

function createSuiteEventHandler(failures: string[]): ImportEventHandler {
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
