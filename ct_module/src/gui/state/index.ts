/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import type { KnowledgeStatusRow } from "../../knowledge/status";
import type { ImportProgress } from "../../importables/importSession";
import { normalizeHtswPath } from "../lib/pathDisplay";

export type ImportProgressView = {
    weightCompleted: number;
    weightTotal: number;
    weightCurrent: number;
    currentLabel: string;
    completed: number;
    total: number;
    failed: number;
    inFlight: boolean;
};

export type SourceTab = {
    /** Filesystem path of the source file. Identity for the tab. */
    path: string;
    /** Display label (basename + maybe importable name). */
    label: string;
};

let importJsonPath = "./htsw/imports/import.json";
let parsedResult: ParseResult<Importable[]> | null = null;
let parseError: string | null = null;
let selectedImportableId: string | null = null;
/**
 * Resolved filesystem path of the importable currently being processed by
 * the in-flight import session. Drives the LiveImporter panel above the
 * inventory: when set, that file's HTSL is rendered with diff colors;
 * when null, the panel shows an idle state. Cleared by the import's
 * progress callback when the session reports `currentLabel === "done"`.
 */
let currentImportingPath: string | null = null;
/**
 * Set of importable identities (`type:identity` strings) currently checked
 * in the Importables list. Drives multi-import: when non-empty, the bottom
 * toolbar's Import targets exactly these. Empty set = "no checkboxes
 * ticked, fall back to all".
 */
let selectedImportableIds: Set<string> = new Set();
let openTabs: SourceTab[] = [];
let activeTabPath: string | null = null;
let trustMode = false;
let housingUuid: string | null = null;
let knowledgeRows: KnowledgeStatusRow[] = [];
let importProgress: ImportProgressView | null = null;
/**
 * `Date.now()` of the moment the in-flight import started. Captured the
 * first time `setImportProgress` transitions from null → non-null and
 * cleared on the inverse transition. The LiveImporter panel divides
 * elapsed time by `weightCompleted / weightTotal` to project an ETA.
 */
let importStartedAt: number | null = null;

export function getImportJsonPath(): string {
    return importJsonPath;
}
export function setImportJsonPath(path: string): void {
    importJsonPath = normalizeHtswPath(path);
}

export function getParsedResult(): ParseResult<Importable[]> | null {
    return parsedResult;
}
export function setParsedResult(r: ParseResult<Importable[]> | null): void {
    parsedResult = r;
}

export function getParseError(): string | null {
    return parseError;
}
export function setParseError(msg: string | null): void {
    parseError = msg;
}

export function getSelectedImportableId(): string | null {
    return selectedImportableId;
}
export function setSelectedImportableId(id: string | null): void {
    selectedImportableId = id;
}

export function getSelectedImportableIds(): Set<string> {
    return selectedImportableIds;
}
export function isImportableChecked(id: string): boolean {
    return selectedImportableIds.has(id);
}
export function toggleImportableChecked(id: string): void {
    if (selectedImportableIds.has(id)) selectedImportableIds.delete(id);
    else selectedImportableIds.add(id);
}
export function clearImportableSelection(): void {
    selectedImportableIds = new Set();
}

export function getOpenTabs(): SourceTab[] {
    return openTabs;
}
export function getActiveTabPath(): string | null {
    return activeTabPath;
}
export function openTab(tab: SourceTab): void {
    for (let i = 0; i < openTabs.length; i++) {
        if (openTabs[i].path === tab.path) {
            activeTabPath = tab.path;
            return;
        }
    }
    openTabs = openTabs.concat([tab]);
    activeTabPath = tab.path;
}
export function closeTab(path: string): void {
    const next: SourceTab[] = [];
    for (let i = 0; i < openTabs.length; i++) {
        if (openTabs[i].path !== path) next.push(openTabs[i]);
    }
    openTabs = next;
    if (activeTabPath === path) {
        activeTabPath = next.length > 0 ? next[next.length - 1].path : null;
    }
}
export function setActiveStateTab(path: string): void {
    activeTabPath = path;
}

export function getTrustMode(): boolean {
    return trustMode;
}
export function setTrustMode(v: boolean): void {
    trustMode = v;
}

export function getHousingUuid(): string | null {
    return housingUuid;
}
export function setHousingUuid(uuid: string | null): void {
    housingUuid = uuid;
}

export function getKnowledgeRows(): KnowledgeStatusRow[] {
    return knowledgeRows;
}
export function setKnowledgeRows(rows: KnowledgeStatusRow[]): void {
    knowledgeRows = rows;
}

export function getImportProgress(): ImportProgressView | null {
    return importProgress;
}
export function setImportProgress(p: ImportProgressView | null): void {
    if (p !== null && importProgress === null) {
        importStartedAt = Date.now();
    } else if (p === null) {
        importStartedAt = null;
    }
    importProgress = p;
}
export function getImportStartedAt(): number | null {
    return importStartedAt;
}

export function getCurrentImportingPath(): string | null {
    return currentImportingPath;
}
export function setCurrentImportingPath(p: string | null): void {
    if (p !== null && p !== currentImportingPath) {
        ChatLib.chat(`&7[live-imp] currentImportingPath = &f${p}`);
    }
    currentImportingPath = p;
}
export function applyImportProgress(p: ImportProgress): void {
    importProgress = {
        weightCompleted: p.weightCompleted,
        weightTotal: p.weightTotal,
        weightCurrent: p.weightCurrent,
        currentLabel: p.currentLabel,
        completed: p.completed,
        total: p.total,
        failed: p.failed,
        inFlight: p.completed < p.total,
    };
}
