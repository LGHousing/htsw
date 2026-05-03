/// <reference types="../../../CTAutocomplete" />

import { Child, Element } from "../layout";
import { Button, Col, Container, Row, Text } from "../components";
import {
    applyImportProgress,
    getHousingUuid,
    getImportJsonPath,
    getImportProgress,
    getParsedResult,
    getSelectedImportableId,
    getSelectedImportableIds,
    getTrustMode,
    setHousingUuid,
    setImportProgress,
} from "../state";
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
    ACCENT_SUCCESS,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_PANEL,
    GLYPH_CHEVRON_DOWN,
} from "../theme";
import {
    getLastOpenTarget,
    openOpenTargetMenu,
    runOpenTarget,
} from "../open-menu";

const COLOR_BAR_BG = 0xff1a1f25 | 0;
const COLOR_BAR_FG = ACCENT_SUCCESS;

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
            onProgress: (p) => applyImportProgress(p),
        };
        await importSelectedImportables(ctx, selection);
        setImportProgress(null);
    }).catch((err: unknown) => {
        setImportProgress(null);
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

function progressBar(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: 6 },
            background: COLOR_BAR_BG,
        },
        children: () => {
            const p = getImportProgress();
            if (p === null || p.weightTotal <= 0) return [];
            const ratio = Math.min(1, Math.max(0, p.weightCompleted / p.weightTotal));
            const out: Child[] = [
                Container({
                    style: {
                        width: { kind: "grow", factor: Math.max(0.0001, ratio) },
                        height: { kind: "grow" },
                        background: COLOR_BAR_FG,
                    },
                    children: [],
                }),
                Container({
                    style: {
                        width: { kind: "grow", factor: Math.max(0.0001, 1 - ratio) },
                        height: { kind: "grow" },
                    },
                    children: [],
                }),
            ];
            return out;
        },
    });
}

function progressLabel(): Element {
    return Text({
        text: () => {
            const p = getImportProgress();
            if (p === null) return "";
            return `${p.completed}/${p.total} ${p.currentLabel}`;
        },
        style: { width: { kind: "grow" } },
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
                text: () => `Open ${getLastOpenTarget().label}`,
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
    return Col({
        style: {
            background: COLOR_PANEL,
            padding: 4,
            gap: 3,
            width: { kind: "grow" },
            height: { kind: "grow" },
        },
        children: [
            progressBar(),
            progressLabel(),
            navRow(),
            // Push the action buttons to the bottom of the toolbar area.
            Container({
                style: { width: { kind: "grow" }, height: { kind: "grow" } },
                children: [],
            }),
            actionRow(),
        ],
    });
}
