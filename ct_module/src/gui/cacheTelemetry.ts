import { lineModelCacheSizes } from "./code-view/lineModel";
import { subtreeAggregateCacheSize } from "./left-panel/projects/rows";
import { enumerationCacheSize } from "./left-panel/projects/source";
import { parseCacheSizes } from "./parsing/parses";
import { livePreviewCacheSize } from "./right-panel/import-tab/livePreview";
import { debugLog } from "./lib/debugLog";

export function logGuiCacheSizes(): void {
    const parse = parseCacheSizes();
    const lines = lineModelCacheSizes();
    debugLog(
        `cache sizes parse=${parse.parses} canonicalPaths=${parse.canonicalPaths} ` +
            `lines={plain:${lines.plain},htsl:${lines.htsl},json:${lines.json},snbt:${lines.snbt},raw:${lines.htslRaw}} ` +
            `projectEnumeration=${enumerationCacheSize()} subtreeAggregates=${subtreeAggregateCacheSize()} ` +
            `livePreviews=${livePreviewCacheSize()}`
    );
}
