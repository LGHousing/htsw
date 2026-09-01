/// <reference types="../../../../CTAutocomplete" />

/**
 * Queue rows for the import tab: the visible list of items waiting to be
 * imported, with expand/collapse for import.json bundles and per-row mini
 * progress bars driven by the live task session.
 */

import type { Importable } from "htsw/types";

import type { ClickInfo, Element } from "../../lib/layout";
import { Container, Icon, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    ACCENT_DANGER,
    ACCENT_SUCCESS,
    ACCENT_TEAL,
    COLOR_BUTTON_HOVER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../../lib/theme";
import { PHASE_APPLYING, PHASE_HYDRATING, PHASE_READING } from "./phaseColors";

import { getHousingUuid, isCurrentHouseTrusted } from "../../state";
import {
    getQueueItemRunState,
    isCurrentQueueItem,
    type QueueItemRunState,
} from "./taskProgress";
import { importableIdentity } from "../../../importables/identity";
import { buildCacheStatusRow } from "../../../importCache/status";
import { getImportCacheWriteRevision } from "../../../importCache/cache";
import {
    isQueueSessionItem,
    makeImportableQueueRow,
    queueItemKey,
    removeFromQueueKey,
    type QueueItem,
} from "./queue";
import { canonicalPath, getParseCacheRevision, requestParse } from "../../parsing/parses";
import { orderImportablesForSession } from "../../../importables/import/session";
import { isTaskRunning } from "../../../tasks/runningState";
import { currentSnapshotSegments, parkedSnapshotSegments } from "./progressPanel";
import { setActiveLeftTab } from "../../left-panel/tabs";
import { revealInProjectsTree } from "../../left-panel/projects/tree";
import type { IncludeNode } from "../../left-panel/projects/includeTree";

type QueueSourceIndex = {
    importables: Map<string, Importable>;
    declaringFolders: Map<string, string | null>;
    importJsonChildren: QueueItem[] | null;
    parsedImportables: readonly Importable[];
};

let queueSourceIndexRevision = -1;
const queueSourceIndexes = new Map<string, QueueSourceIndex | null>();

function importableIndexKey(type: Importable["type"], identity: string): string {
    return `${type}\u0000${identity}`;
}

function directoryOf(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.substring(0, slash);
}

function relativeDeclaringFolder(rootDir: string, nodePath: string): string | null {
    const homeDir = directoryOf(canonicalPath(nodePath));
    const prefix = rootDir === "" ? "" : `${rootDir}/`;
    if (homeDir === rootDir || homeDir.indexOf(prefix) !== 0) return null;
    return homeDir.substring(prefix.length);
}

function indexDeclaringFolders(
    node: IncludeNode,
    rootDir: string,
    folders: Map<string, string | null>
): void {
    if (node.reference !== true) {
        const folder = relativeDeclaringFolder(rootDir, node.path);
        for (let i = 0; i < node.importables.length; i++) {
            const imp = node.importables[i];
            const key = importableIndexKey(imp.type, importableIdentity(imp));
            if (!folders.has(key)) folders.set(key, folder);
        }
    }
    for (let i = 0; i < node.includes.length; i++) {
        indexDeclaringFolders(node.includes[i], rootDir, folders);
    }
}

function queueSourceIndex(sourcePath: string): QueueSourceIndex | null {
    const revision = getParseCacheRevision();
    if (revision !== queueSourceIndexRevision) {
        queueSourceIndexRevision = revision;
        queueSourceIndexes.clear();
    }
    const sourceKey = canonicalPath(sourcePath);
    if (queueSourceIndexes.has(sourceKey)) {
        return queueSourceIndexes.get(sourceKey) ?? null;
    }
    const parse = requestParse(sourcePath);
    if (parse === null || parse.parsed === null) {
        queueSourceIndexes.set(sourceKey, null);
        return null;
    }
    const importables = new Map<string, Importable>();
    for (let i = 0; i < parse.parsed.value.length; i++) {
        const imp = parse.parsed.value[i];
        const key = importableIndexKey(imp.type, importableIdentity(imp));
        if (!importables.has(key)) importables.set(key, imp);
    }
    const tree: IncludeNode = parse.parsed.importJson.fileTree ?? {
        path: sourcePath,
        importables: parse.parsed.value,
        includes: [],
    };
    const declaringFolders = new Map<string, string | null>();
    indexDeclaringFolders(tree, directoryOf(sourceKey), declaringFolders);
    const index: QueueSourceIndex = {
        importables,
        declaringFolders,
        importJsonChildren: null,
        parsedImportables: parse.parsed.value,
    };
    queueSourceIndexes.set(sourceKey, index);
    return index;
}

function declaringFolder(item: QueueItem): string | null {
    if (item.operation !== "import" || item.kind !== "importable") return null;
    const index = queueSourceIndex(item.sourcePath);
    if (index === null) return null;
    return (
        index.declaringFolders.get(importableIndexKey(item.type, item.identity)) ?? null
    );
}

function declaringFolderElement(item: QueueItem): Element | false {
    const folder = declaringFolder(item);
    return (
        folder !== null &&
        Text({
            text: folder,
            color: COLOR_TEXT_FAINT,
            truncate: true,
            style: { width: { kind: "px", value: 110 } },
        })
    );
}

function revealQueueItem(item: QueueItem, info: ClickInfo): void {
    if (info.button !== 0 || info.isDoubleClickSecond) return;
    setActiveLeftTab("projects");
    if (item.operation === "import" && item.kind === "importable") {
        revealInProjectsTree({
            kind: "importable",
            declaringImportJson: item.sourcePath,
            type: item.type,
            identity: item.identity,
        });
    } else {
        revealInProjectsTree({
            kind: "file",
            importJsonPath:
                item.operation === "import" ? item.sourcePath : item.destinationPath,
        });
    }
}

type SkipPredictionContext = {
    housingUuid: string | null;
    trusted: boolean;
};

let skipPredictionParseRevision = -1;
let skipPredictionCacheRevision = -1;
let skipPredictionHousingUuid: string | null = null;
let skipPredictionTrusted = false;
const skipPredictions = new Map<string, boolean>();

export function queueRowCacheSizes(): {
    sourceIndexes: number;
    skipPredictions: number;
} {
    return {
        sourceIndexes: queueSourceIndexes.size,
        skipPredictions: skipPredictions.size,
    };
}

function currentSkipPredictionContext(): SkipPredictionContext {
    const parseRevision = getParseCacheRevision();
    const cacheRevision = getImportCacheWriteRevision();
    const housingUuid = getHousingUuid();
    const trusted = isCurrentHouseTrusted();
    if (
        parseRevision !== skipPredictionParseRevision ||
        cacheRevision !== skipPredictionCacheRevision ||
        housingUuid !== skipPredictionHousingUuid ||
        trusted !== skipPredictionTrusted
    ) {
        skipPredictionParseRevision = parseRevision;
        skipPredictionCacheRevision = cacheRevision;
        skipPredictionHousingUuid = housingUuid;
        skipPredictionTrusted = trusted;
        skipPredictions.clear();
    }
    return { housingUuid, trusted };
}

function willBeSkipped(
    item: QueueItem,
    context: SkipPredictionContext = currentSkipPredictionContext()
): boolean {
    if (isTaskRunning() || !context.trusted) return false;
    if (item.operation !== "import" || item.kind !== "importable") return false;
    if (context.housingUuid === null) return false;
    const key = queueItemKey(item);
    const cached = skipPredictions.get(key);
    if (cached !== undefined) return cached;
    const index = queueSourceIndex(item.sourcePath);
    const imp = index?.importables.get(importableIndexKey(item.type, item.identity));
    const skipped =
        imp !== undefined &&
        buildCacheStatusRow(context.housingUuid, imp).state === "current";
    skipPredictions.set(key, skipped);
    return skipped;
}

const collapsedQueueImportJsonRows: Set<string> = new Set();

function queueRowMiniBar(state: QueueItemRunState): Element {
    if (state.kind === "queued") {
        return Container({
            style: { width: { kind: "grow" }, height: { kind: "px", value: 2 } },
            children: [],
        });
    }
    if (state.kind === "done") {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: ACCENT_SUCCESS,
            },
            children: [],
        });
    }
    if (state.kind === "skipped") {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: ACCENT_TEAL,
            },
            children: [],
        });
    }
    if (state.kind === "failed") {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: ACCENT_DANGER,
            },
            children: [],
        });
    }
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: 2 },
        },
        children:
            state.kind === "parked"
                ? parkedSnapshotSegments(state, "slices")
                : currentSnapshotSegments(state, "slices"),
    });
}

