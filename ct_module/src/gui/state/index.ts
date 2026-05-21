/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import type { CacheStatusRow } from "../../importCache/status";
import type { ImportProgress, ImportProgressRow } from "../../importer/progress/types";
import { importProgressKey } from "../../importer/progress/keys";
import { normalizeHtswPath } from "../lib/pathDisplay";
import {
    getCurrentPhaseEtaSecondsCached as etaGetCurrentPhaseEtaSeconds,
    getImportEtaSeconds as etaGetImportEtaSeconds,
    resetEtaCache,
} from "../../importer/progress/eta";
import { importableIdentity } from "../../importCache/paths";
import type { QueueItem } from "./queue";
import { canonicalPath } from "./parses";
import { getActiveRightTab, setActiveRightTab } from "./selection";

let importJsonPath = "./htsw/imports/import.json";
let exportImportJsonPath: string | null = null;
let parsedResult: ParseResult<Importable[]> | null = null;
/**
 * Multi-select for the Importables tab. Keyed by `${type}:${identity}`
 * (the `trustPlanKey` shape). Independent of `selectedImportableId` —
 * single-selection drives preview, multi-selection drives "Import
 * selected" and the queue-bulk paths.
 */
const checkedImportableKeys: Set<string> = new Set();
/**
 * Resolved filesystem path of the importable currently being processed by
 * the in-flight import session. Drives the LiveImporter panel above the
 * inventory: when set, that file's HTSL is rendered with diff colors;
 * when null, the panel shows an idle state. Cleared by the import's
 * progress callback when the session reports no current importable.
 */
let currentImportingPath: string | null = null;
/** Housing UUIDs the user has explicitly opted in to "trust the cache for". */
const trustedHouses: Set<string> = new Set();
/**
 * When true, sound effects fired by `Forge.PlaySoundEvent` are cancelled
 * while an import is in flight. Suppresses the repetitive ding/click
 * sounds Hypixel plays on every housing menu open during an import.
 */
let muteImportSounds: boolean = false;
let housingUuid: string | null = null;
let knowledgeRows: CacheStatusRow[] = [];
let importProgress: ImportProgress | null = null;
/**
 * `Date.now()` of the moment the in-flight import started. Captured the
 * first time `setImportProgress` transitions from null to non-null and
 * cleared on the inverse transition.
 */
let importStartedAt: number | null = null;

export function getImportProgressFraction(): number {
    const p = importProgress;
    if (p === null || p.totalUnits <= 0) return 0;
    return Math.min(1, Math.max(0, p.completedUnits / p.totalUnits));
}

export function getImportEtaSeconds(): number | null {
    if (importStartedAt === null) return null;
    return etaGetImportEtaSeconds(importProgress, importStartedAt);
}

export function getCurrentPhaseEtaSeconds(): number | null {
    return etaGetCurrentPhaseEtaSeconds(importProgress, importStartedAt);
}
export function getImportJsonPath(): string {
    return importJsonPath;
}
export function setImportJsonPath(path: string): void {
    importJsonPath = normalizeHtswPath(path);
}

export function getExportImportJsonPath(): string {
    return exportImportJsonPath === null ? importJsonPath : exportImportJsonPath;
}
export function setExportImportJsonPath(path: string): void {
    exportImportJsonPath = normalizeHtswPath(path);
}

export function getParsedResult(): ParseResult<Importable[]> | null {
    return parsedResult;
}
export function setParsedResult(r: ParseResult<Importable[]> | null): void {
    parsedResult = r;
}

export function setParseError(msg: string | null): void {
    void msg;
}

export function isImportableChecked(key: string): boolean {
    return checkedImportableKeys.has(key);
}
export function toggleImportableChecked(key: string): boolean {
    if (checkedImportableKeys.has(key)) {
        checkedImportableKeys.delete(key);
        return false;
    }
    checkedImportableKeys.add(key);
    return true;
}
export function clearImportableChecks(): void {
    checkedImportableKeys.clear();
}
export function getCheckedImportableKeys(): Set<string> {
    return checkedImportableKeys;
}
export function getCheckedImportableCount(): number {
    return checkedImportableKeys.size;
}

export function isHouseTrusted(uuid: string): boolean {
    return trustedHouses.has(uuid);
}
export function setHouseTrust(uuid: string, trusted: boolean): void {
    if (trusted) trustedHouses.add(uuid);
    else trustedHouses.delete(uuid);
}
/** Trust mode is now per-house: an in-flight import trusts the cache iff
 *  the current housing UUID is in the trusted-houses set. */
export function isCurrentHouseTrusted(): boolean {
    return housingUuid !== null && trustedHouses.has(housingUuid);
}

export function isImportSoundsMuted(): boolean {
    return muteImportSounds;
}
export function setImportSoundsMuted(muted: boolean): void {
    muteImportSounds = muted;
}

export function getHousingUuid(): string | null {
    return housingUuid;
}
export function setHousingUuid(uuid: string | null): void {
    housingUuid = uuid;
}

export function getKnowledgeRows(): CacheStatusRow[] {
    return knowledgeRows;
}
export function setKnowledgeRows(rows: CacheStatusRow[]): void {
    knowledgeRows = rows;
}

export function getImportProgress(): ImportProgress | null {
    return importProgress;
}

export function createImportRows(
    importables: readonly Importable[],
    sourcePath: string
): ImportProgressRow[] {
    const rows: ImportProgressRow[] = [];
    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        const identity = importableIdentity(importable);
        rows.push({
            key: importProgressKey(importable.type, identity, sourcePath),
            status: "queued",
            units: 1,
        });
    }
    return rows;
}

