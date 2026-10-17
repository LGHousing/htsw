import { SourceMap, parseImportablesResult, Diagnostic } from "htsw";
import { normalizePathSeparators } from "htsw-editor-common/project";

import {
    blockingDiagnostics,
    chatSeparator,
    stripSurroundingQuotes,
} from "../utils/helpers";
import { Simulator } from "../simulator/simulator";
import { printDiagnostic, printDiagnostics } from "../tui/diagnostics";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import { readLocalVersion } from "../autoUpdate";
import { javaType } from "../utils/java";
import { resetTimingStats } from "../housingSync/progress/timing";
import { getEventContainerCounts } from "../tasks/specifics/waitFor";
import { getTaskTracePath, setTaskTraceEnabled } from "../housingSync/trace/taskTrace";
import {
    getProgressTracePath,
    setProgressTraceEnabled,
} from "../housingSync/trace/progressTrace";
import {
    DEFAULT_STALL_MS,
    clearLagProbeSamples,
    getLagProbeSamples,
    getLagProbeThresholdMs,
    getStallStacks,
    isLagProbeEnabled,
    setLagProbeEnabled,
} from "../perf/lagProbe";
import { getSlowSpans } from "../perf/spans";
import { commandTest } from "../inGameTests/command";
import {
    canonicalPath,
    getParsePerfStats,
    parseImportJsonCurrentBlocking,
} from "../runtime/parsing/parses";
import { compactFileLabel } from "../project/pathDisplay";
import { PROJECTS_ROOT, resolveModuleRelativePath } from "../project/paths";
import { openPathInOS } from "../utils/osShell";
import { commandExport, registerExportSlashCommand } from "./export";
import { giveItem, saveItem, clearInv, viewItem } from "./debugItems";
import { commandOpen } from "./openPath";
import { printOpKindStats, dumpEtaToFile } from "./debugEta";
import { commandHeap } from "./debugHeap";
import { commandGroupPerms } from "../importables/groups/dumpPermissions";
import { commandCacheReport } from "./cacheReport";
import { commandQueue } from "./queue";
import { commandTrust } from "./trust";
import { commandWarnMode } from "./warnMode";
import { commandDiff } from "./diff";
import { answerConflictPrompt } from "../runtime/conflictPrompt";
import { bridgeStatus, rejectBridgeRun } from "../bridge/status";
import { appendRawHtslFile } from "../rawHtslImport";
import { addQueueRow, makeBulkQueueRow } from "../runtime/queue";
import { startQueue } from "../runtime/queueRunner";
import {
    getDiffCapturePath,
    isDiffCaptureEnabled,
    setDiffCaptureEnabled,
} from "../housingSync/actions/diff/diffCapture";

export type HtswSubcommand = {
    name: string;
    summary: string;
    run: (args: string[]) => void;
    aliases?: string[];
    usage?: string;
    hidden?: boolean;
};