function phaseColor(phase: "reading" | "hydrating" | "applying"): number {
    if (phase === "applying") return PHASE_APPLYING;
    if (phase === "hydrating") return PHASE_HYDRATING;
    return PHASE_READING;
}

function activeQueueItemColor(state: QueueItemRunState): number | undefined {
    return state.kind === "current" ? phaseColor(state.phase) : undefined;
}

function queueStateRail(color: number | undefined): Element {
    return Container({
        style: {
            width: { kind: "px", value: 2 },
            height: { kind: "grow" },
            background: color,
        },
        children: [],
    });
}

function queueImportableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

export function queueImportJsonChildren(item: QueueItem): QueueItem[] {
    if (item.operation !== "import" || item.kind !== "importJson") return [];
    const index = queueSourceIndex(item.sourcePath);
    if (index === null) return [];
    if (index.importJsonChildren !== null) return index.importJsonChildren;
    const ordered = orderImportablesForSession(
        index.parsedImportables,
        index.parsedImportables
    );
    index.importJsonChildren = ordered.map((imp) =>
        makeImportableQueueRow({
            op: "import",
            house: item.house,
            path: item.path,
            identity: importableIdentity(imp),
            type: imp.type,
            label: queueImportableLabel(imp),
            origin: "expansion",
            parentKey: item.key,
        })
    );
    return index.importJsonChildren;
}

