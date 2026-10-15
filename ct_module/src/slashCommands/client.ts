import { commandUpdate } from "../autoUpdate";
import { getMinecraft } from "../utils/java";
import { openPathInOS } from "../utils/osShell";
import {
    clickHtswOverlay,
    getHtswGuiState,
    scrollHtswOverlay,
    setHtswGuiEnabled,
    toggleHtswGui,
} from "../gui/overlay";
import { getTreePerfStats } from "../gui/left-panel/projects/tree";
import {
    getFramePerfStats,
    isFramePerfEnabled,
    setFramePerfEnabled,
} from "../gui/lib/framePerf";
import { debugLog, flushGuiDebug } from "../gui/lib/debugLog";
import { resetOnboarding } from "../gui/persistence/onboarding";
import { rearmTourAutoStart } from "../gui/popovers/tour";
import {
    getImportCodeViewTraceStatus,
    isImportCodeViewTraceEnabled,
    openImportCodeViewReplay,
    startImportCodeViewTrace,
    stopImportCodeViewTrace,
} from "../gui/right-panel/import-tab/codeViewTrace";
import type { HtswSubcommand } from "./index";
import { resolveHtswGuiCommand } from "./gui";
import { recompile } from "./recompile";
import { commandWorkspace } from "./workspace";
import { commandCaches } from "./debugCaches";

// Commands for a player's client: the overlay, saved workspace, self-update
// and GUI diagnostics. The headless entry leaves them out.
export const CLIENT_SUBCOMMANDS: HtswSubcommand[] = [
    {
        name: "gui",
        summary:
            "Show, hide or query the in-game HTSW dashboard (draws over open Housing menus)",
        run: commandGui,
        usage: "gui [on|off|status]",
    },
    {
        name: "workspace",
        summary: "Saved projects, tabs and queue restored on startup",
        run: commandWorkspace,
        usage: "workspace [status|reset|on|off]",
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
        name: "recompile",
        summary: "Rebuild + reload the module",
        run: () => recompile(),
        hidden: true,
    },
    {
        name: "tour",
        summary: "Reset GUI onboarding",
        run: commandTour,
        aliases: ["onboarding"],
        hidden: true,
    },
];

export const CLIENT_DEBUG_SUBCOMMANDS: HtswSubcommand[] = [
    {
        name: "treeperf",
        summary: "Projects tree render stats",
        run: commandTreePerf,
    },
    {
        name: "guiperf",
        summary: "Overlay frame pacing + render cost (scroll while sampling)",
        run: commandGuiPerf,
        usage: "guiperf [on|off|clear]",
    },
    {
        name: "caches",
        summary: "Write GUI and importer cache sizes to gui-debug.log",
        run: commandCaches,
    },
    {
        name: "codeview",
        summary: "Record and replay the live import CodeView",
        run: commandCodeViewTrace,
        usage: "codeview [start|stop|status|open]",
    },
];

function commandCodeViewTrace(args: string[]): void {
    const action = (args[0] ?? "status").toLowerCase();
    try {
        if (action === "start" || action === "on") {
            const path = startImportCodeViewTrace();
            ChatLib.chat(`&a[htsw] import CodeView recording started · &f${path}`);
            ChatLib.chat("&7Run the import, then use /htsw debug codeview stop.");
            return;
        }
        if (action === "stop" || action === "off") {
            const result = stopImportCodeViewTrace();
            openPathInOS(result.replayPath);
            ChatLib.chat("&a[htsw] import CodeView replay written and opened");
            ChatLib.chat(`&7Trace: &f${result.tracePath}`);
            ChatLib.chat(`&7Replay: &f${result.replayPath}`);
            return;
        }
        if (action === "open") {
            const path = openImportCodeViewReplay();
            ChatLib.chat(`&a[htsw] opened import CodeView replay · &f${path}`);
            return;
        }
        if (action === "status") {
            const status = getImportCodeViewTraceStatus();
            ChatLib.chat(
                `&7[htsw] import CodeView recording ` +
                    (isImportCodeViewTraceEnabled() ? "&aon" : "&coff") +
                    ` &7· ${status.frames} frames · ${status.models} models`
            );
            ChatLib.chat(`&7Trace: &f${status.tracePath}`);
            return;
        }
        ChatLib.chat("&cUsage: /htsw debug codeview [start|stop|status|open]");
    } catch (error) {
        ChatLib.chat(
            `&c[htsw] import CodeView replay failed: ` +
                (error instanceof Error ? error.message : String(error))
        );
    }
}

function commandGui(args: string[]): void {
    const request = resolveHtswGuiCommand(getHtswGuiState(), args);
    if (request.action === "toggle") toggleHtswGui();
    if (request.action === "enable") setHtswGuiEnabled(true);
    if (request.action === "disable") setHtswGuiEnabled(false);
    ChatLib.chat(resolveHtswGuiCommand(getHtswGuiState(), args).message);
}

