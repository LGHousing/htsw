import { boundProjectChanges } from "./events";
/// <reference types="../../CTAutocomplete" />

import { boundImportJsonPath } from "../importCache/houseBindings";
import { canonicalPath } from "./parsing/parses";
import { addRecent } from "../persistence/recents";
import {
    clearExportImportJsonPath,
    getImportJsonPath,
    setExportImportJsonPath,
    setImportJsonPath,
} from "./state";

export function openBoundProjectForHouse(uuid: string | null): boolean {
    if (uuid === null) return false;
    const bound = boundImportJsonPath(uuid);
    if (bound === null || !FileLib.exists(bound)) return false;
    const canon = canonicalPath(bound);
    boundProjectChanges.emit({ kind: "open", uuid, path: bound, canonicalPath: canon });
    setImportJsonPath(bound);
    setExportImportJsonPath(bound);
    addRecent(bound);
    boundProjectChanges.emit({ kind: "opened", uuid, path: bound, canonicalPath: canon });
    return true;
}

export function closeBoundProjectForHouse(uuid: string | null): void {
    const bound = uuid === null ? null : boundImportJsonPath(uuid);
    if (bound !== null) {
        const canon = canonicalPath(bound);
        boundProjectChanges.emit({
            kind: "close",
            uuid,
            path: bound,
            canonicalPath: canon,
        });
        if (canonicalPath(getImportJsonPath()) === canon) setImportJsonPath("");
    }
    clearExportImportJsonPath();
}
