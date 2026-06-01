import type { Importable } from "htsw/types";

import { buildCacheStatusRows } from "../../importCache/status";
import { setKnowledgeRows } from "./index";

export function rebuildKnowledgeRows(uuid: string, importables: readonly Importable[]): void {
    setKnowledgeRows(buildCacheStatusRows(uuid, importables));
}
