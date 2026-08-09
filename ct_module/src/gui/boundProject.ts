/// <reference types="../../CTAutocomplete" />

import { boundImportJsonPath } from "../importCache/houseBindings";
import { canonicalPath } from "./parsing/parses";
import { addRecent } from "./persistence/recents";
import { forceImportExpand } from "./left-panel/projects/rows";
import { getSources, queueSourcePath, removeSource } from "./left-panel/projects/source";
import { setActiveLeftTab } from "./left-panel/tabs";
import {
    clearExportImportJsonPath,
    getImportJsonPath,
    setExportImportJsonPath,
    setImportJsonPath,
} from "./state";
import { closeTabsForProject } from "./right-panel/selection";

export function openBoundProjectForHouse(uuid: string | null): boolean {
    if (uuid === null) return false;
    const bound = boundImportJsonPath(uuid);
    if (bound === null || !FileLib.exists(bound)) return false;
    const canon = canonicalPath(bound);
    queueSourcePath(bound);
    forceImportExpand(canon);
    setImportJsonPath(bound);
    setExportImportJsonPath(bound);
    addRecent(bound);
    setActiveLeftTab("projects");
    return true;
}

export function closeBoundProjectForHouse(uuid: string | null): void {
    const bound = uuid === null ? null : boundImportJsonPath(uuid);
    if (bound !== null) {
        const canon = canonicalPath(bound);
        closeTabsForProject(canon);
        getSources();
        removeSource(canon);
        if (canonicalPath(getImportJsonPath()) === canon) setImportJsonPath("");
    }
    clearExportImportJsonPath();
}
