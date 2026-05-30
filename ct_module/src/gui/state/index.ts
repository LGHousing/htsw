/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import type { CacheStatusRow } from "../../importCache/status";
import { buildCacheStatusRows } from "../../importCache/status";
import { importableHash } from "../../importCache/hash";
import { importableIdentity } from "../../importCache/paths";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { canonicalPath } from "./parses";

// Re-export the import-session subset so consumers can keep `import { ... } from "./state"`.
export * from "./importProgress";

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
const TRUSTED_HOUSES_FILE = "./htsw/.cache/trusted-houses.json";
let trustedHousesLoaded = false;
const trustedHouses: Set<string> = new Set();
function loadTrustedHouses(): void {
    if (trustedHousesLoaded) return;
    trustedHousesLoaded = true;
    try {
        if (!FileLib.exists(TRUSTED_HOUSES_FILE)) return;
        const raw = String(FileLib.read(TRUSTED_HOUSES_FILE) ?? "");
        if (raw.trim() === "") return;
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++) {
            if (typeof arr[i] === "string") trustedHouses.add(arr[i] as string);
        }
    } catch (_e) {}
}
function saveTrustedHouses(): void {
    try {
        const arr: string[] = [];
        trustedHouses.forEach((uuid) => arr.push(uuid));
        FileLib.write(TRUSTED_HOUSES_FILE, JSON.stringify(arr), true);
    } catch (_e) {}
}
/**
 * When true, sound effects fired by `Forge.PlaySoundEvent` are cancelled
 * while an import is in flight. Suppresses the repetitive ding/click
 * sounds Hypixel plays on every housing menu open during an import.
 */
let muteImportSounds: boolean = false;
let housingUuid: string | null = null;
let knowledgeRows: CacheStatusRow[] = [];

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

let parseInProgress = false;
export function isParseInProgress(): boolean {
    return parseInProgress;
}
export function setParseInProgress(v: boolean): void {
    parseInProgress = v;
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

const autoTrackSources: Set<string> = new Set();
export function isAutoTrackSource(sourcePath: string): boolean {
    return autoTrackSources.has(canonicalPath(sourcePath));
}
export function toggleAutoTrackSource(sourcePath: string): boolean {
    const canon = canonicalPath(sourcePath);
    if (autoTrackSources.has(canon)) {
        autoTrackSources.delete(canon);
        return false;
    }
    autoTrackSources.add(canon);
    return true;
}
export function isAnyAutoTrackEnabled(): boolean { return autoTrackSources.size > 0; }
export function getAutoTrackSources(): ReadonlySet<string> { return autoTrackSources; }

export function isHouseTrusted(uuid: string): boolean {
    loadTrustedHouses();
    return trustedHouses.has(uuid);
}
export function setHouseTrust(uuid: string, trusted: boolean): void {
    loadTrustedHouses();
    if (trusted) trustedHouses.add(uuid);
    else trustedHouses.delete(uuid);
    saveTrustedHouses();
}
/** Trust mode is now per-house: an in-flight import trusts the cache iff
 *  the current housing UUID is in the trusted-houses set. */
export function isCurrentHouseTrusted(): boolean {
    loadTrustedHouses();
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
export function appendKnowledgeRows(rows: CacheStatusRow[]): void {
    if (rows.length === 0) return;
    knowledgeRows = knowledgeRows.concat(rows);
}

/**
 * Recompute the hash + state for the knowledge row matching this
 * importable. Use after an in-place mutation so the diff dots stay
 * accurate without rebuilding every row.
 */
export function refreshKnowledgeRowFor(imp: Importable): void {
    const id = importableIdentity(imp);
    for (let i = 0; i < knowledgeRows.length; i++) {
        const row = knowledgeRows[i];
        if (row.identity !== id || row.importable.type !== imp.type) continue;
        const newHash = importableHash(imp);
        row.importable = imp;
        row.hash = newHash;
        row.state = row.entry === null
            ? "unknown"
            : row.entry.hash === newHash ? "current" : "modified";
        return;
    }
}

/**
 * Re-read ONE importable's cache from disk and upsert its knowledge row.
 * Unlike `refreshKnowledgeRowFor` (which reuses the row's stale `entry`), this
 * picks up a freshly-written cache file — so a dot turns green the instant its
 * import finishes, without rebuilding all rows through the batched full refresh.
 */
export function refreshKnowledgeRowFromDisk(housingUuid: string, imp: Importable): void {
    const built = buildCacheStatusRows(housingUuid, [imp]);
    if (built.length === 0) return;
    const newRow = built[0];
    for (let i = 0; i < knowledgeRows.length; i++) {
        if (
            knowledgeRows[i].identity === newRow.identity &&
            knowledgeRows[i].importable.type === newRow.importable.type
        ) {
            knowledgeRows[i] = newRow;
            return;
        }
    }
    knowledgeRows.push(newRow);
}
