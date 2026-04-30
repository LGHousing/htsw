import { VERSION, SourceMap, parseImportablesResult, Diagnostic } from "htsw";

import { chatSeparator } from "./utils/helpers";
import { Simulator } from "./simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { importImportable } from "./importables/imports";
import { createItemRegistry } from "./importables/itemRegistry";
import { TaskManager } from "./tasks/manager";
import { S2FPacketSetSlot } from "./utils/packets";
import { FileSystemFileLoader } from "./utils/files";
import { stripSurroundingQuotes } from "./utils/strings";

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

    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    const subtitle = `&fCreated by @sndyx, @j_sse, and @callanftw`;
    ChatLib.chat(`${ChatLib.getCenteredText(subtitle)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/import &7- Import actions from HTSL files");
    ChatLib.chat("&f/simulator &7- Simulate actions from HTSL files");
    ChatLib.chat(`&7${chatSeparator()}`);
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
                "Waiting for a \"Current Item\" slot to appear…"
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
        ChatLib.chat(`&cImport failed with ${errorCount} error${errorCount === 1 ? "" : "s"}.`);
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
                await importImportable(ctx, importable, itemRegistry);
            } catch (e) {
                if (e instanceof Diagnostic) {
                    printDiagnostic(sm, e);
                } else {
                    ctx.displayMessage(`&cFailed to import: ${e}`);
                }
            }
        }
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
