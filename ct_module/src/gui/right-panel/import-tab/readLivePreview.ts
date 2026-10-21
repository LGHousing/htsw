import type { Importable } from "htsw/types";

import type { SyncEventHandler } from "@htsw/importer/housingSync/syncEvents";
import type { ObservedNode } from "@htsw/importer/housingSync/observedActions";
import { ActionPath, type ActionPathKey } from "@htsw/importer/housingSync/actionPath";
import {
    activatePreview,
    disposePreviewOperation,
    getCurrentPath,
    hasPreviewState,
    markReadComplete,
    markPreviewCompleted,
    resetPreview,
    setCurrent,
    setObservedTopLevel,
} from "./livePreview";
import {
    readPreviewPath,
    type ReadProgressObserver,
} from "@htsw/importer/runtime/readProgress";

export function createReadLivePreview(
    type: Importable["type"],
    basePath: string
): ReadProgressObserver {
    let paths: string[] = [];
    let activeIndex: number | null = null;
    const latestSnapshots: Array<readonly ObservedNode[] | null | undefined> = [];
    const completedPaths: Array<Map<ActionPathKey, ActionPath>> = [];

    const activePath = (): string | null => {
        if (activeIndex === null || activeIndex < 0 || activeIndex >= paths.length)
            return null;
        return paths[activeIndex];
    };

    const restore = (index: number, path: string): void => {
        if (hasPreviewState(path)) return;
        const snapshot = latestSnapshots[index];
        if (snapshot !== null && snapshot !== undefined) {
            setObservedTopLevel(path, snapshot, { force: true });
            const completed = completedPaths[index];
            for (const completedPath of completed.values()) {
                markReadComplete(path, completedPath);
            }
        }
    };

    const events: SyncEventHandler = {
        emit(event) {
            const path = activePath();
            const index = activeIndex;
            if (path === null || index === null) return;
            if (event.kind === "readStarted") {
                if (event.listPath.parts.length === 0) {
                    latestSnapshots[index] = null;
                    completedPaths[index].clear();
                    resetPreview(path);
                }
                setCurrent(path, null);
            } else if (event.kind === "childListReadStarted") {
                setCurrent(path, event.path);
            } else if (event.kind === "observedSnapshot") {
                latestSnapshots[index] = event.nodes;
                setObservedTopLevel(path, event.nodes);
            } else if (event.kind === "actionReadCompleted") {
                if (event.hydrated) {
                    const snapshot = latestSnapshots[index];
                    if (snapshot !== null && snapshot !== undefined) {
                        setObservedTopLevel(path, snapshot, { force: true });
                    }
                }
                completedPaths[index].set(ActionPath.key(event.path), event.path);
                markReadComplete(path, event.path);
                setCurrent(path, null);
            }
        },
    };

    return {
        events,
        eventsForList: () => events,
        start(names) {
            paths = names.map((_name, index) => readPreviewPath(basePath, type, index));
            activeIndex = null;

            latestSnapshots.length = names.length;
            completedPaths.length = names.length;
            for (let i = 0; i < latestSnapshots.length; i++) latestSnapshots[i] = null;
            for (let i = 0; i < completedPaths.length; i++) {
                completedPaths[i] = new Map();
            }
            if (paths.length > 0) {
                activatePreview(paths[0]);
                resetPreview(paths[0]);
            }
        },
        activate(index, reset) {
            if (index < 0 || index >= paths.length) return;
            const path = paths[index];
            activeIndex = index;
            activatePreview(path);
            if (reset) {
                latestSnapshots[index] = null;
                completedPaths[index] = new Map();
                resetPreview(path);
            } else {
                restore(index, path);
            }
            setCurrent(path, null);
        },
        finish(index) {
            if (index < 0 || index >= paths.length) return;
            const path = paths[index];
            restore(index, path);
            const snapshot = latestSnapshots[index];
            if (snapshot !== null && snapshot !== undefined) {
                setObservedTopLevel(path, snapshot, { force: true });
            }
            if (getCurrentPath(path) !== null) setCurrent(path, null);
            markPreviewCompleted(path);
        },
        fail(index) {
            if (index < 0 || index >= paths.length) return;
            latestSnapshots[index] = null;
            completedPaths[index].clear();
            resetPreview(paths[index]);
        },
        clear() {
            disposePreviewOperation(paths);
            paths = [];
            latestSnapshots.length = 0;
            completedPaths.length = 0;
            activeIndex = null;
        },
    };
}
