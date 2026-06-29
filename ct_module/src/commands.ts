import {
    SourceMap,
    parseActionsResult,
    parseImportablesResult,
    Diagnostic,
} from "htsw";

import {
    chatSeparator,
    stripSurroundingQuotes,
} from "./utils/helpers";
import { Simulator } from "./simulator/simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { TaskManager } from "./tasks/manager";
import { FileSystemFileLoader } from "./utils/fileLoaders";
import { commandUpdate, readLocalVersion } from "./autoUpdate";
import { toggleHtswGui } from "./gui/overlay";
import {
    getTimingStats,
    resetTimingStats,
} from "./housingSync/progress/timing";
import { COST } from "./housingSync/progress/costs";
import {
    getEventContainerCounts,
    resetEventContainers,
} from "./tasks/specifics/waitFor";
import { getTreePerfStats } from "./gui/left-panel/importables/tree";
import { resetOnboarding } from "./gui/persistence/onboarding";
import { rearmTourAutoStart } from "./gui/popovers/tour";
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
} from "./perf/lagProbe";
import { commandTest } from "./testSuite/command";
import { isInCreativeMode } from "./housingSync/sideEffects";
import { appendActionsToOpenActionList } from "./housingSync/actions/applyDiff";
import { createItemRegistry } from "./importables/itemRegistry";
import { isImportRunning, setImportRunning } from "./housingSync/runtimeState";
import { startImport } from "./gui/right-panel/import-tab/importController";
import { canonicalPath, getParsePerfStats } from "./gui/parsing/parses";
import { compactFileLabel } from "./gui/lib/pathDisplay";
import { snbtFromItem } from "./housingSync/itemCapture";
import {
    PROJECTS_ROOT,
    resolveModuleRelativePath,
} from "./project/paths";
import { ensureParentDirs } from "./utils/filesystem";
import { openPathInOS } from "./utils/osShell";
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
        name: "saveitem",
        summary: "Save held item as .snbt",
        run: saveItem,
        usage: "saveitem <path>",
    },
    {
        name: "giveitem",
        summary: "Spawn an item from a .snbt file",
        run: giveItem,
        usage: "giveitem <path>",
    },
    {
        name: "projects",
        summary: "Open the projects folder in your file explorer",
        run: commandProjects,
    },
    {
        name: "test",
        summary: "Run the live importer tests",
        run: commandTest,
        usage: "test [coverage|slice]",
    },
    {
        name: "gui",
        summary: "Toggle the in-game HTSW dashboard",
        run: commandGui,
    },
    {
        name: "update",
        summary: "Manage module updates",
        run: commandUpdate,
        usage: "update [check|status|enable|disable]",
    },
    {
        name: "version",
        summary: "Show the installed module version",
        run: commandVersion,
        aliases: ["ver"],
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
        name: "debug",
        summary: "Diagnostics: waiters, perf, traces",
        run: commandDebug,
        usage: "debug [probe]",
    },
];

// Grouped under `/htsw debug` rather than scattered as flat top-level
// subcommands — they only matter when diagnosing the importer, and a single
// namespace keeps `/htsw` help readable.
const DEBUG_SUBCOMMANDS: HtswSubcommand[] = [
    {
        name: "waiters",
        summary: "Live waitFor counts (leak check; idle = ~0)",
        run: commandWaiters,
    },
    {
        name: "treeperf",
        summary: "Importables tree render stats",
        run: commandTreePerf,
    },
    {
        name: "parseperf",
        summary: "Recent import.json parse timings",
        run: commandParsePerf,
    },
    {
        name: "lagprobe",
        summary: "Recent main-thread stall samples",
        run: commandLagProbe,
        usage: "lagprobe [clear]",
    },
    {
        name: "eta",
        summary: "Show / reset / dump op-timing (ETA) samples",
        run: commandEta,
        usage: "eta [reset|dump|trace on|off]",
    },
    {
        name: "trace",
        summary: "Per-op import trace JSONL for post-mortem",
        run: commandTrace,
        usage: "trace [on|off]",
    },
];

