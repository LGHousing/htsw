import { VERSION, SourceMap, parseImportablesResult, Diagnostic } from "htsw";

import {
    chatSeparator,
    normalizeFormattingCodes,
    removedFormatting,
    stripSurroundingQuotes,
} from "./utils/helpers";
import { Simulator } from "./simulator/simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { applyImportablePlan, prereadImportable } from "./importables/imports";
import { createItemRegistry } from "./importables/itemRegistry";
import { TaskManager } from "./tasks/manager";
import { S2FPacketSetSlot } from "./utils/packets";
import { FileSystemFileLoader } from "./utils/files";
import { commandKnowledge } from "./importCache/commands";
import { toggleHtswGui, armHtswGuiDebug } from "./gui/overlay";
import {
    getTimingStats,
    resetTimingStats,
} from "./importer/progress/timing";
import {
    getProgressTracePath,
    isProgressTraceEnabled,
    setProgressTraceEnabled,
} from "./importer/progress/trace";
import { getAllItemSlots, ItemSlot } from "./tasks/specifics/slots";
import { readStringValue } from "./importer/gui/helpers";

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

    if (args.length > 0 && args[0] === "probe-item") {
        probeItem();
        return;
    }

    if (args.length > 0 && args[0] === "dump-item") {
        dumpOpenContainerItem(args.slice(1));
        return;
    }

    if (args.length > 0 && args[0] === "packet-probe") {
        const seconds = args.length > 1 ? parseInt(args[1], 10) : 30;
        packetProbe(Number.isFinite(seconds) && seconds > 0 ? seconds : 30);
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
        if (args.length > 1 && args[1] === "debug") {
            const frames = args.length > 2 ? parseInt(args[2], 10) : 30;
            armHtswGuiDebug(Number.isFinite(frames) && frames > 0 ? frames : 30);
            return;
        }
        const nowEnabled = toggleHtswGui();
        ChatLib.chat(`&e[htsw] gui ${nowEnabled ? "&aenabled" : "&cdisabled"}`);
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
    ChatLib.chat("&f/htsw eta [reset|dump|trace] &7- Show / reset / dump importer ETA samples");
    ChatLib.chat("&f/htsw dump-item [slot|name] &7- Dump open-container item lore");
    ChatLib.chat("&f/htsw packet-probe [seconds] &7- Safely log relevant packets");
    ChatLib.chat("&f/htsw gui &7- Open the in-game HTSW dashboard");
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandEta(args: string[]): void {
    if (args.length > 0 && args[0] === "trace") {
        commandEtaTrace(args.slice(1));
        return;
    }

    if (args.length > 0 && (args[0] === "reset" || args[0] === "clear")) {
        resetTimingStats();
        ChatLib.chat("&7[eta] timing samples reset");
        return;
    }

    if (args.length > 0 && args[0] === "dump") {
        dumpEtaToFile();
        return;
    }

    printOpKindStats();
}

function commandEtaTrace(args: string[]): void {
    if (args.length === 0) {
        const state = isProgressTraceEnabled() ? "&aon" : "&coff";
        const path = getProgressTracePath();
        ChatLib.chat(`&7[eta] progress trace ${state}`);
        if (path !== null) ChatLib.chat(`&7[eta] trace file: &f${path}`);
        return;
    }

    if (args[0] === "on" || args[0] === "start") {
        const path = setProgressTraceEnabled(true);
        ChatLib.chat(`&a[eta] progress trace on: &f${path}`);
        return;
    }

    if (args[0] === "off" || args[0] === "stop") {
        const path = getProgressTracePath();
        setProgressTraceEnabled(false);
        ChatLib.chat("&7[eta] progress trace off");
        if (path !== null) ChatLib.chat(`&7[eta] trace file: &f${path}`);
        return;
    }

    ChatLib.chat("&f/htsw eta trace [on|off] &7- Write progress/ETA trace");
}

function printOpKindStats(): void {
    const stats = getTimingStats();
    const kinds = [
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
    ChatLib.chat("&7[eta] per-op-kind ms/unit");
    let printed = false;
    for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i];
        const entry = stats[kind];
        if (entry === undefined || entry.count === 0) continue;
        printed = true;
        const expected =
            entry.count === 0 ? 0 : entry.totalExpectedUnits / entry.count;
        ChatLib.chat(
            `&7  ${kind}: &f${entry.count} samples&7, avg &f${entry.avgMs.toFixed(0)}ms&7, expected &f${expected.toFixed(2)}u&7 => &f${entry.avgMsPerExpectedUnit.toFixed(0)}ms/u`
        );
    }
    if (!printed) {
        ChatLib.chat("&7  (no samples yet)");
    }
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

function dumpOpenContainerItem(args: string[]): void {
    const slots = getAllItemSlots();
    if (slots === null) {
        ChatLib.chat("&c[dump-item] no open container");
        return;
    }

    const target = args.join(" ").trim();
    const selected = selectDumpSlots(slots, target);
    if (selected.length === 0) {
        ChatLib.chat(`&c[dump-item] no slot matched "${target}"`);
        return;
    }

    const container = Player.getContainer();
    const containerInfo = container === null || container === undefined ? null : {
        name: safeCall(() => String(container.getName())),
        size: safeCall(() => Number(container.getSize())),
    };
    const dump = {
        capturedAt: new Date().toISOString(),
        container: containerInfo,
        target,
        slots: selected.map(dumpSlot),
    };
    const path = `./htsw/item-dump-${Date.now()}.json`;
    try {
        FileLib.write(path, JSON.stringify(dump, null, 2), true);
        ChatLib.chat(`&a[dump-item] wrote ${path}`);
        ChatLib.chat(`&7[dump-item] dumped ${selected.length} slot${selected.length === 1 ? "" : "s"}`);
    } catch (e) {
        ChatLib.chat(`&c[dump-item] failed to write ${path}: ${e}`);
    }
}

function selectDumpSlots(slots: ItemSlot[], target: string): ItemSlot[] {
    if (target.length === 0) return slots;

    const slotId = parseInt(target, 10);
    if (String(slotId) === target) {
        return slots.filter((slot) => slot.getSlotId() === slotId);
    }

    const needle = target.toLowerCase();
    return slots.filter((slot) =>
        removedFormatting(slot.getItem().getName()).toLowerCase().indexOf(needle) !== -1
    );
}

function dumpSlot(slot: ItemSlot): unknown {
    const item = slot.getItem();
    const lore = item.getLore();
    return {
        slotId: slot.getSlotId(),
        name: dumpString(item.getName()),
        lore: lore.map((line, index) => ({
            index,
            value: dumpString(line),
        })),
        readStringValue: dumpNullableString(readStringValue(slot)),
        rawNBT: safeCall(() => String(item.getRawNBT())),
    };
}

function dumpNullableString(value: string | null): unknown {
    return value === null ? null : dumpString(value);
}

function dumpString(value: string): unknown {
    return {
        raw: value,
        json: JSON.stringify(value),
        ampCodes: normalizeFormattingCodes(value),
        stripped: removedFormatting(value),
        chars: charsOf(value),
    };
}

function charsOf(value: string): Array<{ index: number; char: string; code: number }> {
    const out: Array<{ index: number; char: string; code: number }> = [];
    for (let i = 0; i < value.length; i++) {
        out.push({ index: i, char: value.charAt(i), code: value.charCodeAt(i) });
    }
    return out;
}

function safeCall<T>(fn: () => T): T | string {
    try {
        return fn();
    } catch (e) {
        return `ERROR: ${e}`;
    }
}

function packetProbe(seconds: number): void {
    const lines: string[] = [];
    const started = Date.now();
    const path = `./htsw/packet-probe-${started}.txt`;

    function log(line: string): void {
        const elapsed = ((Date.now() - started) / 1000).toFixed(2);
        const full = `${elapsed}s ${line}`;
        lines.push(full);
        ChatLib.chat(`&7[pkt] &f${full}`);
    }

    function className(packet: any): string {
        try {
            return String(packet.getClass().getSimpleName());
        } catch (_error) {
            return String(packet);
        }
    }

    function shouldLog(name: string): boolean {
        return (
            name.indexOf("CloseWindow") !== -1 ||
            name.indexOf("CreativeInventoryAction") !== -1 ||
            name.indexOf("SetSlot") !== -1 ||
            name.indexOf("OpenWindow") !== -1 ||
            name.indexOf("WindowItems") !== -1 ||
            name.indexOf("HeldItemChange") !== -1
        );
    }

    function fieldSummary(packet: any): string {
        try {
            const fields = packet.getClass().getDeclaredFields();
            const parts: string[] = [];
            for (let i = 0; i < fields.length; i++) {
                const field = fields[i];
                field.setAccessible(true);
                const name = String(field.getName());
                const value = field.get(packet);
                if (value === null || value === undefined) {
                    parts.push(`${name}=null`);
                    continue;
                }
                const valueClass = String(value.getClass?.().getSimpleName?.() ?? "");
                if (valueClass === "ItemStack") {
                    parts.push(`${name}=ItemStack(${String(value.func_82833_r?.() ?? value)})`);
                } else {
                    parts.push(`${name}=${String(value)}`);
                }
            }
            return parts.join(", ");
        } catch (error) {
            return `fields unavailable: ${error}`;
        }
    }

    ChatLib.chat(`&e[pkt] probing relevant packets for ${seconds}s`);

    const sent = register("packetSent", (packet) => {
        const name = className(packet);
        if (!shouldLog(name)) return;
        log(`C->S ${name} ${fieldSummary(packet)}`);
    });

    const received = register("packetReceived", (packet) => {
        const name = className(packet);
        if (!shouldLog(name)) return;
        log(`S->C ${name} ${fieldSummary(packet)}`);
    });

    setTimeout(() => {
        sent.unregister();
        received.unregister();
        try {
            FileLib.write(path, lines.join("\n"), true);
            ChatLib.chat(`&a[pkt] wrote ${path}`);
        } catch (error) {
            ChatLib.chat(`&c[pkt] failed to write ${path}: ${error}`);
        }
    }, seconds * 1000);
}

/**
 * Diagnostic: dump the "Current Item" slot's overlay NBT, then click it
 * to copy the real item into the inventory and dump the inventory copy's
 * NBT.
 *
 * Used to validate the assumption that the slot's rendered NBT is the
 * Hypixel UI overlay, while the inventory copy carries the real housing-
 * tagged NBT we need to compare against the source/cache.
 *
 * Pre-armed: run the command in chat, then manually open a GIVE_ITEM /
 * REMOVE_ITEM / etc. action's Item field. The task waits up to 30s for a
 * container with a "Current Item" slot to appear, then probes it.
 *
 * Output goes to chat and also to `./htsw/probe-item-<timestamp>.txt`
 * because raw SNBT lines are usually too long for chat to render legibly.
 */
function probeItem() {
    TaskManager.run(async (ctx) => {
        const lines: string[] = [];
        const log = (line: string) => {
            lines.push(line);
            ctx.displayMessage(`&7[probe] &f${line}`);
        };

        ctx.displayMessage(
            "&e[probe] Open a GIVE_ITEM action's Item field within 30s. " +
                'Waiting for a "Current Item" slot to appear…'
        );

        const slot = await ctx.withTimeout(
            (async () => {
                while (true) {
                    const found = ctx.tryGetItemSlot("Current Item");
                    if (found !== null) return found;
                    await ctx.waitFor("tick");
                }
            })(),
            "Select an Item menu open",
            30000
        );

        const overlay = slot.getItem();
        log(`overlay name: ${overlay.getName()}`);
        const overlayLore = overlay.getLore();
        for (let i = 0; i < overlayLore.length; i++) {
            log(`overlay lore[${i}]: ${overlayLore[i]}`);
        }
        log(`overlay rawNBT: ${overlay.getRawNBT()}`);

        slot.click();

        let ackedSlotId: number | null = null;
        let ackedWindowId: number | null = null;
        try {
            await ctx.withTimeout(
                ctx.waitFor("packetReceived", (packet) => {
                    if (!(packet instanceof S2FPacketSetSlot)) return false;
                    ackedWindowId = packet.func_149175_c();
                    ackedSlotId = packet.func_149173_d();
                    return true;
                }),
                "current-item copy ack",
                3000
            );
            log(`copy ack: windowId=${ackedWindowId} slotId=${ackedSlotId}`);
        } catch (e) {
            log(`no S2FPacketSetSlot ack within 3s: ${e}`);
        }
        await ctx.waitFor("tick");

        const inv = Player.getInventory();
        for (let i = 0; i < 36; i++) {
            const stack = inv?.getStackInSlot(i);
            if (stack === null || stack === undefined) continue;
            const name = stack.getName();
            if (name === null || name === undefined) continue;
            log(`inv[${i}] name: ${name}`);
            log(`inv[${i}] rawNBT: ${stack.getRawNBT()}`);
        }

        const path = `./htsw/probe-item-${Date.now()}.txt`;
        try {
            FileLib.write(path, lines.join("\n"), true);
            ctx.displayMessage(`&a[probe] wrote ${path}`);
        } catch (e) {
            ctx.displayMessage(`&c[probe] failed to write ${path}: ${e}`);
        }
    }).catch((err) => {
        ChatLib.chat(`&c[probe] task failed: ${err}`);
    });
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