const HTSW_SUBCOMMANDS: HtswSubcommand[] = [
    {
        name: "import",
        summary: "Import an import.json or .htsl file",
        run: commandImport,
        usage: "import <import.json|actions.htsl>",
    },
    {
        name: "trust",
        summary: "Read or change trust for the current house",
        run: commandTrust,
        usage: "trust [status|on|off]",
    },
    {
        name: "diff",
        summary: "Scan a manifest for live Housing divergence",
        run: commandDiff,
        usage: "diff <manifest-path> [--adopt]",
    },
    {
        name: "warnmode",
        summary: "Read or change the overwrite warning mode",
        run: commandWarnMode,
        usage: "warnmode [always|trusted|off]",
    },
    {
        name: "simulator",
        summary: "Simulate a project locally",
        run: commandSimulator,
        aliases: ["sim"],
        usage: "simulator [start [path] | restart | stop]",
    },
    {
        name: "export",
        summary: "Export live Housing content",
        run: commandExport,
        usage: "export <type> [path]",
    },
    {
        name: "cache",
        summary: "Explain what the importer will trust from cache for a project",
        run: commandCacheReport,
        usage: "cache <import.json>",
    },
    {
        name: "answer",
        summary: "Answer an active conflict prompt",
        run: answerConflictPrompt,
        hidden: true,
    },
    {
        name: "status",
        summary: "Print structured HTSW run status",
        run: () => ChatLib.chat(JSON.stringify(bridgeStatus())),
        hidden: true,
    },
    {
        name: "queue",
        summary: "Manage the import queue",
        run: commandQueue,
        hidden: true,
    },
    {
        name: "giveitem",
        summary: "Spawn an item from a .snbt file",
        run: giveItem,
        usage: "giveitem <path>",
    },
    {
        name: "saveitem",
        summary: "Write the item you're holding to a .snbt file",
        run: saveItem,
        usage: "saveitem <path>",
    },
    {
        name: "viewitem",
        summary: "Print an item's NBT into chat: held, a .snbt file, or a folder listing",
        run: viewItem,
        usage: "viewitem [path|@hand]",
    },
    {
        name: "clearinv",
        summary: "Clear main inventory slots 9-35 (debug)",
        run: clearInv,
        hidden: true,
    },
    {
        name: "open",
        summary: "Reveal a projects-relative path in your file explorer",
        run: commandOpen,
        usage: "open [path]",
    },
    {
        name: "projects",
        summary: "Open the projects folder in your file explorer",
        run: commandProjects,
        aliases: ["files"],
    },
    {
        name: "test",
        summary: "Run the live importer tests",
        run: commandTest,
        usage: "test [coverage|slice]",
        hidden: true,
    },
    {
        name: "groupperms",
        summary: "Dump a group's permission menu (name/type/lore) to a report",
        run: commandGroupPerms,
        usage: "groupperms [group name]",
        hidden: true,
    },
    {
        name: "version",
        summary: "Show the installed module version",
        run: commandVersion,
        aliases: ["ver"],
    },
    {
        name: "debug",
        summary: "Diagnostics: waiters, perf, traces",
        run: commandDebug,
        usage: "debug [probe]",
        hidden: true,
    },
];

