import type { SyncEventHandler } from "../syncEvents";
import type { PhaseUnits, ProgressHandler, ProgressPayload } from "./types";

export type ProgressGroup = {
    part(index: number): ProgressHandler;
};

export function createProgressGroup(
    events: SyncEventHandler | undefined,
    partCount: number
): ProgressGroup {
    const parts: Array<ProgressPayload | undefined> = [];

    return {
        part(index) {
            return (payload) => {
                parts[index] = {
                    ...payload,
                    phaseUnits: { ...payload.phaseUnits },
                    sync: {
                        ...payload.sync,
                        parent:
                            payload.sync.parent === null
                                ? null
                                : { ...payload.sync.parent },
                    },
                };
                if (events === undefined) return;

                const phaseUnits: PhaseUnits = {
                    setup: 0,
                    reading: 0,
                    hydrating: 0,
                    applying: 0,
                };
                let completedUnits = 0;
                for (let i = 0; i < partCount; i++) {
                    const part = parts[i];
                    if (part === undefined) continue;
                    phaseUnits.reading += part.phaseUnits.setup + part.phaseUnits.reading;
                    phaseUnits.hydrating += part.phaseUnits.hydrating;
                    completedUnits += Math.max(0, part.completedUnits);
                }

                events.emit({
                    kind: "progress",
                    scope: { kind: "topLevel" },
                    progress: {
                        phase: payload.phase,
                        completedUnits,
                        totalUnits: phaseUnits.reading + phaseUnits.hydrating,
                        phaseUnits,
                        sync: payload.sync,
                    },
                });
            };
        },
    };
}