export function isQueueImportJsonExpanded(item: QueueItem): boolean {
    return (
        item.operation === "import" &&
        item.kind === "importJson" &&
        !collapsedQueueImportJsonRows.has(queueItemKey(item))
    );
}

// Teal skip badge for a queue row: predictive ("will skip") until the run
// resolves the row, then only an actually-skipped outcome keeps the badge —
// a prediction has no business outliving the event it predicts.
function skipBadge(
    item: QueueItem,
    runState: QueueItemRunState
): { teal: boolean; tooltip: string | undefined } {
    if (runState.kind === "skipped") return { teal: true, tooltip: "Trusted - skipped" };
    const finished = runState.kind === "done" || runState.kind === "failed";
    if (!isTaskRunning() && !finished && willBeSkipped(item))
        return { teal: true, tooltip: "Trusted - will skip" };
    return { teal: false, tooltip: undefined };
}

export function queueRow(item: QueueItem): Element {
    const typeText = item.kind === "importJson" ? "ALL" : item.type;
    const isCurrent = isCurrentQueueItem(item);
    const runState = getQueueItemRunState(item);
    const { teal: skip, tooltip: skipTooltip } = skipBadge(item, runState);
    const canExpand = item.operation === "import" && item.kind === "importJson";
    const expanded = canExpand && isQueueImportJsonExpanded(item);
    const stateColor = activeQueueItemColor(runState);
    return Container({
        style: {
            direction: "col",
            height: { kind: "px", value: SIZE_ROW_H },
            background: isCurrent ? COLOR_ROW_HOVER : COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        onClick: (_rect, info) => revealQueueItem(item, info),
        children: [
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: [
                        { side: "left", value: 0 },
                        { side: "right", value: 6 },
                    ],
                    gap: 6,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [
                    queueStateRail(stateColor),
                    canExpand &&
                        Container({
                            style: {
                                direction: "col",
                                align: "center",
                                justify: "center",
                                width: { kind: "px", value: 14 },
                                height: { kind: "grow" },
                                hoverBackground: COLOR_BUTTON_HOVER,
                            },
                            onClick: (_rect, info) => {
                                if (info.button !== 0) return;
                                const key = queueItemKey(item);
                                if (expanded) collapsedQueueImportJsonRows.add(key);
                                else collapsedQueueImportJsonRows.delete(key);
                            },
                            children: [
                                Icon({
                                    name: expanded
                                        ? Icons.chevronDown
                                        : Icons.chevronRight,
                                }),
                            ],
                        }),
                    Text({
                        text: typeText,
                        color: skip ? ACCENT_TEAL : COLOR_TEXT_DIM,
                        tooltip: skipTooltip,
                        tooltipColor: ACCENT_TEAL,
                        style: { width: { kind: "px", value: 48 } },
                    }),
                    Text({
                        text: item.label,
                        color: skip ? ACCENT_TEAL : undefined,
                        tooltip: skipTooltip,
                        tooltipColor: ACCENT_TEAL,
                        truncate: true,
                        style: { width: { kind: "grow" } },
                    }),
                    declaringFolderElement(item),
                    // No removal while an import is running — the queue is
                    // locked for the duration of the run.
                    isTaskRunning() || isQueueSessionItem(queueItemKey(item))
                        ? Container({
                              style: {
                                  width: { kind: "px", value: 14 },
                                  height: { kind: "grow" },
                              },
                              children: [],
                          })
                        : Container({
                              style: {
                                  direction: "col",
                                  width: { kind: "px", value: 14 },
                                  height: { kind: "grow" },
                                  align: "center",
                                  justify: "center",
                                  hoverBackground: 0x40e85c5c | 0,
                              },
                              onClick: (_rect, info) => {
                                  if (info.button !== 0) return;
                                  removeFromQueueKey(queueItemKey(item));
                              },
                              children: [Icon({ name: Icons.x })],
                          }),
                ],
            }),
            queueRowMiniBar(runState),
        ],
    });
}

