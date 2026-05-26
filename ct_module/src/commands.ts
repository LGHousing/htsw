import { VERSION, SourceMap, parseImportablesResult, Diagnostic } from "htsw";

import { chatSeparator, stripSurroundingQuotes } from "./utils/helpers";
import { Simulator } from "./simulator/simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { TaskManager } from "./tasks/manager";
import { S2FPacketSetSlot } from "./utils/packets";
import { FileSystemFileLoader } from "./utils/files";
import { commandKnowledge } from "./knowledge/commands";
import { toggleHtswGui, openHtswGui, armHtswGuiDebug } from "./gui/overlay";
import { runDiffDemo } from "./gui/popovers/diff-demo";
import { getTimingStats, resetTimingStats } from "./importer/progress/timing";
import { startImport } from "./gui/right-panel/import-actions";
import { makeImportJsonQueueItem } from "./gui/state/queue";
import { isTraceEnabled, setTraceEnabled } from "./importer/traceLog";
import {
    defaultExportRoot,
    resolveModuleRelativePath,
    snbtFilenameForItemExport,
} from "./exporter/paths";
import { snbtFromItem } from "./importer/itemCapture";
import { upsertImportableEntry } from "./exporter/importJsonWriter";
import { ensureParentDirs } from "./utils/filesystem";
import { getCurrentHousingUuid } from "./knowledge";
import { getItemFromSnbt } from "./utils/nbt";
import { C10PacketCreativeInventoryAction } from "./utils/packets";

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

    if (args.length > 0 && args[0] === "diff-demo") {
        runDiffDemo();
        return;
    }

    if (args.length > 0 && args[0] === "trace") {
        if (args.length === 1) {
            ChatLib.chat(
                `&e[htsw] trace is ${isTraceEnabled() ? "&aON" : "&cOFF"}&e. ` +
                    `Use &f/htsw trace on|off&e to toggle.`
            );
            ChatLib.chat(
                `&7When ON, each import writes ./htsw/imports-trace/<timestamp>.json ` +
                    `with the full observed/desired state and every plan/apply op.`
            );
            return;
        }
        const arg = args[1].toLowerCase();
        if (arg === "on" || arg === "true" || arg === "1") {
            setTraceEnabled(true);
            ChatLib.chat("&e[htsw] trace &aON&e — next import will write ./htsw/imports-trace/<timestamp>.json");
            return;
        }
        if (arg === "off" || arg === "false" || arg === "0") {
            setTraceEnabled(false);
            ChatLib.chat("&e[htsw] trace &cOFF");
            return;
        }
        ChatLib.chat(`&c[htsw] unknown trace arg "${args[1]}". Use on|off.`);
        return;
    }

    if (args.length > 0 && args[0] === "saveitem") {
        saveItem(args.slice(1));
        return;
    }

    if (args.length > 0 && args[0] === "giveitem") {
        giveItem(args.slice(1));
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
    ChatLib.chat("&f/htsw saveitem <name> [path] &7- Save held item as .snbt");
    ChatLib.chat("&f/htsw giveitem <path> &7- Spawn an item from a .snbt file");
    ChatLib.chat("&f/htsw eta &7- Show importer ETA timing samples");
    ChatLib.chat("&f/htsw packet-probe [seconds] &7- Safely log relevant packets");
    ChatLib.chat("&f/htsw gui &7- Open the in-game HTSW dashboard");
    ChatLib.chat("&f/htsw trace [on|off] &7- Per-import JSON debug trace");
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandEta(args: string[]): void {
    if (args.length > 0 && (args[0] === "reset" || args[0] === "clear")) {
        resetTimingStats();
        ChatLib.chat("&7[eta] timing samples reset");
        return;
    }

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
    ChatLib.chat("&7[eta] timing samples");
    let printed = false;
    for (let i = 0; i < kinds.length; i++) {
        const kind = kinds[i];
        const entry = stats[kind];
        if (entry === undefined || entry.count === 0) continue;
        printed = true;
        const expected =
            entry.count === 0 ? 0 : entry.totalExpectedUnits / entry.count;
        ChatLib.chat(
            `&7${kind}: &f${entry.count} samples&7, avg &f${entry.avgMs.toFixed(0)}ms&7, expected &f${expected.toFixed(2)}u&7 => &f${entry.avgMsPerExpectedUnit.toFixed(0)}ms/u`
        );
    }
    if (!printed) {
        ChatLib.chat("&7[eta] no samples yet");
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

function saveItem(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat("&cUsage: /htsw saveitem <name> [path]");
        ChatLib.chat("&7  Saves your held item as .snbt and adds it to import.json.");
        ChatLib.chat("&7  [path] may be a directory or a specific import.json.");
        return;
    }

    const name = stripSurroundingQuotes(args[0]);
    const held = Player.getHeldItem();
    if (held === null || held === undefined) {
        ChatLib.chat("&c[htsw] You're not holding an item.");
        return;
    }

    const snbt = snbtFromItem(held, { pretty: true });
    if (snbt === null) {
        ChatLib.chat("&c[htsw] Could not read NBT from held item.");
        return;
    }

    const rawPath = args.length > 1
        ? stripSurroundingQuotes(args.slice(1).join(" "))
        : undefined;

    if (rawPath !== undefined) {
        const dest = resolveItemSavePath(rawPath);
        writeSavedItem(name, snbt, dest.rootDir, dest.importJsonPath);
    } else {
        TaskManager.run(async (ctx) => {
            const uuid = await getCurrentHousingUuid(ctx);
            const rootDir = defaultExportRoot(uuid);
            writeSavedItem(name, snbt, rootDir, `${rootDir}/import.json`);
        }).catch((err) => {
            ChatLib.chat(`&c[htsw] saveitem failed: ${err}`);
        });
    }
}

function resolveItemSavePath(rawPath: string): { rootDir: string; importJsonPath: string } {
    let path = rawPath;
    while (path.length > 0 && (path.charAt(path.length - 1) === "/" || path.charAt(path.length - 1) === "\\")) {
        path = path.substring(0, path.length - 1);
    }
    path = resolveModuleRelativePath(path);
    const norm = path.split("\\").join("/");
    if (norm.length > 5 && norm.substring(norm.length - 5).toLowerCase() === ".json") {
        const slash = norm.lastIndexOf("/");
        return { rootDir: slash > 0 ? norm.substring(0, slash) : ".", importJsonPath: norm };
    }
    return { rootDir: norm, importJsonPath: `${norm}/import.json` };
}

function writeSavedItem(
    name: string,
    snbt: string,
    rootDir: string,
    importJsonPath: string
): void {
    const itemsRoot = `${rootDir}/items`;
    const filename = snbtFilenameForItemExport(itemsRoot, name);
    const snbtPath = `${itemsRoot}/${filename}`;
    const snbtRef = `items/${filename}`;

    ensureParentDirs(snbtPath);
    FileLib.write(snbtPath, snbt, true);

    upsertImportableEntry(importJsonPath, "items", { name, nbt: snbtRef });

    ChatLib.chat(`&a[htsw] Saved item '${name}'`);
    ChatLib.chat(`&7  -> ${snbtPath}`);
    ChatLib.chat(`&7  -> ${importJsonPath}`);
}

function giveItem(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat("&cUsage: /htsw giveitem <path>");
        ChatLib.chat("&7  Spawns an item from a .snbt file into your inventory.");
        return;
    }

    // @ts-ignore field_71075_bZ = PlayerCapabilities, field_75098_d = isCreativeMode
    if (Player.asPlayerMP().player.field_71075_bZ.field_75098_d === false) {
        ChatLib.chat("&c[htsw] Must be in creative mode to give an item.");
        return;
    }

    let path = resolveModuleRelativePath(stripSurroundingQuotes(args.join(" ")));
    if (!path.endsWith(".snbt")) path += ".snbt";

    if (!FileLib.exists(path)) {
        ChatLib.chat(`&c[htsw] File not found: ${path}`);
        return;
    }

    const snbt = String(FileLib.read(path) ?? "");
    if (snbt.trim() === "") {
        ChatLib.chat(`&c[htsw] File is empty: ${path}`);
        return;
    }

    const item = getItemFromSnbt(snbt);
    const inv = Player.getInventory()!;
    let slot = -1;
    for (let i = 0; i < 36; i++) {
        if (inv.getStackInSlot(i) === null) {
            slot = i;
            break;
        }
    }
    if (slot === -1) {
        ChatLib.chat("&c[htsw] No empty inventory slot.");
        return;
    }

    const packetSlot = slot < 9 ? slot + 36 : slot;
    Client.sendPacket(new C10PacketCreativeInventoryAction(packetSlot, item.getItemStack()));
    ChatLib.chat(`&a[htsw] Gave item from ${path}`);
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

    // Pre-flight parse so we can surface diagnostics in chat BEFORE we
    // hand off to startImport (which would otherwise log a less-friendly
    // error if the parse fails inside the task).
    const sm = new SourceMap(new FileSystemFileLoader());
    // Bare and simple-relative arg paths (`htswtest`, `htswtest/
    // import.json`) resolve under the module's imports/ folder. Same
    // rule /export uses, see resolveModuleRelativePath. Explicit `./`
    // or absolute paths keep today's MC-root-relative semantics.
    const importPath = resolveModuleRelativePath(
        stripSurroundingQuotes(args.join(" "))
    );
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

    // Delegate to the GUI's `startImport` with a single `importJson`
    // queue item — same code path the "Import" button takes. This wires
    // up the live preview animation, trust mode, /gmc auto-switch, sound
    // muting, level-up chime on success, and the step-debug gate.
    //
    // Force the overlay enabled so the live preview is visible once the
    // importer opens its first housing menu (panels need a chest GUI
    // for their bounds anyway, so this is idempotent if already on).
    openHtswGui();
    const item = makeImportJsonQueueItem(importPath);
    startImport([item]);
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
