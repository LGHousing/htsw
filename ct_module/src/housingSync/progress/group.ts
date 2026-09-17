import type { SyncEventHandler } from "../syncEvents";
import type {
    PhaseUnits,
    ProgressHandler,
    ProgressPayload,
    ProgressPhase,
} from "./types";

export type ProgressGroup = {
    part(index: number): ProgressHandler;
    /**
     * Book the navigation that reached a part's action list. A part's own
     * progress only covers work inside its list, so a menu that opens every
     * slot would otherwise show no progress until the scan ended. The first
     * visit to a part is its scan; a later visit is its hydrate reopen.
     */
    visited(index: number, units: number): void;
};

type PartVisits = { reading: number; hydrating: number };

export function createProgressGroup(
    events: SyncEventHandler | undefined,
    partCount: number
): ProgressGroup {
    const parts: Array<ProgressPayload | undefined> = [];
    const visits: Array<PartVisits | undefined> = [];

    function emit(phase: ProgressPhase, sync: ProgressPayload["sync"]): void {
        if (events === undefined) return;

        const phaseUnits: PhaseUnits = {
            setup: 0,
            reading: 0,
            hydrating: 0,
            applying: 0,
        };
        let completedUnits = 0;
        for (let i = 0; i < partCount; i++) {
            const visit = visits[i];
            if (visit !== undefined) {
                phaseUnits.reading += visit.reading;
                phaseUnits.hydrating += visit.hydrating;
                completedUnits += visit.reading + visit.hydrating;
            }
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
                phase,
                completedUnits,
                totalUnits: phaseUnits.reading + phaseUnits.hydrating,
                phaseUnits,
                sync,
            },
        });
    }

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
                emit(payload.phase, payload.sync);
            };
        },
        visited(index, units) {
            const visit = visits[index];
            const phase: ProgressPhase = visit === undefined ? "reading" : "hydrating";
            if (visit === undefined) {
                visits[index] = { reading: units, hydrating: 0 };
            } else {
                visit.hydrating += units;
            }
            emit(
                phase,
                parts[index]?.sync ?? { completedUnits: 0, totalUnits: 0, parent: null }
            );
        },
    };
}