// Grouped under `/htsw debug` rather than scattered as flat top-level
// subcommands, so the main `/htsw` help stays focused on user workflows.
const DEBUG_SUBCOMMANDS: HtswSubcommand[] = [
    {
        name: "waiters",
        summary: "Live waitFor counts (leak check; idle = ~0)",
        run: commandWaiters,
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
        usage: "lagprobe [on [ms]|off|clear]",
    },
    {
        name: "eta",
        summary: "Show / reset / dump op-timing (ETA) samples",
        run: commandEta,
        usage: "eta [reset|dump|trace on|off]",
    },
    {
        name: "heap",
        summary: "JVM heap summary, full GC, or .hprof dump",
        run: commandHeap,
        usage: "heap [gc|dump [live|all]]",
    },
    {
        name: "trace",
        summary: "Per-op task trace JSONL for post-mortem",
        run: commandTrace,
        usage: "trace [on|off]",
    },
    {
        name: "diffcapture",
        summary: "Capture import diff inputs for offline replay",
        run: commandDiffCapture,
        usage: "diffcapture [on|off|status]",
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

// The client entry passes its overlay, workspace, update and GUI debug
// commands; the headless entry registers only the core set.
export function registerSlashCommands(
    clientCommands: HtswSubcommand[] = [],
    clientDebugCommands: HtswSubcommand[] = []
) {
    HTSW_SUBCOMMANDS.push(...clientCommands);
    DEBUG_SUBCOMMANDS.push(...clientDebugCommands);
    register("command", (...args) => commandHtsw(args)).setName("htsw");
    registerExportSlashCommand();
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
    ChatLib.chat(ChatLib.getCenteredText(title));
    const subtitle = `&fCreated by @sndyx, @j_sse, and @callanftw`;
    ChatLib.chat(ChatLib.getCenteredText(subtitle));
    ChatLib.chat("");
    for (let i = 0; i < HTSW_SUBCOMMANDS.length; i++) {
        const command = HTSW_SUBCOMMANDS[i];
        if (command.hidden === true) continue;
        ChatLib.chat(`&f/htsw ${command.usage ?? command.name} &7- ${command.summary}`);
    }
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandTrace(args: string[]): void {
    if (args[0] === "off" || args[0] === "stop") {
        setTaskTraceEnabled(false);
        ChatLib.chat(`&7[htsw] task trace off · &f${getTaskTracePath()}`);
        return;
    }
    const path = setTaskTraceEnabled(true);
    ChatLib.chat(`&a[htsw] task trace on · &f${path}`);
}

function commandDiffCapture(args: string[]): void {
    const action = (args[0] ?? "status").toLowerCase();
    if (action === "on") {
        const path = setDiffCaptureEnabled(true);
        ChatLib.chat(`&a[htsw] diff input capture on · &f${path}`);
        return;
    }
    if (action === "off") {
        const path = setDiffCaptureEnabled(false);
        ChatLib.chat(`&7[htsw] diff input capture off · &f${path}`);
        return;
    }
    if (action === "status") {
        ChatLib.chat(
            `&7[htsw] diff input capture ${isDiffCaptureEnabled() ? "&aon" : "&coff"}` +
                ` &7· &f${getDiffCapturePath()}`
        );
        return;
    }
    ChatLib.chat("&cUsage: /htsw debug diffcapture [on|off|status]");
}

function commandProjects(): void {
    const Paths = javaType("java.nio.file.Paths");
    const Files = javaType("java.nio.file.Files");
    const dir = Paths.get(PROJECTS_ROOT).toAbsolutePath().normalize();
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
        ChatLib.chat(`&c[htsw] Couldn't open projects folder: ${String(err)}`);
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
    const norm = normalizePathSeparators(path);
    const parts = norm.split("/").filter((p) => p.length > 0);
    if (parts.length <= 4) return norm;
    return `.../${parts.slice(parts.length - 4).join("/")}`;
}

function commandLagProbe(args: string[]): void {
    if (args[0] === "on") {
        const requested = args.length < 2 ? DEFAULT_STALL_MS : Number(args[1]);
        if (!Number.isFinite(requested)) {
            ChatLib.chat("&cUsage: /htsw lagprobe on [ms]");
            return;
        }
        clearLagProbeSamples();
        setLagProbeEnabled(true, requested);
        ChatLib.chat(
            `&a[lagprobe] enabled at ${getLagProbeThresholdMs()}ms; samples cleared. ` +
                "Stalls and slow spans go to gui-debug.log."
        );
        return;
    }
    if (args[0] === "off") {
        setLagProbeEnabled(false);
        ChatLib.chat("&7[lagprobe] disabled.");
        return;
    }
    if (args[0] === "clear") {
        clearLagProbeSamples();
        ChatLib.chat("&a[lagprobe] cleared samples.");
        return;
    }
    const threshold = getLagProbeThresholdMs();
    ChatLib.chat(
        `&7[lagprobe] ${isLagProbeEnabled() ? `&aenabled &7at ${threshold}ms` : "&8disabled"}&7.`
    );
    const spans = getSlowSpans();
    if (spans.length > 0) {
        ChatLib.chat("&7[lagprobe] slowest recent spans:");
        const slowest = spans.slice().sort((a, b) => b.ms - a.ms);
        for (let i = 0; i < Math.min(slowest.length, 6); i++) {
            ChatLib.chat(`&7  &f${slowest[i].ms}ms&7 ${slowest[i].path}`);
        }
    }
    const samples = getLagProbeSamples();
    if (samples.length === 0) {
        ChatLib.chat(`&7[lagprobe] no >${threshold}ms main-thread gaps recorded.`);
        return;
    }
    ChatLib.chat(`&7[lagprobe] recent >${threshold}ms main-thread gaps:`);
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const age = Math.max(0, Math.round((Date.now() - s.at) / 1000));
        const gc = s.gcCount < 0 ? "gc n/a" : `gc +${s.gcCount}/${s.gcMs}ms`;
        const heap =
            s.heapBeforeMB < 0 ? "heap n/a" : `heap ${s.heapBeforeMB}→${s.heapAfterMB}MB`;
        ChatLib.chat(
            `&7  &f${s.gapMs}ms&7 ${age}s ago ${gc} ${heap} screen=${s.screen} ` +
                `import=${s.importing ? "yes" : "no"} task=${s.taskRunning ? "yes" : "no"} ` +
                `waiters t${s.waiters.tick}/pr${s.waiters.packetReceived}/ps${s.waiters.packetSent}/m${s.waiters.message}`
        );
        ChatLib.chat(`&8    last parse: ${s.lastParse}`);
    }
    const stacks = getStallStacks();
    if (stacks.length > 0) {
        ChatLib.chat(
            "&7[lagprobe] mid-stall client-thread stacks (also in gui-debug.log):"
        );
        for (let i = Math.max(0, stacks.length - 2); i < stacks.length; i++) {
            const lines = stacks[i];
            for (let j = 0; j < Math.min(lines.length, 9); j++) {
                ChatLib.chat(`&8  ${j === 0 ? "&7" : "  "}${lines[j]}`);
            }
        }
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

function commandImport(args: string[]) {
    const commandArgs = args;
    if (commandArgs.length === 0) {
        rejectBridgeRun("import", "expected_import_path");
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fImporter &f&l${moduleVersion()}`;
        ChatLib.chat(ChatLib.getCenteredText(title));
        ChatLib.chat("");
        ChatLib.chat("&f/htsw import <import.json|actions.htsl>");
        ChatLib.chat(
            "&f/htsw import raw <actions.htsl> &7- Append into the open action menu"
        );
        ChatLib.chat(`&7${chatSeparator()}`);
        return;
    }

    const rawMode = isRawImportToken(commandArgs[0]);
    if (rawMode && commandArgs.length === 1) {
        rejectBridgeRun("import", "expected_htsl_path", "htsw_raw_import");
        ChatLib.chat("&cUsage: /htsw import raw <actions.htsl>");
        return;
    }

    const pathArgs = rawMode ? commandArgs.slice(1) : commandArgs;
    const importPath = resolveModuleRelativePath(
        stripSurroundingQuotes(pathArgs.join(" "))
    );
    if (!FileLib.exists(importPath)) {
        rejectBridgeRun(
            "import",
            `file does not exist '${importPath}'`,
            rawMode ? "htsw_raw_import" : undefined
        );
        ChatLib.chat(`&cFile does not exist '${importPath}'`);
        return;
    }

    const lowerPath = importPath.toLowerCase();
    if (rawMode || lowerPath.endsWith(".htsl")) {
        if (!lowerPath.endsWith(".htsl")) {
            rejectBridgeRun("import", "expected_htsl_path", "htsw_raw_import");
            ChatLib.chat("&cRaw imports require a .htsl file.");
            return;
        }
        appendRawHtslFile(importPath);
        return;
    }

    const canon = canonicalPath(importPath);
    const parsed = parseImportJsonCurrentBlocking(canon);
    const result = addQueueRow(
        makeBulkQueueRow({
            op: "import",
            house: parsed.parsed?.importJson.houseUuid ?? null,
            path: canon,
            scope: { kind: "file", path: canon },
            filter: "all",
            label: `Import ${compactFileLabel(canon)}`,
        })
    );
    if (result.kind === "duplicate" || result.kind === "absorbed") {
        rejectBridgeRun("import", result.message);
        ChatLib.chat(`&e[htsw] ${result.message}`);
        return;
    }
    ChatLib.chat(`&a[htsw] Queued IMPORT_JSON ${compactFileLabel(canon)}`);
    startQueue();
}

function isRawImportToken(token: string | undefined): boolean {
    if (token === undefined) return false;
    const lower = token.toLowerCase();
    return lower === "raw" || lower === "open" || lower === "append";
}

function commandSimulator(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fSimulator Runtime &f&l${moduleVersion()}`;
        ChatLib.chat(ChatLib.getCenteredText(title));
        ChatLib.chat("");
        ChatLib.chat("&f/htsw simulator [start [path] | restart | stop]");
        ChatLib.chat("");
        ChatLib.chat("&7While a simulation is active:");
        ChatLib.chat("&f/function run <function> &7- Run a function");
        ChatLib.chat("&f// <htsl> &7- Evaluate HTSL code");
        ChatLib.chat(
            "&f/var <var|global:var|team:team:var> <set|inc|dec|mul|div> <value> &7- Change a variable"
        );
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

        const errCount = blockingDiagnostics(result.diagnostics).length;
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

