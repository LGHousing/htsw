/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Col, Container, Row, Text } from "../lib/components";
import {
    applyImportProgress,
    beginImportRun,
    clearImportRun,
    getHousingUuid,
    getImportJsonPath,
    getParsedResult,
    getSelectedImportableIds,
    getTrustMode,
    setCurrentImportingPath,
    setHousingUuid,
    setImportProgress,
    setKnowledgeRows,
    setTrustMode,
    updateImportRunFromProgress,
} from "../state";
import { buildKnowledgeStatusRows } from "../../knowledge/status";
import {
    importSelectedImportables,
    orderImportablesForImportSession,
    type ImportSelection,
} from "../../importables/importSession";
import { exportImportable } from "../../importables/exports";
import {
    captureFromHousing,
    type CaptureType,
} from "../../exporter/captureFromHousing";
import { getCurrentHousingUuid } from "../../knowledge/housingId";
import { importableIdentity } from "../../knowledge/paths";
import { trustPlanKey } from "../../knowledge/trust";
import { TaskManager } from "../../tasks/manager";
import type TaskContext from "../../tasks/context";
import type { Importable } from "htsw/types";
import { closeAllPopovers, togglePopover } from "../lib/popovers";
import { COLOR_ROW, COLOR_ROW_HOVER, COLOR_TEXT, SIZE_ROW_H } from "../lib/theme";
import {
    clearDiff,
    addDeleteOp,
    diffKey,
    markCompleted,
    setCurrent,
    setDiffState,
    setDiffPhase,
    setDiffSummary,
    setPlannedOp,
} from "../state/diff";
import { importableSourcePath } from "../state/importablePaths";
import type { ImportDiffSink } from "../../importer/diffSink";

import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_PANEL,
    GLYPH_CHEVRON_DOWN,
} from "../lib/theme";
import {
    getLastOpenTarget,
    openOpenTargetMenu,
    runOpenTarget,
} from "../popovers/open-menu";

const TRUST_ON_BG = 0xff2d4d2d | 0;
const TRUST_ON_HOVER = 0xff3a5d3a | 0;
const TRUST_OFF_BG = 0xff2d333d | 0;
const TRUST_OFF_HOVER = 0xff3a4350 | 0;

async function ensureHousingUuid(ctx: TaskContext): Promise<string> {
    const cached = getHousingUuid();
    if (cached !== null) return cached;
    const fresh = await getCurrentHousingUuid(ctx);
    setHousingUuid(fresh);
    return fresh;
}

/**
 * Resolve which importables to act on. Checked rows define scope; otherwise
 * Import means all parsed importables. Highlighted rows are preview-only.
 */
function selectionToImport(): Importable[] {
    const parsed = getParsedResult();
    if (parsed === null) return [];
    const checked = getSelectedImportableIds();
    if (checked.size > 0) {
        return parsed.value.filter((i) => checked.has(importableIdentity(i)));
    }
    return parsed.value;
}

function findImportableByKey(
    parsed: NonNullable<ReturnType<typeof getParsedResult>>,
    key: string
): Importable | null {
    for (let i = 0; i < parsed.value.length; i++) {
        const imp = parsed.value[i];
        if (trustPlanKey(imp.type, importableIdentity(imp)) === key) return imp;
    }
    return null;
}

function refreshKnowledgeRows(): void {
    const uuid = getHousingUuid();
    const parsed = getParsedResult();
    if (uuid === null || parsed === null) return;
    setKnowledgeRows(buildKnowledgeStatusRows(uuid, parsed.value));
}

function makeDiffSink(sourcePath: string): ImportDiffSink {
    const key = diffKey(sourcePath);
    clearDiff(key);
    return {
        phase: (label) => {
            setDiffPhase(key, label);
        },
        summary: (summary) => {
            setDiffSummary(key, summary);
        },
        planOp: (path, kind, label, detail) => {
            setPlannedOp(key, path, kind, label, detail);
        },
        deleteOp: (idx, label, detail) => {
            addDeleteOp(key, idx, label, detail);
        },
        markMatch: (path) => {
            setDiffState(key, path, "match");
        },
        beginOp: (path, kind, label) => {
            setDiffPhase(key, label);
            setCurrent(key, path, label);
            setPlannedOp(key, path, kind, label, "");
        },
        completeOp: (path, state) => {
            setDiffState(key, path, state);
            markCompleted(key, path);
            setCurrent(key, null, "");
        },
        end: () => {
            setCurrent(key, null, "");
            // The just-finished importable's knowledge.json was written
            // moments ago — refresh the GUI's knowledge cache so its dot
            // flips from red (unknown) to green (current) right away.
            refreshKnowledgeRows();
        },
    };
}

