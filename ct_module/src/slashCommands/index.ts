import { SourceMap, parseActionsResult, parseImportablesResult, Diagnostic } from "htsw";

import { chatSeparator, stripSurroundingQuotes } from "../utils/helpers";
import { Simulator } from "../simulator/simulator";
import { printDiagnostic, printDiagnostics } from "../tui/diagnostics";
import { recompile } from "./recompile";
import { TaskManager } from "../tasks/manager";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import { commandUpdate, readLocalVersion } from "../autoUpdate";
import { getMinecraft, javaType } from "../utils/java";
import { clickHtswOverlay, scrollHtswOverlay, toggleHtswGui } from "../gui/overlay";
import { resetTimingStats } from "../housingSync/progress/timing";
import { getEventContainerCounts } from "../tasks/specifics/waitFor";
import { getTreePerfStats } from "../gui/left-panel/projects/tree";
import { clearFramePerf, getFramePerfStats } from "../gui/lib/framePerf";
import { resetOnboarding } from "../gui/persistence/onboarding";
import { rearmTourAutoStart } from "../gui/popovers/tour";
import { getTaskTracePath, setTaskTraceEnabled } from "../housingSync/trace/taskTrace";
import {
    getProgressTracePath,
    setProgressTraceEnabled,
} from "../housingSync/trace/progressTrace";
import {
    clearLagProbeSamples,
    getLagProbeSamples,
    getStallStacks,
    isLagProbeEnabled,
    setLagProbeEnabled,
} from "../perf/lagProbe";
import { commandTest } from "../testSuite/command";
import { appendActionsToOpenActionList } from "../housingSync/actions/apply";
import { createProjectItemIndex } from "../importables/items/projectItems";
import { createItemFieldResolver } from "../importables/items/resolveItem";
import { startImport } from "../gui/right-panel/import-tab/taskController";
import { runHousingSyncTask } from "../housingSync/taskRunner";
import { canonicalPath, getParsePerfStats } from "../gui/parsing/parses";
import { compactFileLabel } from "../gui/lib/pathDisplay";
import { PROJECTS_ROOT, resolveModuleRelativePath } from "../project/paths";
import { openPathInOS } from "../utils/osShell";
import { commandExport, registerExportSlashCommand } from "./export";
import { giveItem, clearInv } from "./debugItems";
import { printOpKindStats, dumpEtaToFile } from "./debugEta";
import { commandGroupPerms } from "../importables/groups/dumpPermissions";

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
        name: "import",
        summary: "Import an import.json or .htsl file",
        run: commandImport,
        usage: "import <import.json|actions.htsl>",
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
        name: "giveitem",
        summary: "Spawn an item from a .snbt file",
        run: giveItem,
        usage: "giveitem <path>",
    },
    {
        name: "clearinv",
        summary: "Clear main inventory slots 9-35 (debug)",
        run: clearInv,
        hidden: true,
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
    },
    {
        name: "groupperms",
        summary: "Dump a group's permission menu (name/type/lore) to a report",
        run: commandGroupPerms,
        usage: "groupperms [group name]",
        hidden: true,
    },
    {
        name: "gui",
        summary: "Toggle the in-game HTSW dashboard",
        run: commandGui,
    },
    {
        name: "bridge",
        summary: "Drive the HTSW overlay from local integrations",
        run: commandBridge,
        hidden: true,
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
// subcommands, so the main `/htsw` help stays focused on user workflows.
const DEBUG_SUBCOMMANDS: HtswSubcommand[] = [
    {
        name: "waiters",
        summary: "Live waitFor counts (leak check; idle = ~0)",
        run: commandWaiters,
    },
    {
        name: "treeperf",
        summary: "Projects tree render stats",
        run: commandTreePerf,
    },
    {
        name: "guiperf",
        summary: "Overlay frame pacing + render cost (scroll while sampling)",
        run: commandGuiPerf,
        usage: "guiperf [clear]",
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
        usage: "lagprobe [on|off|clear]",
    },
    {
        name: "eta",
        summary: "Show / reset / dump op-timing (ETA) samples",
        run: commandEta,
        usage: "eta [reset|dump|trace on|off]",
    },
    {
        name: "trace",
        summary: "Per-op task trace JSONL for post-mortem",
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

export function registerSlashCommands() {
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

function commandGui(): void {
    const nowEnabled = toggleHtswGui();
    ChatLib.chat(`&e[htsw] gui ${nowEnabled ? "&aenabled" : "&cdisabled"}`);
}

function commandBridge(args: string[]): void {
    const action = (args[0] ?? "").toLowerCase();
    const point = bridgePoint(args.slice(1));
    if (point === null) return;
    if (action === "click") {
        const buttonName = (args[3] ?? "left").toLowerCase();
        const buttons: Partial<Record<string, number>> = { left: 0, right: 1, middle: 2 };
        const button = buttons[buttonName];
        if (button === undefined) {
            ChatLib.chat(
                "&cUsage: /htsw bridge click <x> <y> [left|right|middle] [framebuffer|gui]"
            );
            return;
        }
        clickHtswOverlay(point.x, point.y, button);
        return;
    }
    if (action === "scroll") {
        const delta = Number(args[3]);
        if (!isFinite(delta) || delta === 0) {
            ChatLib.chat(
                "&cUsage: /htsw bridge scroll <x> <y> <delta> [framebuffer|gui]"
            );
            return;
        }
        scrollHtswOverlay(point.x, point.y, delta);
        return;
    }
    ChatLib.chat("&cUsage: /htsw bridge <click|scroll> ...");
}

function bridgePoint(args: string[]): { x: number; y: number } | null {
    let x = Number(args[0]);
    let y = Number(args[1]);
    if (!isFinite(x) || !isFinite(y)) {
        ChatLib.chat("&cHTSW bridge coordinates must be numbers.");
        return null;
    }
    const space = (args[3] ?? "framebuffer").toLowerCase();
    if (space === "framebuffer") {
        const mc = getMinecraft();
        x = Math.floor((x * Renderer.screen.getWidth()) / mc.field_71443_c);
        y = Math.floor((y * Renderer.screen.getHeight()) / mc.field_71440_d);
    } else if (space !== "gui") {
        ChatLib.chat("&cHTSW bridge coordinate space must be framebuffer or gui.");
        return null;
    }
    if (
        x < 0 ||
        y < 0 ||
        x >= Renderer.screen.getWidth() ||
        y >= Renderer.screen.getHeight()
    ) {
        ChatLib.chat("&cHTSW bridge coordinates are outside the current screen.");
        return null;
    }
    return { x, y };
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

function commandTour(): void {
    resetOnboarding();
    rearmTourAutoStart();
    ChatLib.chat(
        "&a[htsw] Onboarding reset — open a Housing menu to start the tour. " +
            "The sample-project button is back too."
    );
}

function commandGuiPerf(args: string[]): void {
    if (args.length > 0 && args[0].toLowerCase() === "clear") {
        clearFramePerf();
        ChatLib.chat(
            "&7[guiperf] samples cleared. Scroll around, then run /htsw debug guiperf."
        );
        return;
    }
    const s = getFramePerfStats();
    if (s.frames === 0) {
        ChatLib.chat("&7[guiperf] no painted frames sampled yet — open the GUI first.");
        return;
    }
    const fps = s.avgGapMs > 0 ? Math.round(1000 / s.avgGapMs) : 0;
    ChatLib.chat(
        `&7[guiperf] last ${s.frames} painted frames: ` +
            `avg gap ${s.avgGapMs.toFixed(1)}ms (~${fps}fps), ` +
            `p95 ${s.p95GapMs}ms, max ${s.maxGapMs}ms.`
    );
    ChatLib.chat(
        `&7[guiperf] overlay render: rebuild frames ${s.rebuiltFrames}/${s.frames} ` +
            `avg ${s.avgRebuildMs.toFixed(1)}ms (max ${s.maxRebuildMs}ms), ` +
            `draw-only avg ${s.avgDrawOnlyMs.toFixed(1)}ms. ` +
            `Scrolling rebuilds every frame — smooth needs rebuild avg well under the frame budget.`
    );
    if (s.phases.length > 0) {
        let parts = "";
        for (let i = 0; i < s.phases.length; i++) {
            if (i > 0) parts += ", ";
            parts += `${s.phases[i].name} ${s.phases[i].msPerRebuild.toFixed(1)}ms`;
        }
        ChatLib.chat(
            `&7[guiperf] timed rebuild slices: ${parts}. ` +
                `layout-total includes child builders such as tree/codeview.`
        );
    }
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
    if (args[0] === "on") {
        clearLagProbeSamples();
        setLagProbeEnabled(true);
        ChatLib.chat("&a[lagprobe] enabled; samples cleared.");
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
    ChatLib.chat(`&7[lagprobe] ${isLagProbeEnabled() ? "&aenabled" : "&8disabled"}&7.`);
    const samples = getLagProbeSamples();
    if (samples.length === 0) {
        ChatLib.chat("&7[lagprobe] no >250ms main-thread gaps recorded.");
        return;
    }
    ChatLib.chat("&7[lagprobe] recent >250ms main-thread gaps:");
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
    if (args.length === 0) {
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

    const rawMode = isRawImportToken(args[0]);
    if (rawMode && args.length === 1) {
        ChatLib.chat("&cUsage: /htsw import raw <actions.htsl>");
        return;
    }

    const pathArgs = rawMode ? args.slice(1) : args;
    const importPath = resolveModuleRelativePath(
        stripSurroundingQuotes(pathArgs.join(" "))
    );
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
    if (TaskManager.isBusy()) {
        ChatLib.chat(
            "&c[htsw] An import (or another task) is already running — wait for it to finish first."
        );
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

    const items = createProjectItemIndex([], result.gcx);
    const resolveItem = createItemFieldResolver(items);
    runHousingSyncTask("import", async (ctx) => {
        if (ctx.tryGetMenuItemSlot("Add Action") === null) {
            throw new Error("Open a Housing action-list menu first.");
        }

        const count = result.value.length;
        ChatLib.chat(
            `&7[htsw] Appending ${count} action${count === 1 ? "" : "s"} from ${compactFileLabel(path)}`
        );
        await appendActionsToOpenActionList(ctx, result.value, resolveItem);
        ChatLib.chat(
            `&a[htsw] Appended ${count} action${count === 1 ? "" : "s"} from ${compactFileLabel(path)}`
        );
    }).catch((err: unknown) => {
        if (err instanceof Diagnostic) {
            printDiagnostic(sm, err);
            return;
        }
        ChatLib.chat(`&c[htsw] Raw HTSL import failed: ${String(err)}`);
    });
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
