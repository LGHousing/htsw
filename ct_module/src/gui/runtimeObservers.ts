import {
    boundProjectChanges,
    exportQueueStarts,
    conflictReviews,
    housingWorldLoads,
    runtimeChanges,
    taskPathChanges,
    taskProgressChanges,
    toasts,
} from "../runtime/events";
import { conflictPrompts } from "../runtime/conflictPrompt";
import { importSessions } from "../runtime/taskController";
import { readSessions } from "../runtime/readProgress";
import { getActiveTaskPath } from "../runtime/taskProgress";
import { slowSpanEvents } from "../perf/spans";
import { debugLog } from "./lib/debugLog";
import { getAutoRunBadge } from "../runtime/autoRun";
import { markGuiDirty } from "./lib/dirty";
import { invalidateContainerBoundsCache } from "./lib/bounds";
import {
    onTaskRunningChanged,
    previewSelect,
    rememberLiveTaskPath,
    setLiveTaskPathProvider,
    closeTabsForProject,
} from "./right-panel/selection";
import { showToast, dismissToast } from "./toast";
import { registerBadge } from "./badge";
import { renderConflictPrompt } from "./popovers/conflictPrompt";
import { closeAllPopovers } from "./lib/popovers";
import { createImportPreviewObserver } from "./right-panel/import-tab/importPreviewObserver";
import { createReadLivePreview } from "./right-panel/import-tab/readLivePreview";
import { forceImportExpand } from "./left-panel/projects/rows";
import { getSources, queueSourcePath, removeSource } from "./left-panel/projects/source";
import { setActiveLeftTab } from "./left-panel/tabs";

let initialized = false;
export function initRuntimeGuiObservers(): void {
    if (initialized) return;
    initialized = true;
    runtimeChanges.observe(markGuiDirty);
    slowSpanEvents.observe(({ ms, path }) =>
        debugLog(`[lagprobe] slow span ${ms}ms: ${path}`)
    );
    taskPathChanges.observe(rememberLiveTaskPath);
    taskProgressChanges.observe(({ wasRunning, running, needsAttention }) => {
        onTaskRunningChanged(wasRunning, running, needsAttention);
    });
    setLiveTaskPathProvider(getActiveTaskPath);
    toasts.observe((event) => {
        if (event.kind === "dismiss") dismissToast(event.key);
        else showToast(event.message, event.color, event.durationMs, event.key);
    });
    registerBadge(getAutoRunBadge);
    exportQueueStarts.observe(() => closeAllPopovers());
    conflictReviews.observe(({ path, sourcePath }) => previewSelect(path, sourcePath));
    importSessions.observe(({ args, observe }) =>
        observe(createImportPreviewObserver(args))
    );
    readSessions.observe(({ type, basePath, observe }) => {
        observe(createReadLivePreview(type, basePath));
    });
    conflictPrompts.observe(renderConflictPrompt);
    housingWorldLoads.observe(invalidateContainerBoundsCache);
    boundProjectChanges.observe((event) => {
        if (event.kind === "open") {
            queueSourcePath(event.path);
            forceImportExpand(event.canonicalPath);
        } else if (event.kind === "opened") {
            setActiveLeftTab("projects");
        } else {
            closeTabsForProject(event.canonicalPath);
            getSources();
            removeSource(event.canonicalPath);
        }
    });
}
