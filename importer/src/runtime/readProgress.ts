import type { Importable } from "htsw/types";
import type { SyncEventHandler } from "../housingSync/syncEvents";
import { Observers } from "../utils/observers";
import { setActiveTaskListLabel, setActiveTaskPath } from "./taskProgress";

export type ReadProgressObserver = {
    events: SyncEventHandler;
    eventsForList: (label: string) => SyncEventHandler;
    start(names: readonly string[]): void;
    activate(index: number, reset: boolean): void;
    finish(index: number): void;
    fail(index: number): void;
    clear(): void;
};

export function readPreviewPath(
    basePath: string,
    type: Importable["type"],
    index: number
): string {
    return `${basePath}.live-${type.toLowerCase()}-${index}.htsl`;
}

export const readSessions = new Observers<{
    type: Importable["type"];
    basePath: string;
    observe: (observer: ReadProgressObserver) => void;
}>();

export function createReadProgressSession(
    type: Importable["type"],
    basePath: string
): ReadProgressObserver {
    let paths: string[] = [];
    let activeIndex: number | null = null;
    const observers: ReadProgressObserver[] = [];
    readSessions.emit({
        type,
        basePath,
        observe: (observer) => observers.push(observer),
    });
    const eventHandler = (label: string | null): SyncEventHandler => {
        const handlers = observers.map((observer) =>
            label === null ? observer.events : observer.eventsForList(label)
        );
        return {
            emit(event) {
                if (
                    activeIndex === null ||
                    activeIndex < 0 ||
                    activeIndex >= paths.length
                )
                    return;
                for (const handler of handlers) handler.emit(event);
                if (event.kind === "readStarted" && event.listPath.parts.length === 0) {
                    setActiveTaskListLabel(label);
                }
            },
        };
    };
    return {
        events: eventHandler(null),
        eventsForList: eventHandler,
        start(names) {
            paths = names.map((_name, index) => readPreviewPath(basePath, type, index));
            activeIndex = null;
            setActiveTaskListLabel(null);
            for (const observer of observers) observer.start(names);
            if (paths.length > 0) setActiveTaskPath(paths[0]);
        },
        activate(index, reset) {
            if (index < 0 || index >= paths.length) return;
            activeIndex = index;
            for (const observer of observers) observer.activate(index, reset);
            setActiveTaskPath(paths[index]);
        },
        finish(index) {
            if (index < 0 || index >= paths.length) return;
            for (const observer of observers) observer.finish(index);
        },
        fail(index) {
            if (index < 0 || index >= paths.length) return;
            for (const observer of observers) observer.fail(index);
            if (activeIndex === index) setActiveTaskListLabel(null);
        },
        clear() {
            for (const observer of observers) observer.clear();
            paths = [];
            activeIndex = null;
            setActiveTaskListLabel(null);
            setActiveTaskPath(null);
        },
    };
}
