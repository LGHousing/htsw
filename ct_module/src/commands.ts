import { VERSION, SourceMap, parseImportablesResult, Diagnostic } from "htsw";

import {
    chatSeparator,
    stripSurroundingQuotes,
} from "./utils/helpers";
import { Simulator } from "./simulator/simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { TaskManager } from "./tasks/manager";
import { FileSystemFileLoader } from "./utils/fileLoaders";
import { commandKnowledge } from "./importCache/commands";
import { commandUpdate } from "./autoUpdate";
import { toggleHtswGui } from "./gui/overlay";
import { armGuiDebug } from "./gui/lib/debugLog";
import {
    getTimingStats,
    resetTimingStats,
} from "./housingSync/progress/timing";
import { COST } from "./housingSync/progress/costs";
import { getEventContainerCounts } from "./tasks/specifics/waitFor";
import { getTreePerfStats } from "./gui/left-panel/importables/tree";
import { resetOnboarding } from "./gui/persistence/onboarding";
import { rearmTourAutoStart } from "./gui/popovers/tour";
import { isPacketOrderProbeActive } from "./housingSync/diagnostics/packetOrderProbe";
import {
    getImportTracePath,
    setImportTraceEnabled,
} from "./housingSync/trace/importTrace";
import {
    getProgressTracePath,
    setProgressTraceEnabled,
} from "./housingSync/trace/progressTrace";
import {
    clearLagProbeSamples,
    getLagProbeSamples,
} from "./diagnostics/lagProbe";
import { getCurrentHousingUuid } from "./importCache";
import { isInCreativeMode } from "./housingSync/sideEffects";
import { startImport } from "./gui/right-panel/import-tab/importController";
import { canonicalPath, getParsePerfStats } from "./gui/parsing/parses";
import { compactFileLabel } from "./gui/lib/pathDisplay";
import { snbtFromItem } from "./housingSync/itemCapture";
import {
    defaultExportRoot,
    resolveModuleRelativePath,
    snbtTargetForItemExport,
} from "./project/paths";
import { upsertImportableEntry } from "./project/importJsonMutations";
import { ensureParentDirs } from "./utils/filesystem";
import { getItemFromSnbt } from "./utils/nbt";
import { C10PacketCreativeInventoryAction } from "./utils/packets";

type HtswSubcommand = {
    name: string;
    summary: string;
    run: (args: string[]) => void;
    aliases?: string[];
    usage?: string;
    hidden?: boolean;
};

const HTSW_SUBCOMMANDS: HtswSubcommand[] = [
    {
        name: "knowledge",
        summary: "Inspect local import/export knowledge",
        run: commandKnowledge,
    },
    {
        name: "saveitem",
        summary: "Save held item as .snbt + import.json",
        run: saveItem,
        usage: "saveitem <name> [path]",
    },
    {
        name: "giveitem",
        summary: "Spawn an item from a .snbt file",
        run: giveItem,
        usage: "giveitem <path>",
    },
    {
        name: "eta",
        summary: "Show / reset / dump / trace ETA samples",
        run: commandEta,
        usage: "eta [reset|dump|trace on|off]",
    },
    {
        name: "trace",
        summary: "Per-op import trace JSONL for post-mortem",
        run: commandTrace,
        usage: "trace [on|off]",
    },
    {
        name: "gui",
        summary: "Open the in-game HTSW dashboard",
        run: commandGui,
    },
    {
        name: "waiters",
        summary: "Show live waitFor counts (leak check; idle = ~0)",
        run: commandWaiters,
    },
    {
        name: "update",
        summary: "Check for and install CT module updates",
        run: commandUpdate,
        usage: "update [check]",
    },
    {
        name: "recompile",
        summary: "Rebuild + reload the module",
        run: () => recompile(),
    },
    {
        name: "tour",
        summary: "Reset GUI onboarding",
        run: commandTour,
        aliases: ["onboarding"],
        hidden: true,
    },
    {
        name: "treeperf",
        summary: "Show importables tree render stats",
        run: commandTreePerf,
        hidden: true,
    },
    {
        name: "parseperf",
        summary: "Show recent import.json parse timings",
        run: commandParsePerf,
        hidden: true,
    },
    {
        name: "lagprobe",
        summary: "Show recent main-thread stall samples",
        run: commandLagProbe,
        hidden: true,
    },
];

export function registerCommands() {
    register("command", (...args) => commandHtsw(args)).setName("htsw");
    register("command", (...args) => commandImport(args)).setName("import");
    register("command", (...args) => commandSimulator(args))
        .setName("simulator")
        .setAliases("sim");
}

function commandHtsw(args: string[]) {
    if (args.length > 0) {
        const command = findHtswSubcommand(args[0]);
        if (command !== null) {
            command.run(args.slice(1));
            return;
        }
        ChatLib.chat(`&cUnknown /htsw subcommand '${args[0]}'.`);
    }

    printHtswHelp();
}

function findHtswSubcommand(name: string): HtswSubcommand | null {
    const key = name.toLowerCase();
    for (let i = 0; i < HTSW_SUBCOMMANDS.length; i++) {
        const command = HTSW_SUBCOMMANDS[i];
        if (command.name === key) return command;
        if (command.aliases !== undefined && command.aliases.indexOf(key) >= 0) {
            return command;
        }
    }
    return null;
}

