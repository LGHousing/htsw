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
import { forEachCachedParse, parseCacheSizes } from "./parsing/parses";
import { rightPanelFileCacheSize } from "./right-panel";
import { focusedLineCacheSize } from "./right-panel/import-tab/focusedLine";
import { livePreviewCacheTelemetry } from "./right-panel/import-tab/livePreview";
import { queueItemsCacheSize } from "./right-panel/import-tab/queue";
import { queueRowCacheSizes } from "./right-panel/import-tab/queueRows";
import { debugLog } from "./lib/debugLog";

export function guiCacheSizes() {
    const parse = parseCacheSizes();
    const lines = lineModelCacheSizes();
    const images = imageCacheSizes();
    const sourceDiff = sourceDiffCacheSizes();
    const queueRows = queueRowCacheSizes();
    const importCache = importCacheMemorySizes();
    const livePreviews = livePreviewCacheTelemetry();
    return {
        unboundedParses: parse.parses,
        boundedCanonicalPaths: parse.canonicalPaths,
        boundedLinePlain: lines.plain,
        boundedLineHtsl: lines.htsl,
        boundedLineJson: lines.json,
        boundedLineSnbt: lines.snbt,
        boundedLineHtslRaw: lines.htslRaw,
        boundedProjectEnumeration: enumerationCacheSize(),
        boundedSubtreeAggregates: subtreeAggregateCacheSize(),
        boundedLivePreviews: livePreviews.states,
        boundedLivePreviewLines: livePreviews.lines,
        boundedLivePreviewTokens: livePreviews.tokens,
        boundedLivePreviewPendingNodes: livePreviews.pendingNodes,
        boundedTextWidths: textWidthCacheSize(),
        boundedTruncations: truncateCacheSize(),
        boundedHtslParses: htslParseCacheSize(),
        unboundedMcItems: images.mcItems,
        unboundedIcons: images.icons,
        unboundedAnchors: anchorCacheSize(),
        unboundedCodeViewModels: codeViewModelCacheSize(),
        unboundedSourceDiffEntries: sourceDiff.entries,
        unboundedSourceDiffFileTargets: sourceDiff.fileTargets,
        unboundedRightPanelFiles: rightPanelFileCacheSize(),
        unboundedQueueItems: queueItemsCacheSize(),
        unboundedQueueSourceIndexes: queueRows.sourceIndexes,
        unboundedQueueSkipPredictions: queueRows.skipPredictions,
        unboundedImportCacheReads: importCache.reads,
        unboundedImportCacheEnumerations: importCache.enumerations,
        unboundedImportCacheScanMarkers: importCache.scanMarkers,
        unboundedCanonicalDefaults: canonicalDefaultCacheSize(),
        unboundedFocusedLines: focusedLineCacheSize(),
    };
}

export type GuiCacheSizes = ReturnType<typeof guiCacheSizes>;

export function parsedManifestCount(): number {
    let count = 0;
    forEachCachedParse((entry) => {
        if (entry.parsed !== null) count++;
    });
    return count;
}

export function logGuiCacheSizes(): void {
    const sizes = guiCacheSizes();
    debugLog(
        `cache sizes bounded={canonicalPaths:${sizes.boundedCanonicalPaths},` +
            `linePlain:${sizes.boundedLinePlain},lineHtsl:${sizes.boundedLineHtsl},` +
            `lineJson:${sizes.boundedLineJson},lineSnbt:${sizes.boundedLineSnbt},` +
            `lineHtslRaw:${sizes.boundedLineHtslRaw},` +
            `projectEnumeration:${sizes.boundedProjectEnumeration},` +
            `subtreeAggregates:${sizes.boundedSubtreeAggregates},` +
            `livePreviews:${sizes.boundedLivePreviews},livePreviewLines:${sizes.boundedLivePreviewLines},` +
            `livePreviewTokens:${sizes.boundedLivePreviewTokens},` +
            `livePreviewPendingNodes:${sizes.boundedLivePreviewPendingNodes},` +
            `textWidths:${sizes.boundedTextWidths},` +
            `truncations:${sizes.boundedTruncations},htslParses:${sizes.boundedHtslParses}} ` +
            `unbounded={parses:${sizes.unboundedParses},mcItems:${sizes.unboundedMcItems},icons:${sizes.unboundedIcons},` +
            `anchors:${sizes.unboundedAnchors},codeViewModels:${sizes.unboundedCodeViewModels},` +
            `sourceDiffEntries:${sizes.unboundedSourceDiffEntries},` +
            `sourceDiffFileTargets:${sizes.unboundedSourceDiffFileTargets},` +
            `rightPanelFiles:${sizes.unboundedRightPanelFiles},queueItems:${sizes.unboundedQueueItems},` +
            `queueSourceIndexes:${sizes.unboundedQueueSourceIndexes},` +
            `queueSkipPredictions:${sizes.unboundedQueueSkipPredictions},` +
            `importCacheReads:${sizes.unboundedImportCacheReads},` +
            `importCacheEnumerations:${sizes.unboundedImportCacheEnumerations},` +
            `importCacheScanMarkers:${sizes.unboundedImportCacheScanMarkers},` +
            `canonicalDefaults:${sizes.unboundedCanonicalDefaults},` +
            `focusedLines:${sizes.unboundedFocusedLines}}`
    );
}