export function queueImportJsonChildRow(item: QueueItem): Element {
    const isCurrent = isCurrentQueueItem(item);
    const runState = getQueueItemRunState(item);
    const { teal: skip, tooltip: skipTooltip } = skipBadge(item, runState);
    const stateColor = activeQueueItemColor(runState);
    return Container({
        style: {
            direction: "col",
            height: { kind: "px", value: SIZE_ROW_H },
            background: isCurrent ? COLOR_ROW_HOVER : COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        onClick: (_rect, info) => revealQueueItem(item, info),
        children: [
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: [
                        { side: "left", value: 0 },
                        { side: "right", value: 6 },
                    ],
                    gap: 6,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [
                    queueStateRail(stateColor),
                    Text({
                        text: item.kind === "importable" ? item.type : "ALL",
                        color: skip ? ACCENT_TEAL : COLOR_TEXT_DIM,
                        tooltip: skipTooltip,
                        tooltipColor: ACCENT_TEAL,
                        style: { width: { kind: "px", value: 48 } },
                    }),
                    Text({
                        text: item.label,
                        color: skip ? ACCENT_TEAL : undefined,
                        tooltip: skipTooltip,
                        tooltipColor: ACCENT_TEAL,
                        truncate: true,
                        style: { width: { kind: "grow" } },
                    }),
                    declaringFolderElement(item),
                    Container({
                        style: {
                            width: { kind: "px", value: 14 },
                            height: { kind: "grow" },
                        },
                        children: [],
                    }),
                ],
            }),
            queueRowMiniBar(runState),
        ],
    });
}
