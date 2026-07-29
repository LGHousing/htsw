import { canonicalDefaultCacheSize } from "../housingSync/actions/comparison";
import { importCacheMemorySizes } from "../importCache/cache";
import { codeViewModelCacheSize } from "./code-view/codeView";
import { htslParseCacheSize } from "./code-view/htslParse";
import { lineModelCacheSizes } from "./code-view/lineModel";
import { sourceDiffCacheSizes } from "./code-view/sourceDiff";
import { subtreeAggregateCacheSize } from "./left-panel/projects/rows";
import { enumerationCacheSize } from "./left-panel/projects/source";
import { anchorCacheSize } from "./lib/anchors";
import { imageCacheSizes } from "./lib/images";
import { textWidthCacheSize } from "./lib/layout";
import { truncateCacheSize } from "./lib/render";
import { parseCacheSizes } from "./parsing/parses";
import { rightPanelFileCacheSize } from "./right-panel";
import { focusedLineCacheSize } from "./right-panel/import-tab/focusedLine";
import { livePreviewCacheSize } from "./right-panel/import-tab/livePreview";
import { queueItemsCacheSize } from "./right-panel/import-tab/queue";
import { queueRowCacheSizes } from "./right-panel/import-tab/queueRows";
import { debugLog } from "./lib/debugLog";

export function logGuiCacheSizes(): void {
    const parse = parseCacheSizes();
    const lines = lineModelCacheSizes();
    const images = imageCacheSizes();
    const sourceDiff = sourceDiffCacheSizes();
    const queueRows = queueRowCacheSizes();
    const importCache = importCacheMemorySizes();
    debugLog(
        `cache sizes bounded={parse:${parse.parses},canonicalPaths:${parse.canonicalPaths},` +
            `linePlain:${lines.plain},lineHtsl:${lines.htsl},lineJson:${lines.json},` +
            `lineSnbt:${lines.snbt},lineHtslRaw:${lines.htslRaw},` +
            `projectEnumeration:${enumerationCacheSize()},` +
            `subtreeAggregates:${subtreeAggregateCacheSize()},` +
            `livePreviews:${livePreviewCacheSize()},textWidths:${textWidthCacheSize()},` +
            `truncations:${truncateCacheSize()},htslParses:${htslParseCacheSize()}} ` +
            `unbounded={mcItems:${images.mcItems},icons:${images.icons},` +
            `anchors:${anchorCacheSize()},codeViewModels:${codeViewModelCacheSize()},` +
            `sourceDiffEntries:${sourceDiff.entries},sourceDiffFileTargets:${sourceDiff.fileTargets},` +
            `rightPanelFiles:${rightPanelFileCacheSize()},queueItems:${queueItemsCacheSize()},` +
            `queueSourceIndexes:${queueRows.sourceIndexes},` +
            `queueSkipPredictions:${queueRows.skipPredictions},` +
            `importCacheReads:${importCache.reads},` +
            `importCacheEnumerations:${importCache.enumerations},` +
            `importCacheScanMarkers:${importCache.scanMarkers},` +
            `canonicalDefaults:${canonicalDefaultCacheSize()},` +
            `focusedLines:${focusedLineCacheSize()}}`
    );
}
