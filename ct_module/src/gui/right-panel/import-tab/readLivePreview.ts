import type { Importable } from "htsw/types";

import type { SyncEventHandler } from "../../../housingSync/syncEvents";
import type { ObservedNode } from "../../../housingSync/observedActions";
import {
    getCurrentPath,
    markReadComplete,
    markPreviewCompleted,
    resetPreview,
    setCurrent,
    setObservedTopLevel,
} from "./livePreview";
import { setActiveTaskPath } from "./taskProgress";

export type ReadLivePreview = {
    events: SyncEventHandler;
    start(names: readonly string[]): void;
    activate(index: number, reset: boolean): void;
    finish(index: number): void;
    clear(): void;
};

function previewPath(basePath: string, type: Importable["type"], index: number): string {
    return `${basePath}.live-${type.toLowerCase()}-${index}.htsl`;
}

export function createReadLivePreview(
    type: Importable["type"],
    basePath: string
): ReadLivePreview {
    let paths: string[] = [];
    let activeIndex: number | null = null;
    const latestSnapshots: Array<readonly ObservedNode[] | null | undefined> = [];

    const activePath = (): string | null => {
        if (activeIndex === null || activeIndex < 0 || activeIndex >= paths.length) return null;
        return paths[activeIndex];
    };

    const events: SyncEventHandler = {
        emit(event) {
            const path = activePath();
            const index = activeIndex;
            if (path === null || index === null) return;
            if (event.kind === "readStarted") {
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
                markReadComplete(path, event.path);
                setCurrent(path, null);
            }
        },
    };

    return {
        events,
        start(names) {
            paths = names.map((_name, index) => previewPath(basePath, type, index));
            activeIndex = null;
            latestSnapshots.length = names.length;
            for (let i = 0; i < latestSnapshots.length; i++) latestSnapshots[i] = null;
            if (paths.length > 0) {
                resetPreview(paths[0]);
                setActiveTaskPath(paths[0]);
            }
        },
        activate(index, reset) {
            if (index < 0 || index >= paths.length) return;
            const path = paths[index];
            activeIndex = index;
            if (reset) {
                latestSnapshots[index] = null;
                resetPreview(path);
            }
            setCurrent(path, null);
            setActiveTaskPath(path);
        },
        finish(index) {
            if (index < 0 || index >= paths.length) return;
            const path = paths[index];
            const snapshot = latestSnapshots[index];
            if (snapshot !== null && snapshot !== undefined) {
                setObservedTopLevel(path, snapshot, { force: true });
            }
            if (getCurrentPath(path) !== null) setCurrent(path, null);
            markPreviewCompleted(path);
        },
        clear() {
            activeIndex = null;
            setActiveTaskPath(null);
        },
    };
}
