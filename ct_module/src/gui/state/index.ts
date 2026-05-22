/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import type { CacheStatusRow } from "../../importCache/status";
import { normalizeHtswPath } from "../lib/pathDisplay";

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
