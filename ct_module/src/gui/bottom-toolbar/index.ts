/// <reference types="../../../CTAutocomplete" />

import { Element } from "../lib/layout";
import { Button, Col, Container, Row, Text } from "../lib/components";
import {
    applyImportProgress,
    getHousingUuid,
    getImportJsonPath,
    getParsedResult,
    getSelectedImportableId,
    getSelectedImportableIds,
    getTrustMode,
    setCurrentImportingPath,
    setHousingUuid,
    setImportProgress,
    setKnowledgeRows,
    setTrustMode,
} from "../state";
import { buildKnowledgeStatusRows } from "../../knowledge/status";
import {
    importSelectedImportables,
    type ImportSelection,
} from "../../importables/importSession";
import { exportImportable } from "../../importables/exports";
import { getCurrentHousingUuid } from "../../knowledge/housingId";
import { importableIdentity } from "../../knowledge/paths";
import { TaskManager } from "../../tasks/manager";
import type TaskContext from "../../tasks/context";
import type { Importable } from "htsw/types";
import {
    clearDiff,
    diffKey,
    setCurrent,
    setDiffState,
} from "../state/diff";
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
 * Resolve which importables to act on. Priority:
 *   1. Multi-select checkboxes (set non-empty)         → all checked
 *   2. Single-row highlight (selectedImportableId)     → just that one
 *   3. Otherwise                                       → all in import.json
 */
function selectionToImport(): Importable[] {
    const parsed = getParsedResult();
    if (parsed === null) return [];
    const checked = getSelectedImportableIds();
    if (checked.size > 0) {
        return parsed.value.filter((i) => checked.has(importableIdentity(i)));
    }
    const selectedId = getSelectedImportableId();
    if (selectedId === null) return parsed.value;
    for (let i = 0; i < parsed.value.length; i++) {
        if (importableIdentity(parsed.value[i]) === selectedId) {
            return [parsed.value[i]];
        }
    }
    return parsed.value;
}

function findImportableByLabel(
    parsed: NonNullable<ReturnType<typeof getParsedResult>>,
    label: string
): Importable | null {
    const space = label.indexOf(" ");
    if (space < 0) return null;
    const type = label.substring(0, space);
    const identity = label.substring(space + 1);
    for (let i = 0; i < parsed.value.length; i++) {
        const imp = parsed.value[i];
        if (imp.type === type && importableIdentity(imp) === identity) return imp;
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
    let markCount = 0;
    let opCount = 0;
    ChatLib.chat(`&7[diff-sink] keyed at &f${key}`);
    return {
        markMatch: (idx) => {
            setDiffState(key, idx, "match");
            markCount++;
            if (markCount <= 3) {
                ChatLib.chat(`&7[diff-sink] markMatch idx=${idx} (${markCount})`);
            }
        },
        beginOp: (idx, kind, label) => {
            setCurrent(key, idx, label);
            opCount++;
            if (opCount <= 3) {
                ChatLib.chat(`&7[diff-sink] beginOp ${kind} idx=${idx} (${opCount})`);
            }
        },
        completeOp: (idx, state) => {
            setDiffState(key, idx, state);
            setCurrent(key, null, "");
        },
        end: () => {
            setCurrent(key, null, "");
            ChatLib.chat(`&7[diff-sink] end · matches=${markCount} ops=${opCount}`);
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
    setImportProgress({
        weightCompleted: 0,
        weightTotal: 1,
        weightCurrent: 0,
        currentLabel: "starting…",
        completed: 0,
        total: importables.length,
        failed: 0,
        inFlight: true,
    });
    TaskManager.run(async (ctx) => {
        const housingUuid = await ensureHousingUuid(ctx);
        const selection: ImportSelection = {
            importables,
            trustMode,
            housingUuid,
            sourcePath: getImportJsonPath(),
            onProgress: (p) => {
                applyImportProgress(p);
                if (p.currentLabel === "done") {
                    setCurrentImportingPath(null);
                    return;
                }
                const imp = findImportableByLabel(parsed, p.currentLabel);
                const path =
                    imp === null ? null : (parsed.gcx.sourceFiles.get(imp) ?? null);
                setCurrentImportingPath(path);
            },
            diffSinkForImportable: (_imp, path) =>
                path === null ? null : makeDiffSink(path),
        };
        await importSelectedImportables(ctx, selection);
        setImportProgress(null);
        setCurrentImportingPath(null);
        refreshKnowledgeRows();
    }).catch((err: unknown) => {
        setImportProgress(null);
        setCurrentImportingPath(null);
        ChatLib.chat(`&c[htsw] Import failed: ${err}`);
    });
}

function startExport(): void {
    const parsed = getParsedResult();
    if (parsed === null) {
        ChatLib.chat("&c[htsw] Load an import.json first");
        return;
    }
    const id = getSelectedImportableId();
    let target: Importable | null = null;
    if (id !== null) {
        for (let i = 0; i < parsed.value.length; i++) {
            if (importableIdentity(parsed.value[i]) === id) {
                target = parsed.value[i];
                break;
            }
        }
    }
    if (target === null) {
        ChatLib.chat("&c[htsw] Select a FUNCTION or MENU on the left first");
        return;
    }
    if (target.type !== "FUNCTION" && target.type !== "MENU") {
        ChatLib.chat(`&c[htsw] Export not supported for ${target.type}`);
        return;
    }
    const exportTarget = target;
    const importJsonPath = getImportJsonPath();
    TaskManager.run(async (ctx) => {
        if (exportTarget.type === "FUNCTION") {
            await exportImportable(ctx, {
                type: "FUNCTION",
                name: exportTarget.name,
                importJsonPath,
                htslPath: `${exportTarget.name}.htsl`,
                htslReference: `${exportTarget.name}.htsl`,
            });
        } else {
            await exportImportable(ctx, {
                type: "MENU",
                name: exportTarget.name,
                importJsonPath,
                rootDir: ".",
            });
        }
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Export failed: ${err}`);
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
            Button({
                text: "Export",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => startExport(),
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
            Button({
                text: "Diff",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => startImport(true),
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