function startImport(trustMode: boolean): void {
    const parsed = getParsedResult();
    if (parsed === null) {
        ChatLib.chat("&c[htsw] Load an import.json first");
        return;
    }
    const importables = selectionToImport();
    if (importables.length === 0) {
        ChatLib.chat("&c[htsw] Nothing to import");
        return;
    }
    const orderedImportables = orderImportablesForImportSession(parsed.value, importables);
    beginImportRun(orderedImportables);
    setImportProgress({
        weightCompleted: 0,
        weightTotal: 1,
        weightCurrent: 0,
        currentKey: "",
        currentType: null,
        currentIdentity: "starting",
        orderIndex: -1,
        rowStatus: null,
        currentLabel: "starting…",
        phase: "starting",
        phaseLabel: "starting import",
        unitCompleted: 0,
        unitTotal: 0,
        estimatedCompleted: 0,
        estimatedTotal: 1,
        etaConfidence: "rough",
        completed: 0,
        total: importables.length,
        failed: 0,
        inFlight: true,
    });
    TaskManager.run(async (ctx) => {
        const startedAt = Date.now();
        try {
            ctx.displayMessage(
                `&7[import] starting ${importables.length} importable${importables.length === 1 ? "" : "s"} · trust ${trustMode ? "on" : "off"}`
            );
            const housingUuid = await ensureHousingUuid(ctx);
            const selection: ImportSelection = {
                importables,
                trustMode,
                housingUuid,
                sourcePath: getImportJsonPath(),
                onProgress: (p) => {
                    applyImportProgress(p);
                    updateImportRunFromProgress(p);
                    if (p.currentKey.length === 0) {
                        setCurrentImportingPath(null);
                        return;
                    }
                    const imp = findImportableByKey(parsed, p.currentKey);
                    const path = imp === null ? null : (importableSourcePath(imp) ?? null);
                    setCurrentImportingPath(path);
                },
                diffSinkForImportable: (_imp, path) =>
                    path === null ? null : makeDiffSink(path),
            };
            const result = await importSelectedImportables(ctx, selection);
            const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            ctx.displayMessage(
                `&7[import] done · imported ${result.imported}, skipped ${result.skippedTrusted}, failed ${result.failed}, ${elapsed}s`
            );
        } finally {
            // Runs on success, failure, AND cancellation. TaskManager swallows
            // the __taskCancelled error so a .catch() outside wouldn't fire —
            // without this finally, the progress UI (and the cancel button)
            // would stay stuck on screen after the user clicks cancel.
            setImportProgress(null);
            setCurrentImportingPath(null);
            clearImportRun();
            refreshKnowledgeRows();
        }
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Import failed: ${err}`);
    });
}

/**
 * Types the click-to-pick capture flow knows how to handle. Mirror of
 * `CaptureType` in `exporter/captureFromHousing` — kept here as a
 * literal array so the picker menu can iterate it.
 */
const CAPTURE_TYPES: CaptureType[] = ["FUNCTION", "MENU"];

function importJsonDir(path: string): string {
    const norm = path.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

/**
 * Start the click-to-pick export flow for `type`. Closes any open
 * popovers first so the picker menu doesn't linger over the chest UI
 * once it opens, then runs the appropriate Hypixel command and arms
 * the capture listeners. On a successful capture, dispatches to the
 * existing exporter for that type.
 */
function startCaptureExport(type: CaptureType): void {
    closeAllPopovers();

    TaskManager.run(async (ctx) => {
        const result = await captureFromHousing(ctx, type);
        if (result.kind === "cancelled") {
            ctx.displayMessage("&7[htsw] Export cancelled");
            return;
        }
        const importJsonPath = getImportJsonPath();
        if (importJsonPath.trim() === "") {
            ctx.displayMessage("&c[htsw] No import.json loaded — load one first");
            return;
        }
        const dir = importJsonDir(importJsonPath);
        if (result.type === "FUNCTION") {
            await exportImportable(ctx, {
                type: "FUNCTION",
                name: result.name,
                importJsonPath,
                htslPath: `${dir}/${result.name}.htsl`,
                htslReference: `${result.name}.htsl`,
            });
        } else {
            await exportImportable(ctx, {
                type: "MENU",
                name: result.name,
                importJsonPath,
                rootDir: dir,
            });
        }
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Export failed: ${err}`);
    });
}

