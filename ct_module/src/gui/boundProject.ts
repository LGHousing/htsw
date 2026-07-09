/// <reference types="../../CTAutocomplete" />

import { boundImportJsonPath } from "../importCache/houseBindings";
import { canonicalPath } from "./parsing/parses";
import { addRecent } from "./persistence/recents";
import { forceImportExpand } from "./left-panel/importables/rows";
import { queueSourcePath } from "./left-panel/importables/source";
import { setActiveLeftTab } from "./left-panel/tabs";
import { setExportImportJsonPath, setImportJsonPath } from "./state";

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
    setActiveLeftTab("importables");
    return true;
}
