/// <reference types="../../CTAutocomplete" />

import { PROJECTS_ROOT } from "../project/paths";
import { queueSourcePath } from "./left-panel/importables/source";
import { forceImportExpand } from "./left-panel/importables/rows";
import { canonicalPath } from "./parsing/parses";
import { previewSelect } from "./right-panel/selection";
import { setImportJsonPath } from "./state";
import { addRecent } from "./persistence/recents";
import { showToast } from "./toast";
import { STARTER_PROJECT_NAME, createStarterProjectFiles, joinPath } from "htsw-editor-common/project";
import { ctProjectFs } from "../project/projectFs";

export const STARTER_DIR = joinPath(PROJECTS_ROOT, STARTER_PROJECT_NAME);

export function createStarterProject(): void {
    let importJsonPath: string;
    let created: boolean;
    try {
        const result = createStarterProjectFiles(ctProjectFs, PROJECTS_ROOT);
        importJsonPath = result.importJsonPath;
        created = result.created;
    } catch (err) {
        showToast(`Couldn't create starter project: ${err}`, 0xffe85c5c, 8000);
        return;
    }
    if (created) {
        showToast(`Created starter project in ${STARTER_DIR}`, 0xff5cb85c);
    }
    queueSourcePath(importJsonPath);
    const canon = canonicalPath(importJsonPath);
    // "Open" must visibly do something even when everything below is already
    // true: reveal the project (past an explicit collapse) and show its
    // import.json in the View pane.
    forceImportExpand(canon);
    previewSelect(canon, canon);
    setImportJsonPath(importJsonPath);
    addRecent(importJsonPath);
}