function commandDebug(args: string[]): void {
    if (args.length > 0) {
        const key = args[0].toLowerCase();
        for (let i = 0; i < DEBUG_SUBCOMMANDS.length; i++) {
            if (DEBUG_SUBCOMMANDS[i].name === key) {
                DEBUG_SUBCOMMANDS[i].run(args.slice(1));
                return;
            }
        }
        ChatLib.chat(`&cUnknown /htsw debug probe '${args[0]}'.`);
    }
    ChatLib.chat("&7[htsw] debug probes:");
    for (let i = 0; i < DEBUG_SUBCOMMANDS.length; i++) {
        const c = DEBUG_SUBCOMMANDS[i];
        ChatLib.chat(`&f/htsw debug ${c.usage ?? c.name} &7- ${c.summary}`);
    }
}

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
    const title = `&e&lHTSW &f&l${moduleVersion()}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    const subtitle = `&fCreated by @sndyx, @j_sse, and @callanftw`;
    ChatLib.chat(`${ChatLib.getCenteredText(subtitle)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/import &7- Import an import.json or .htsl file");
    ChatLib.chat("&f/simulator &7- Simulate a project locally");
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

function commandGui(): void {
    const nowEnabled = toggleHtswGui();
    ChatLib.chat(`&e[htsw] gui ${nowEnabled ? "&aenabled" : "&cdisabled"}`);
}

function commandProjects(): void {
    const Paths = Java.type("java.nio.file.Paths");
    const Files = Java.type("java.nio.file.Files");
    const dir = Paths.get(String(PROJECTS_ROOT)).toAbsolutePath().normalize();
    try {
        Files.createDirectories(dir);
    } catch (_e) {
        // best-effort; openPathInOS surfaces a real failure below
    }
    const abs = String(dir.toString());
    try {
        openPathInOS(abs);
        ChatLib.chat("&a[htsw] Opened projects folder");
        ChatLib.chat(`&7  ${abs}`);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Couldn't open projects folder: ${err}`);
        ChatLib.chat(`&7  ${abs}`);
    }
}

function moduleVersion(): string {
    const v = readLocalVersion();
    return v !== null ? `v${v}` : "v?";
}

function commandVersion(): void {
    const v = readLocalVersion();
    if (v === null) {
        ChatLib.chat("&c[htsw] Couldn't read the installed version (metadata.json).");
        return;
    }
    ChatLib.chat(`&e&lHTSW &fv${v}`);
    ChatLib.chat("&7Run &f/htsw update&7 to check for a newer version.");
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

function saveItem(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat("&cUsage: /htsw saveitem <path>");
        ChatLib.chat("&7  Saves your held item as .snbt under the projects folder.");
        ChatLib.chat("&7  Use folder/name to save inside a folder.");
        return;
    }

    const rawPath = stripSurroundingQuotes(args.join(" ")).trim();
    if (rawPath.length === 0) {
        ChatLib.chat("&c[htsw] saveitem path cannot be empty.");
        return;
    }

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

    let path = resolveModuleRelativePath(rawPath).split("\\").join("/");
    if (!path.toLowerCase().endsWith(".snbt")) path += ".snbt";

    try {
        ensureParentDirs(path);
        FileLib.write(path, snbt, true);
        ChatLib.chat("&a[htsw] Saved item");
        ChatLib.chat(`&7  -> ${path}`);
    } catch (err) {
        ChatLib.chat(`&c[htsw] saveitem failed: ${err}`);
    }
}

function javaPath(path: string): any {
    return Java.type("java.nio.file.Paths").get(String(path));
}

function isRegularFile(path: string): boolean {
    try {
        const Files = Java.type("java.nio.file.Files");
        return Files.isRegularFile(javaPath(path));
    } catch (_e) {
        return false;
    }
}

function isDirectory(path: string): boolean {
    try {
        const Files = Java.type("java.nio.file.Files");
        return Files.isDirectory(javaPath(path));
    } catch (_e) {
        return false;
    }
}

function listSnbtFiles(path: string): string[] {
    const out: string[] = [];
    const Files = Java.type("java.nio.file.Files");
    const stream = Files.newDirectoryStream(javaPath(path));
    try {
        const it = stream.iterator();
        while (it.hasNext()) {
            const child = it.next();
            const childPath = String(child.toString()).split("\\").join("/");
            if (Files.isRegularFile(child) && childPath.toLowerCase().endsWith(".snbt")) {
                out.push(childPath);
            }
        }
    } finally {
        try { stream.close(); } catch (_e) {}
    }
    out.sort();
    return out;
}

function emptyInventorySlots(): number[] {
    const inv = Player.getInventory()!;
    const slots: number[] = [];
    for (let i = 0; i < 36; i++) {
        if (inv.getStackInSlot(i) === null) slots.push(i);
    }
    return slots;
}

function packetSlotForInventorySlot(slot: number): number {
    return slot < 9 ? slot + 36 : slot;
}

function giveItemFromFile(path: string, slot: number): boolean {
    let snbt: string;
    try {
        snbt = String(FileLib.read(path) ?? "");
    } catch (err) {
        ChatLib.chat(`&c[htsw] Could not read ${path}: ${err}`);
        return false;
    }
    if (snbt.trim() === "") {
        ChatLib.chat(`&c[htsw] File is empty: ${path}`);
        return false;
    }

    try {
        const item = getItemFromSnbt(snbt);
        Client.sendPacket(new C10PacketCreativeInventoryAction(packetSlotForInventorySlot(slot), item.getItemStack()));
        ChatLib.chat(`&a[htsw] Gave item from ${path}`);
        return true;
    } catch (err) {
        ChatLib.chat(`&c[htsw] Could not give item from ${path}: ${err}`);
        return false;
    }
}

function resolveGiveItemFilePath(rawPath: string): string {
    let path = resolveModuleRelativePath(rawPath).split("\\").join("/");
    if (!path.toLowerCase().endsWith(".snbt")) path += ".snbt";
    return path;
}

function parseGiveItemFolderArgs(args: string[]): { rawPath: string; skip: number } {
    if (args.length > 1 && /^\d+$/.test(args[args.length - 1])) {
        return {
            rawPath: stripSurroundingQuotes(args.slice(0, args.length - 1).join(" ")).trim(),
            skip: Number(args[args.length - 1]),
        };
    }
    return { rawPath: stripSurroundingQuotes(args.join(" ")).trim(), skip: 0 };
}

function commandArg(value: string): string {
    if (/\s/.test(value)) return `"${value.split("\"").join("\\\"")}"`;
    return value;
}

function giveItem(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat("&cUsage: /htsw giveitem <path> [skip]");
        ChatLib.chat("&7  Spawns an item from a .snbt file, or all .snbt files in a folder.");
        return;
    }

    if (!isInCreativeMode()) {
        ChatLib.chat("&c[htsw] Must be in creative mode to give an item.");
        return;
    }

    const rawPath = stripSurroundingQuotes(args.join(" ")).trim();
    if (rawPath.length === 0) {
        ChatLib.chat("&c[htsw] giveitem path cannot be empty.");
        return;
    }

    const filePath = resolveGiveItemFilePath(rawPath);
    if (isRegularFile(filePath)) {
        const slots = emptyInventorySlots();
        if (slots.length === 0) {
            ChatLib.chat("&c[htsw] No empty inventory slot.");
            return;
        }
        giveItemFromFile(filePath, slots[0]);
        return;
    }

    const folderArgs = parseGiveItemFolderArgs(args);
    if (folderArgs.rawPath.length === 0) {
        ChatLib.chat("&c[htsw] giveitem folder path cannot be empty.");
        return;
    }

    const dirPath = resolveModuleRelativePath(folderArgs.rawPath).split("\\").join("/");
    if (!isDirectory(dirPath)) {
        ChatLib.chat(`&c[htsw] File or folder not found: ${dirPath}`);
        ChatLib.chat(`&7  Tried file: ${filePath}`);
        return;
    }

    let files: string[];
    try {
        files = listSnbtFiles(dirPath);
    } catch (err) {
        ChatLib.chat(`&c[htsw] Could not list folder ${dirPath}: ${err}`);
        return;
    }
    if (files.length === 0) {
        ChatLib.chat(`&c[htsw] No .snbt files found in ${dirPath}`);
        return;
    }
    if (folderArgs.skip >= files.length) {
        ChatLib.chat(`&c[htsw] Skip ${folderArgs.skip} is past the ${files.length} item${files.length === 1 ? "" : "s"} in ${dirPath}.`);
        return;
    }

    const slots = emptyInventorySlots();
    if (slots.length === 0) {
        ChatLib.chat("&c[htsw] No empty inventory slot.");
        return;
    }
    const remaining = files.length - folderArgs.skip;
    if (slots.length < remaining) {
        ChatLib.chat(`&e[htsw] Only ${slots.length} empty slot${slots.length === 1 ? "" : "s"}, giving ${slots.length} of ${remaining} remaining items.`);
    }

    const count = Math.min(slots.length, remaining);
    let gave = 0;
    for (let i = 0; i < count; i++) {
        if (giveItemFromFile(files[folderArgs.skip + i], slots[i])) gave++;
    }
    ChatLib.chat(`&7[htsw] Gave ${gave}/${files.length} item${files.length === 1 ? "" : "s"} from ${dirPath}`);
    const nextSkip = folderArgs.skip + count;
    if (nextSkip < files.length) {
        ChatLib.chat(`&7  Next: &f/htsw giveitem ${commandArg(folderArgs.rawPath)} ${nextSkip}`);
    }
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
        const title = `&e&lHTSW &fImporter &f&l${moduleVersion()}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/import <import.json|actions.htsl>");
        ChatLib.chat("&f/import raw <actions.htsl> &7- Append into the open action menu");
        ChatLib.chat(`&7${chatSeparator()}`);
        return;
    }

    const rawMode = isRawImportToken(args[0]);
    if (rawMode && args.length === 1) {
        ChatLib.chat("&cUsage: /import raw <actions.htsl>");
        return;
    }

    const pathArgs = rawMode ? args.slice(1) : args;
    const importPath = resolveModuleRelativePath(stripSurroundingQuotes(pathArgs.join(" ")));
    if (!FileLib.exists(importPath)) {
        ChatLib.chat(`&cFile does not exist '${importPath}'`);
        return;
    }

    const lowerPath = importPath.toLowerCase();
    if (rawMode || lowerPath.endsWith(".htsl")) {
        if (!lowerPath.endsWith(".htsl")) {
            ChatLib.chat("&cRaw imports require a .htsl file.");
            return;
        }
        startRawHtslImport(importPath);
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

function isRawImportToken(token: string | undefined): boolean {
    if (token === undefined) return false;
    const lower = token.toLowerCase();
    return lower === "raw" || lower === "open" || lower === "append";
}

function startRawHtslImport(path: string): void {
    if (isImportRunning() || TaskManager.hasRunningTasks()) {
        ChatLib.chat("&c[htsw] An import (or another task) is already running — wait for it to finish first.");
        return;
    }

    const sm = new SourceMap(new FileSystemFileLoader());
    const result = parseActionsResult(sm, path);
    printDiagnostics(sm, result.diagnostics);

    const errCount = countBlockingDiagnostics(result.diagnostics);
    if (errCount > 0) {
        printDiagnostic(
            sm,
            Diagnostic.error(
                `Raw HTSL import failed with ${errCount} error${errCount === 1 ? "" : "s"}`
            )
        );
        return;
    }

    if (result.value.length === 0) {
        ChatLib.chat(`&c[htsw] No actions found in ${path}`);
        return;
    }

    const items = createItemRegistry([], result.gcx);
    TaskManager.run(async (ctx) => {
        setImportRunning(true);
        try {
            const purged = resetEventContainers();
            if (purged > 0) {
                ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`);
            }

            if (ctx.tryGetMenuItemSlot("Add Action") === null) {
                throw new Error("Open a Housing action-list menu first.");
            }

            const count = result.value.length;
            ChatLib.chat(
                `&7[htsw] Appending ${count} action${count === 1 ? "" : "s"} from ${compactFileLabel(path)}`
            );
            await appendActionsToOpenActionList(ctx, result.value, items);
            ChatLib.chat(
                `&a[htsw] Appended ${count} action${count === 1 ? "" : "s"} from ${compactFileLabel(path)}`
            );
        } finally {
            setImportRunning(false);
        }
    }).catch((err: unknown) => {
        setImportRunning(false);
        if (err instanceof Diagnostic) {
            printDiagnostic(sm, err);
            return;
        }
        ChatLib.chat(`&c[htsw] Raw HTSL import failed: ${err}`);
    });
}

function commandSimulator(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fSimulator Runtime &f&l${moduleVersion()}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/simulator [start [path] | restart | stop ]");
        ChatLib.chat("");
        ChatLib.chat("&7While a simulation is active:");
        ChatLib.chat("&f/function run <function> &7- Run a function");
        ChatLib.chat("&f// <htsl> &7- Evaluate HTSL code");
        ChatLib.chat("&f/var <var|global:var|team:team:var> <set|inc|dec|mul|div> <value> &7- Change a variable");
        ChatLib.chat("&f/vars [filter] &7- Dump player variables");
        ChatLib.chat("&f/globalvars [filter] &7- Dump global variables");
        ChatLib.chat("&f/teamvars <team> [filter] &7- Dump team variables");
        ChatLib.chat(`&7${chatSeparator()}`);
        return;
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