function commandBridge(args: string[]): void {
    const action = (args[0] ?? "").toLowerCase();
    if (action === "click") {
        const point = bridgePoint(args.slice(1));
        if (point === null) return;
        const buttonName = (args[3] ?? "left").toLowerCase();
        const buttons: Partial<Record<string, number>> = { left: 0, right: 1, middle: 2 };
        const button = buttons[buttonName];
        if (button === undefined) {
            bridgeFailed(
                "Usage: /htsw bridge click <x> <y> [left|right|middle] [framebuffer|gui]"
            );
            return;
        }
        if (!clickHtswOverlay(point.x, point.y, button)) {
            bridgeFailed("Click did not hit an HTSW control.");
        }
        return;
    }
    if (action === "scroll") {
        const point = bridgePoint(args.slice(1));
        if (point === null) return;
        const delta = Number(args[3]);
        if (!isFinite(delta) || delta === 0) {
            bridgeFailed("Usage: /htsw bridge scroll <x> <y> <delta> [framebuffer|gui]");
            return;
        }
        if (!scrollHtswOverlay(point.x, point.y, delta / 120)) {
            bridgeFailed("Scroll did not hit an HTSW scroll area.");
        }
        return;
    }
    bridgeFailed("Usage: /htsw bridge <click|scroll> ...");
}

function bridgeFailed(message: string): void {
    ChatLib.chat(`&c[htsw] Bridge failed: ${message}`);
}

function bridgePoint(args: string[]): { x: number; y: number } | null {
    let x = Number(args[0]);
    let y = Number(args[1]);
    if (!isFinite(x) || !isFinite(y)) {
        bridgeFailed("Coordinates must be numbers.");
        return null;
    }
    const space = (args[3] ?? "framebuffer").toLowerCase();
    if (space === "framebuffer") {
        const mc = getMinecraft();
        x = Math.floor((x * Renderer.screen.getWidth()) / mc.field_71443_c);
        y = Math.floor((y * Renderer.screen.getHeight()) / mc.field_71440_d);
    } else if (space !== "gui") {
        bridgeFailed("Coordinate space must be framebuffer or gui.");
        return null;
    }
    if (
        x < 0 ||
        y < 0 ||
        x >= Renderer.screen.getWidth() ||
        y >= Renderer.screen.getHeight()
    ) {
        bridgeFailed("Coordinates are outside the current screen.");
        return null;
    }
    return { x, y };
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
    const action = args[0]?.toLowerCase();
    if (action === "on") {
        setFramePerfEnabled(true);
        ChatLib.chat(
            "&a[guiperf] sampling on. Scroll around, then run /htsw debug guiperf."
        );
        return;
    }
    if (action === "off") {
        setFramePerfEnabled(false);
        ChatLib.chat("&7[guiperf] sampling off and samples cleared.");
        return;
    }
    if (action === "clear") {
        setFramePerfEnabled(true);
        ChatLib.chat(
            "&7[guiperf] samples cleared and sampling on. Scroll around, then run /htsw debug guiperf."
        );
        return;
    }
    if (args.length > 0) {
        ChatLib.chat("&cUsage: /htsw debug guiperf [on|off|clear]");
        return;
    }
    if (!isFramePerfEnabled()) {
        ChatLib.chat("&7[guiperf] sampling is off. Use /htsw debug guiperf on.");
        return;
    }
    const s = getFramePerfStats();
    if (s.frames === 0) {
        ChatLib.chat("&7[guiperf] no painted frames sampled yet — open the GUI first.");
        return;
    }
    const fps = s.avgGapMs > 0 ? Math.round(1000 / s.avgGapMs) : 0;
    const frameLine =
        `last ${s.frames} painted frames: ` +
        `avg gap ${s.avgGapMs.toFixed(1)}ms (~${fps}fps), ` +
        `p95 ${s.p95GapMs}ms, max ${s.maxGapMs}ms.`;
    const renderLine =
        `overlay render: rebuild frames ${s.rebuiltFrames}/${s.frames} ` +
        `avg ${s.avgRebuildMs.toFixed(1)}ms (max ${s.maxRebuildMs}ms), ` +
        `draw-only avg ${s.avgDrawOnlyMs.toFixed(1)}ms.`;
    ChatLib.chat(`&7[guiperf] ${frameLine}`);
    ChatLib.chat(
        `&7[guiperf] ${renderLine} ` +
            `Scrolling rebuilds every frame — smooth needs rebuild avg well under the frame budget.`
    );
    debugLog(`[guiperf] ${frameLine}`);
    debugLog(`[guiperf] ${renderLine}`);
    if (s.phases.length > 0) {
        let parts = "";
        for (let i = 0; i < s.phases.length; i++) {
            if (i > 0) parts += ", ";
            parts +=
                `${s.phases[i].name} ${s.phases[i].msPerRebuild.toFixed(1)}ms avg / ` +
                `${s.phases[i].maxMs.toFixed(1)}ms max`;
        }
        ChatLib.chat(
            `&7[guiperf] timed rebuild slices: ${parts}. ` +
                `layout-total includes child builders such as tree/codeview.`
        );
        debugLog(`[guiperf] timed rebuild slices: ${parts}`);
    }
    // The full report wraps past the height of Minecraft's chat window, so the
    // top lines are unreadable in-game. Mirror it into gui-debug.log, which can
    // be read from outside the game.
    flushGuiDebug();
}

function commandTreePerf(): void {
    const s = getTreePerfStats();
    ChatLib.chat(
        `&7[treeperf] importables tree: ${s.rows} rows, ` +
            `${s.builds} rebuild(s), last ${s.lastBuildMs}ms, max ${s.maxBuildMs}ms. ` +
            `Rebuilds should only follow project, expansion, sort, or filter changes.`
    );
}
