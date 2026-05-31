import { VERSION, SourceMap, parseImportablesResult, Diagnostic } from "htsw";

import {
    chatSeparator,
    stripSurroundingQuotes,
} from "./utils/helpers";
import { Simulator } from "./simulator/simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { applyImportablePlan, prereadImportable } from "./importables/imports";
import { createItemRegistry } from "./importables/itemRegistry";
import { TaskManager } from "./tasks/manager";
import { FileSystemFileLoader } from "./utils/files";
import { commandKnowledge } from "./importCache/commands";
import { toggleHtswGui } from "./gui/overlay";
import {
    getTimingStats,
    resetTimingStats,
} from "./importer/progress/timing";
import {
    COST,
    CALIBRATABLE_COST_KEYS,
    applyCalibratedCosts,
    resetCalibratedCosts,
    type CalibratableCostKey,
} from "./importer/progress/costs";
import { getEventContainerCounts } from "./tasks/specifics/waitFor";
import { isPacketOrderProbeActive } from "./importer/diagnostics/packetOrderProbe";

function printCommandError(sm: SourceMap, err: unknown): void {
    if (err instanceof Diagnostic) {
        if (err.spans.length > 0) {
            printDiagnostic(sm, err);
        } else {
            ChatLib.chat(`&c${err.message}`);
        }
        return;
    }

    if (err instanceof Error) {
        ChatLib.chat(`&c${err.message}`);
        if (err.stack) {
            const firstStackLine = err.stack.split("\n")[1];
            if (firstStackLine) {
                ChatLib.chat(`&7${firstStackLine.trim()}`);
            }
        }
        return;
    }

    ChatLib.chat(`&c${String(err)}`);
}

export function registerCommands() {
    register("command", (...args) => commandHtsw(args)).setName("htsw");
    register("command", (...args) => commandImport(args)).setName("import");
    register("command", (...args) => commandSimulator(args))
        .setName("simulator")
        .setAliases("sim");
}

