/// <reference types="../../CTAutocomplete" />

import { PROJECTS_ROOT } from "@htsw/importer/project/paths";
import { queueSourcePath } from "./left-panel/projects/source";
import { forceImportExpand } from "./left-panel/projects/rows";
import { canonicalPath } from "@htsw/importer/runtime/parsing/parses";
import { previewSelect } from "./right-panel/selection";
import { setImportJsonPath } from "@htsw/importer/runtime/state/index";
import { addRecent } from "@htsw/importer/persistence/recents";
import { showToast } from "./toast";
import {
    STARTER_PROJECT_NAME,
    createStarterProjectFiles,
    joinPath,
} from "htsw-editor-common/project";
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
        showToast(`Couldn't create starter project: ${String(err)}`, 0xffe85c5c, 8000);
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