function captureMenuPopoverContent(): Element {
    return Col({
        style: { gap: 2, padding: 4 },
        children: CAPTURE_TYPES.map((t) =>
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 8 },
                    gap: 6,
                    height: { kind: "px", value: SIZE_ROW_H },
                    background: COLOR_ROW,
                    hoverBackground: COLOR_ROW_HOVER,
                },
                onClick: () => startCaptureExport(t),
                children: [
                    Text({
                        text: `Capture ${t}`,
                        color: COLOR_TEXT,
                        style: { width: { kind: "grow" } },
                    }),
                ],
            })
        ),
    });
}

function navRow(): Element {
    return Row({
        style: {
            gap: 4,
            width: { kind: "grow" },
            height: { kind: "px", value: 18 },
        },
        children: [
            Button({
                text: "Housing Menu",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    try {
                        ChatLib.command("hmenu");
                    } catch (err) {
                        ChatLib.chat(`&c[htsw] /hmenu failed: ${err}`);
                    }
                },
            }),
            // Split-button: left = run last-selected, right = open dropdown.
            Button({
                text: () => getLastOpenTarget().label,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => runOpenTarget(getLastOpenTarget()),
            }),
            Button({
                text: GLYPH_CHEVRON_DOWN,
                style: {
                    width: { kind: "px", value: 14 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect) => openOpenTargetMenu(rect),
            }),
        ],
    });
}

function trustModeToggle(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 6 },
            gap: 6,
            width: { kind: "grow" },
            height: { kind: "px", value: 18 },
            background: () => (getTrustMode() ? TRUST_ON_BG : TRUST_OFF_BG),
            hoverBackground: () => (getTrustMode() ? TRUST_ON_HOVER : TRUST_OFF_HOVER),
        },
        onClick: () => setTrustMode(!getTrustMode()),
        children: [
            Text({
                text: "Trust mode",
                style: { width: { kind: "grow" } },
            }),
            Text({ text: () => (getTrustMode() ? "[x]" : "[ ]") }),
        ],
    });
}

function actionRow(): Element {
    return Row({
        style: {
            gap: 4,
            width: { kind: "grow" },
            height: { kind: "px", value: 18 },
        },
        children: [
            // Capture-from-Housing — always opens the type picker; user
            // picks FUNCTION/MENU/etc. on every capture.
            Button({
                text: `Capture ${GLYPH_CHEVRON_DOWN}`,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect) =>
                    togglePopover({
                        key: "capture-type-menu",
                        anchor: rect,
                        content: captureMenuPopoverContent(),
                        width: 140,
                        height: CAPTURE_TYPES.length * 20 + 8,
                    }),
            }),
            Button({
                text: "Import",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: () => startImport(getTrustMode()),
            }),
        ],
    });
}

export function BottomToolbar(): Element {
    // Progress bar + currently-importing label live in the LiveImporter
    // panel above the inventory now — see `gui/live-importer/index.ts`.
    return Col({
        style: {
            background: COLOR_PANEL,
            padding: 4,
            gap: 3,
            width: { kind: "grow" },
            height: { kind: "grow" },
        },
        children: [
            navRow(),
            // Filler — push the trust toggle + actions to the bottom.
            Container({
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
                children: [],
            }),
            trustModeToggle(),
            actionRow(),
        ],
    });
}
