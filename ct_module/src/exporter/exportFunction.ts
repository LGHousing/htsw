import type { Action, ImportableFunction } from "htsw/types";
import * as htsw from "htsw";

import TaskContext from "../tasks/context";
import { readActionList } from "../importer/actions";
import {
    clickGoBack,
    getSlotPaginate,
    waitForMenu,
} from "../importer/helpers";
import { parseLoreKeyValueLine } from "../importer/loreParsing";
import { MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";

import { observedSlotsToActions } from "./sanitize";
import { upsertImportableEntry } from "./importJsonWriter";
import { canonicalSlug, htslFilename } from "./paths";
import {
    getCurrentHousingUuid,
    writeKnowledge,
} from "../knowledge";

export type ExportFunctionOptions = {
    /** The function name as known to Hypixel Housing. */
    name: string;
    /** Path to the `import.json` to upsert into (will be created if absent). */
    importJsonPath: string;
    /** Path to the `.htsl` file to write (typically alongside the import.json). */
    htslPath: string;
    /**
     * Path string to record in `import.json`'s `actions` field. This should be
     * the relative path from `import.json` to `htslPath` so the importer can
     * follow the reference.
     */
    htslReference: string;
};

/**
 * Resolve a function name to its observed action list and repeatTicks.
 *
 * Reuses the importer's `readActionList` (so nested CONDITIONAL/RANDOM
 * bodies hydrate correctly via the existing hydration plan) and a
 * targeted right-click on the function list slot for `repeatTicks`,
 * matching the importer's read pattern.
 */
async function readFunction(
    ctx: TaskContext,
    name: string
): Promise<{ actions: Action[]; repeatTicks?: number }> {
    ctx.runCommand(`/function edit ${name}`);

    const exists = await ctx.withTimeout(
        Promise.race([
            waitForMenu(ctx).then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a function with that name!"
                )
                .then(() => false),
        ]),
        "Waiting for function to open"
    );

    if (!exists) {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    // Full hydration: the exporter wants every nested action body, not
    // just the ones a sync diff would care about.
    const observed = await readActionList(ctx, { kind: "full" });
    const actions = observedSlotsToActions(observed);

    // The function-list right-click menu owns repeatTicks. Mirrors the
    // importer's write path at importables.ts function flow.
    await clickGoBack(ctx);
    const listSlot = await getSlotPaginate(ctx, name);
    listSlot.click(MouseButton.RIGHT);
    await waitForMenu(ctx);

    let repeatTicks: number | undefined;
    const autoExecSlot = ctx.tryGetItemSlot("Automatic Execution");
    if (autoExecSlot !== null) {
        for (const line of autoExecSlot.getItem().getLore()) {
            const kv = parseLoreKeyValueLine(line);
            if (!kv || kv.label !== "Current") continue;
            const ticks = parseInt(removedFormatting(kv.value).trim(), 10);
            if (!isNaN(ticks) && ticks > 0) {
                repeatTicks = ticks;
            }
            break;
        }
    }

    await clickGoBack(ctx);
    return repeatTicks !== undefined ? { actions, repeatTicks } : { actions };
}

/**
 * High-level export-a-function flow: open in GUI, read state, write
 * `.htsl`, upsert `import.json`, refresh knowledge cache, report to chat.
 *
 * Best-effort cache writes (filesystem failures don't abort the export);
 * the printer's item-NBT diagnostics surface in chat so the user knows
 * if the exported `.htsl` will need manual touch-up.
 */
export async function exportFunction(
    ctx: TaskContext,
    options: ExportFunctionOptions
): Promise<void> {
    const { name, importJsonPath, htslPath, htslReference } = options;

    const { actions, repeatTicks } = await readFunction(ctx, name);

    const importable: ImportableFunction = {
        type: "FUNCTION",
        name,
        actions,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
    };

    // Print HTSL. Surface any printer warnings (e.g. item-NBT placeholders)
    // before we touch disk so the user has full context.
    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(
        actions
    );
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }

    FileLib.write(htslPath, source, true);

    upsertImportableEntry(importJsonPath, "functions", {
        name,
        actions: htslReference,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
    });

    // Knowledge cache reflects what was just on the housing — exporter writer.
    try {
        const housingUuid = await getCurrentHousingUuid(ctx);
        writeKnowledge(ctx, housingUuid, importable, "exporter");
    } catch (error) {
        ctx.displayMessage(
            `&7[export] &eCache write skipped: ${error}`
        );
    }

    ctx.displayMessage(
        `&aExported function '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  → ${htslPath}`);
    ctx.displayMessage(`&7  → ${importJsonPath}`);
}

// Re-exported so callers can construct paths without re-deriving them.
export { canonicalSlug, htslFilename };