function printHtswHelp(): void {
    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    const subtitle = `&fCreated by @sndyx, @j_sse, and @callanftw`;
    ChatLib.chat(`${ChatLib.getCenteredText(subtitle)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/import &7- Import actions from HTSL files");
    ChatLib.chat("&f/simulator &7- Simulate actions from HTSL files");
    for (let i = 0; i < HTSW_SUBCOMMANDS.length; i++) {
        const command = HTSW_SUBCOMMANDS[i];
        if (command.hidden === true) continue;
        ChatLib.chat(`&f/htsw ${command.usage ?? command.name} &7- ${command.summary}`);
    }
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandTrace(args: string[]): void {
    if (args[0] === "off" || args[0] === "stop") {
        setImportTraceEnabled(false);
        ChatLib.chat(`&7[htsw] import trace off · &f${getImportTracePath()}`);
        return;
    }
    const path = setImportTraceEnabled(true);
    ChatLib.chat(`&a[htsw] import trace on · &f${path}`);
}

function commandGui(args: string[]): void {
    if (args[0] === "debug") {
        const secs = Math.max(1, parseInt(args[1] ?? "10", 10) || 10);
        armGuiDebug(secs);
        ChatLib.chat(`&a[htsw] gui debug armed for ${secs}s -> gui-debug.log`);
        return;
    }
    const nowEnabled = toggleHtswGui();
    ChatLib.chat(`&e[htsw] gui ${nowEnabled ? "&aenabled" : "&cdisabled"}`);
}

function commandWaiters(): void {
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
}

function commandTour(): void {
    resetOnboarding();
    rearmTourAutoStart();
    ChatLib.chat(
        "&a[htsw] Onboarding reset — open a Housing menu to start the tour. " +
        "The sample-project button is back too."
    );
}

function commandTreePerf(): void {
    const s = getTreePerfStats();
    ChatLib.chat(
        `&7[treeperf] importables tree: ${s.rows} rows, ` +
        `${s.builds} rebuild(s), last ${s.lastBuildMs}ms, max ${s.maxBuildMs}ms. ` +
        `Rebuilds should tick ~3/s while the tab is open (300ms TTL), not 60/s.`
    );
}

function commandParsePerf(): void {
    const entries = getParsePerfStats();
    if (entries.length === 0) {
        ChatLib.chat("&7[parseperf] no parse cache activity recorded yet.");
        return;
    }
    ChatLib.chat("&7[parseperf] recent import.json parse/cache reads:");
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const age = Math.max(0, Math.round((Date.now() - e.at) / 1000));
        ChatLib.chat(
            `&7  ${e.source} &f${e.ms}ms &8${age}s ago &7${shortPerfPath(e.path)}`
        );
    }
}

function shortPerfPath(path: string): string {
    const norm = path.replace(/\\/g, "/");
    const parts = norm.split("/").filter((p) => p.length > 0);
    if (parts.length <= 4) return norm;
    return `.../${parts.slice(parts.length - 4).join("/")}`;
}

function commandLagProbe(args: string[]): void {
    if (args[0] === "clear") {
        clearLagProbeSamples();
        ChatLib.chat("&a[lagprobe] cleared samples.");
        return;
    }
    const samples = getLagProbeSamples();
    if (samples.length === 0) {
        ChatLib.chat("&7[lagprobe] no >250ms main-thread gaps recorded.");
        return;
    }
    ChatLib.chat("&7[lagprobe] recent >250ms main-thread gaps:");
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const age = Math.max(0, Math.round((Date.now() - s.at) / 1000));
        ChatLib.chat(
            `&7  &f${s.gapMs}ms&7 ${age}s ago screen=${s.screen} ` +
            `import=${s.importing ? "yes" : "no"} task=${s.taskRunning ? "yes" : "no"} ` +
            `waiters t${s.waiters.tick}/pr${s.waiters.packetReceived}/ps${s.waiters.packetSent}/m${s.waiters.message}`
        );
        ChatLib.chat(`&8    last parse: ${s.lastParse}`);
    }
}

function itemSaveDestination(
    explicitPath: string
): { rootDir: string; importJsonPath: string } {
    let path = explicitPath;
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
    const target = snbtTargetForItemExport(importJsonPath, rootDir, name);

    ensureParentDirs(target.snbtPath);
    FileLib.write(target.snbtPath, snbt, true);

    upsertImportableEntry(target.importJsonPath, "items", { name, nbt: target.snbtReference });

    ChatLib.chat(`&a[htsw] Saved item '${name}'`);
    ChatLib.chat(`&7  -> ${target.snbtPath}`);
    ChatLib.chat(`&7  -> ${target.importJsonPath}`);
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
        const dest = itemSaveDestination(rawPath);
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

function giveItem(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat("&cUsage: /htsw giveitem <path>");
        ChatLib.chat("&7  Spawns an item from a .snbt file into your inventory.");
        return;
    }

    if (!isInCreativeMode()) {
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

    if (args.length > 0 && args[0] === "trace") {
        if (args[1] === "off" || args[1] === "stop") {
            setProgressTraceEnabled(false);
            ChatLib.chat(`&7[eta] progress trace off · &f${getProgressTracePath()}`);
        } else {
            const path = setProgressTraceEnabled(true);
            ChatLib.chat(`&a[eta] progress trace on · &f${path}`);
        }
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

    const importPath = resolveModuleRelativePath(stripSurroundingQuotes(args.join(" ")));
    if (!FileLib.exists(importPath)) {
        ChatLib.chat(`&cimport.json file does not exist '${importPath}'`);
        return;
    }

    // Route through the same path the GUI's Import button uses so a chat
    // import gets the live-preview animation, trust mode, sounds, and
    // progress UI. buildBatches parses the file on demand via the parse
    // cache and gates on diagnostics, so no separate parse pass is needed.
    const canon = canonicalPath(importPath);
    startImport([
        {
            operation: "import",
            kind: "importJson",
            sourcePath: canon,
            label: compactFileLabel(canon),
        },
    ]);
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