function commandHtsw(args: string[]) {
    if (args.length > 0 && args[0] === "recompile") {
        recompile();
        return;
    }

    if (args.length > 0 && args[0] === "knowledge") {
        commandKnowledge(args.slice(1));
        return;
    }

    if (args.length > 0 && args[0] === "eta") {
        commandEta(args.slice(1));
        return;
    }

    if (args.length > 0 && args[0] === "gui") {
        const nowEnabled = toggleHtswGui();
        ChatLib.chat(`&e[htsw] gui ${nowEnabled ? "&aenabled" : "&cdisabled"}`);
        return;
    }

    if (args.length > 0 && args[0] === "waiters") {
        const counts = getEventContainerCounts();
        ChatLib.chat(
            `&7[waiters] live waitFor predicates — ` +
            `tick: ${counts.tick}, packetReceived: ${counts.packetReceived}, ` +
            `packetSent: ${counts.packetSent}, message: ${counts.message}`
        );
        ChatLib.chat(
            `&7[waiters] Idle baseline should be ~0 across the board; ` +
            `non-zero between imports = a leaked waiter.`
        );
        return;
    }

    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    const subtitle = `&fCreated by @sndyx, @j_sse, and @callanftw`;
    ChatLib.chat(`${ChatLib.getCenteredText(subtitle)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/import &7- Import actions from HTSL files");
    ChatLib.chat("&f/simulator &7- Simulate actions from HTSL files");
    ChatLib.chat("&f/htsw knowledge &7- Inspect local import/export knowledge");
    ChatLib.chat("&f/htsw eta [reset|dump|calibrate <ms>|reset-costs] &7- Show / reset / dump / calibrate ETA samples");
    ChatLib.chat("&f/htsw gui &7- Open the in-game HTSW dashboard");
    ChatLib.chat("&f/htsw waiters &7- Show live waitFor counts (leak check; idle = ~0)");
    ChatLib.chat("&f/htsw recompile &7- Rebuild + reload the module");
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandEta(args: string[]): void {
    if (args.length > 0 && (args[0] === "reset" || args[0] === "clear")) {
        resetTimingStats();
        ChatLib.chat("&7[eta] timing samples reset");
        return;
    }

    if (args.length > 0 && args[0] === "dump") {
        dumpEtaToFile();
        return;
    }

    if (args.length > 0 && args[0] === "calibrate") {
        commandEtaCalibrate(args.slice(1));
        return;
    }

    if (args.length > 0 && args[0] === "reset-costs") {
        resetCalibratedCosts();
        ChatLib.chat("&7[eta] cost overrides cleared; using source defaults");
        return;
    }

    if (args.length > 0 && args[0] === "waiters") {
        const counts = getEventContainerCounts();
        ChatLib.chat(
            `&7[waiters] live waitFor predicates — ` +
            `tick: ${counts.tick}, packetReceived: ${counts.packetReceived}, ` +
            `packetSent: ${counts.packetSent}, message: ${counts.message}`
        );
        ChatLib.chat(
            `&7[waiters] packet-order probe: ${isPacketOrderProbeActive() ? "&cACTIVE" : "&aoff"}&7. ` +
            `Idle baseline should be ~0 across the board; non-zero between imports = leak.`
        );
        return;
    }

    printOpKindStats();
}

function commandEtaCalibrate(args: string[]): void {
    const target = args.length > 0 ? parseInt(args[0], 10) : 250;
    if (!isFinite(target) || target <= 0) {
        ChatLib.chat(`&c[eta] invalid target ms/unit: ${args[0]}`);
        return;
    }
    const stats = getTimingStats();
    const updated: Partial<Record<CalibratableCostKey, number>> = {};
    const skipped: string[] = [];
    ChatLib.chat(`&7[eta] calibrating to ${target}ms/unit:`);
    for (let i = 0; i < CALIBRATABLE_COST_KEYS.length; i++) {
        const kind = CALIBRATABLE_COST_KEYS[i];
        const entry = stats[kind];
        if (entry === undefined || entry.count === 0) {
            skipped.push(kind);
            continue;
        }
        const totalMs = entry.avgMsPerExpectedUnit * COST[kind];
        const newUnits = Math.max(0.1, totalMs / target);
        const oldUnits = COST[kind];
        updated[kind] = newUnits;
        ChatLib.chat(
            `&7  ${kind}: &f${oldUnits.toFixed(2)}u &7-> &f${newUnits.toFixed(2)}u &7(${entry.count} samples, ${totalMs.toFixed(0)}ms/op)`
        );
    }
    applyCalibratedCosts(updated);
    if (skipped.length > 0) {
        ChatLib.chat(`&7[eta] skipped (no samples): &f${skipped.join(", ")}`);
    }
    ChatLib.chat(`&a[eta] applied; persisted to ./htsw/cost-overrides.json`);
}

function printOpKindStats(): void {
    const stats = getTimingStats();
    const kinds: string[] = [
        "commandMenuWait",
        "commandMessageWait",
        "menuClickWait",
        "messageClickWait",
        "pageTurnWait",
        "goBackWait",
        "chatInput",
        "anvilInput",
        "itemSelect",
        "reorderStep",
        "sleep1000",
    ];
    ChatLib.chat("&7[eta] per-op-kind units / ms/unit");
    let printed = false;
    for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i];
        const entry = stats[kind];
        if (entry === undefined || entry.count === 0) continue;
        printed = true;
        const units = costForKind(kind);
        const current = entry.avgMsPerExpectedUnit;
        const baseline = entry.baselineMsPerExpectedUnit;
        const delta = current - baseline;
        const pct = baseline > 0 ? (delta / baseline) * 100 : 0;
        let trend: string;
        if (Math.abs(pct) < 3) trend = "&7~";
        else if (pct > 0) trend = `&c↑${pct.toFixed(0)}%`;
        else trend = `&a↓${Math.abs(pct).toFixed(0)}%`;
        const unitsStr = units !== null ? `&f${units.toFixed(2)}u/op` : "&7(no cost)";
        ChatLib.chat(
            `&7  ${kind}: ${unitsStr} &7| &f${entry.count}&7 samples => &f${current.toFixed(0)}ms/u &7(baseline &f${baseline.toFixed(0)}&7 ${trend}&7)`
        );
    }
    if (!printed) {
        ChatLib.chat("&7  (no samples yet)");
    }
}

function costForKind(kind: string): number | null {
    if (kind === "sleep1000") return COST.guaranteedSleep1000;
    const v = (COST as Record<string, number>)[kind];
    return typeof v === "number" ? v : null;
}

function dumpEtaToFile(): void {
    const stats = getTimingStats();
    const dump = {
        capturedAt: new Date().toISOString(),
        perOpKind: stats,
    };
    const path = `./htsw/eta-${Date.now()}.json`;
    try {
        FileLib.write(path, JSON.stringify(dump, null, 2), true);
        ChatLib.chat(`&a[eta] wrote ${path}`);
    } catch (e) {
        ChatLib.chat(`&c[eta] failed to write ${path}: ${e}`);
    }
}

function commandImport(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fImporter &f&l${VERSION}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/import [path]");
        ChatLib.chat(`&7${chatSeparator()}`);
        return;
    }

    const sm = new SourceMap(new FileSystemFileLoader());
    const importPath = stripSurroundingQuotes(args.join(" "));
    let result: ReturnType<typeof parseImportablesResult>;
    try {
        result = parseImportablesResult(sm, importPath);
    } catch (err) {
        ChatLib.chat("&cImport failed while parsing.");
        printCommandError(sm, err);
        return;
    }

    printDiagnostics(sm, result.diagnostics);

    const errorCount = countBlockingDiagnostics(result.diagnostics);
    if (errorCount > 0) {
        ChatLib.chat(
            `&cImport failed with ${errorCount} error${errorCount === 1 ? "" : "s"}.`
        );
        return;
    }

    TaskManager.run(async (ctx) => {
        ctx.displayMessage("&aImport started.");
        const itemRegistry = createItemRegistry(result.value, result.gcx);
        const ordered = [
            ...result.value.filter((i) => i.type === "ITEM"),
            ...result.value.filter((i) => i.type !== "ITEM"),
        ];
        for (const importable of ordered) {
            try {
                const plan = await prereadImportable(ctx, importable, itemRegistry);
                await applyImportablePlan(ctx, plan, itemRegistry);
            } catch (e) {
                if (e instanceof Diagnostic) {
                    printDiagnostic(sm, e);
                } else {
                    ctx.displayMessage(`&cFailed to import: ${e}`);
                }
                ctx.displayMessage("&cImport aborted.");
                return;
            }
        }
        ctx.displayMessage("&aImport complete.");
    }).catch((err) => {
        ChatLib.chat("&cImport failed.");
        printCommandError(sm, err);
    });
}

function commandSimulator(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fSimulator Runtime &f&l${VERSION}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/simulator [start [path] | restart | stop ]");
        ChatLib.chat("");
        ChatLib.chat("&f/function run <function> &7- Run a function");
        ChatLib.chat("&f// <htsl> &7- Evaluate HTSL code");
        ChatLib.chat(`&7${chatSeparator()}`);
    }

    if (args[0] === "start") {
        if (Simulator.isActive) {
            Simulator.stop();
            ChatLib.chat("&aSimulator stopped.");
        }

        const sm = new SourceMap(new FileSystemFileLoader());
        const result = parseImportablesResult(sm, args[1]);

        printDiagnostics(sm, result.diagnostics);

        const errCount = countBlockingDiagnostics(result.diagnostics);
        if (errCount > 0) {
            printDiagnostic(
                sm,
                Diagnostic.error(`Simulate failed with ${errCount} errors`)
            );
        } else {
            Simulator.start(sm, result.value, result.spans);
            ChatLib.chat("&aSimulator started.");
        }

        return;
    }

    if (args[0] === "restart") {
        if (!Simulator.isActive) {
            ChatLib.chat("&cNo simulator active.");
        } else {
            Simulator.restart();
            ChatLib.chat("&aSimulator restarted.");
        }
        return;
    }

    if (args[0] === "stop") {
        Simulator.stop();
        ChatLib.chat("&aSimulator stopped.");
        return;
    }
}

function countBlockingDiagnostics(diagnostics: Diagnostic[]): number {
    return diagnostics.filter((it) => it.level === "error" || it.level === "bug").length;
}