export function createImportProgress(init: Partial<ImportProgress>): ImportProgress {
    return normalizeImportProgress({
        completedImportables: init.completedImportables ?? 0,
        totalImportables: init.totalImportables ?? 1,
        completedUnits: init.completedUnits ?? 0,
        totalUnits: init.totalUnits ?? 1,
        current: init.current ?? null,
        rows: init.rows ?? [],
        failed: init.failed ?? 0,
    });
}

function normalizeImportProgress(p: ImportProgress): ImportProgress {
    const completedUnits = Math.max(0, p.completedUnits);
    const totalUnits = Math.max(1, p.totalUnits, completedUnits);
    return {
        ...p,
        completedUnits,
        totalUnits,
    };
}

export function setImportProgress(p: ImportProgress | null): void {
    const wasNull = importProgress === null;
    const prevPhase = importProgress?.current?.phase ?? null;
    const prevKey = importProgress?.current?.key ?? null;
    if (p !== null && importProgress === null) {
        importStartedAt = Date.now();
    } else if (p === null) {
        importStartedAt = null;
    }
    importProgress = p === null ? null : normalizeImportProgress(p);
    const nextPhase = p?.current?.phase ?? null;
    const nextKey = p?.current?.key ?? null;
    if (wasNull || p === null || prevPhase !== nextPhase || prevKey !== nextKey) {
        resetEtaCache();
    }
    // On import start, flip the right panel to the Import tab so the
    // user sees the live progress without having to click. On end,
    // flip back to View (where they were before the import) — but only
    // if we're still on Import, so we don't override an explicit user
    // navigation away mid-import.
    if (p !== null && wasNull) {
        setActiveRightTab("import");
    } else if (p === null && !wasNull && getActiveRightTab() === "import") {
        setActiveRightTab("view");
    }
}
export function getImportStartedAt(): number | null {
    return importStartedAt;
}

export function getCurrentImportingPath(): string | null {
    return currentImportingPath;
}
export function setCurrentImportingPath(p: string | null): void {
    currentImportingPath = p;
}

/**
 * Render-state for a queue row's mini progress bar. "queued" → empty bar;
 * "done" → full green; "failed" → full red; "current" → phase-segmented
 * showing how far through each phase we are within this importable.
 */
export type QueueItemRunState =
    | { kind: "queued" }
    | { kind: "done" }
    | { kind: "failed" }
    | {
          kind: "current";
          readFraction: number;
          hydrateFraction: number;
          applyFraction: number;
          /** Relative widths of the three phases (sum = 1). */
          readWidth: number;
          hydrateWidth: number;
          applyWidth: number;
      };

export function getQueueItemRunState(item: QueueItem): QueueItemRunState {
    if (importProgress === null) {
        return { kind: "queued" };
    }
    if (item.kind !== "importable") {
        // importJson rows aren't tracked individually; treat as queued.
        return { kind: "queued" };
    }
    const key = importProgressKey(item.type, item.identity, item.sourcePath);
    let row: ImportProgressRow | undefined;
    for (let i = 0; i < importProgress.rows.length; i++) {
        if (importProgress.rows[i].key === key) {
            row = importProgress.rows[i];
            break;
        }
    }
    if (row === undefined) return { kind: "queued" };
    if (row.status === "imported" || row.status === "skipped") {
        return { kind: "done" };
    }
    if (row.status === "failed") {
        // The session halts on first failure, so everything after this
        // stays queued. We render the failed row with the error color
        // (distinct from the green "done" fill) so the user can see at a
        // glance which importable aborted the run.
        return { kind: "failed" };
    }
    if (row.status === "queued") return { kind: "queued" };
    const current = importProgress.current;
    if (current === null || current.key !== key) {
        return {
            kind: "current",
            readFraction: 0,
            hydrateFraction: 0,
            applyFraction: 0,
            readWidth: 0.33,
            hydrateWidth: 0.33,
            applyWidth: 0.34,
        };
    }
    const units = current.phaseUnits;
    const total = Math.max(1, units.reading + units.hydrating + units.applying);
    const within = Math.max(0, current.completedUnits);
    const readDone = Math.min(units.reading, within);
    const hydrateDone = Math.min(
        units.hydrating,
        Math.max(0, within - units.reading)
    );
    const applyDone = Math.min(
        units.applying,
        Math.max(0, within - units.reading - units.hydrating)
    );
    return {
        kind: "current",
        readFraction: units.reading > 0 ? readDone / units.reading : 1,
        hydrateFraction: units.hydrating > 0 ? hydrateDone / units.hydrating : 1,
        applyFraction: units.applying > 0 ? applyDone / units.applying : 0,
        readWidth: units.reading / total,
        hydrateWidth: units.hydrating / total,
        applyWidth: units.applying / total,
    };
}

/**
 * True iff this queue item corresponds to the importable currently being
 * processed by the in-flight import session.
 */
export function isCurrentQueueItem(item: QueueItem): boolean {
    if (importProgress === null) return false;
    const current = importProgress.current;
    if (current === null) return false;
    if (item.kind === "importable") {
        return current.key === importProgressKey(
            item.type,
            item.identity,
            item.sourcePath
        );
    }
    if (currentImportingPath === null) return false;
    return canonicalPath(item.sourcePath) === canonicalPath(currentImportingPath);
}
