import type { ActionListPhaseUnits } from "./costs";
import { phaseUnitsFromParts } from "./costs";
import type { ActionListProgressSink } from "./types";

export type ApplyProgressAdapter = {
    emitOuter(label: string, unitCompleted: number, appliedUnits: number): void;
    nestedSink(parent?: {
        label: string;
        unitCompleted: number;
        unitTotal: number;
    }): ActionListProgressSink | undefined;
    getAppliedUnits(): number;
};

export function createApplyProgressAdapter(args: {
    phaseUnits: ActionListPhaseUnits;
    baseline: number;
    unitTotal: number;
    sink?: ActionListProgressSink;
}): ApplyProgressAdapter {
    let appliedUnits = 0;

    const growApplyPart = (applied: number): void => {
        if (applied > args.phaseUnits.applyPart) {
            args.phaseUnits.applyPart = applied;
            args.phaseUnits.total = recomputeTotal(args.phaseUnits);
        }
    };

    const emitParent = (
        label: string,
        unitCompleted: number,
        unitTotal: number,
        applied: number,
        parent?: {
            label: string;
            unitCompleted: number;
            unitTotal: number;
        }
    ): void => {
        appliedUnits = Math.max(appliedUnits, applied);
        growApplyPart(appliedUnits);
        args.sink?.({
            phase: "applying",
            phaseLabel: label,
            unitCompleted,
            unitTotal,
            parentUnitCompleted: parent?.unitCompleted,
            parentUnitTotal: parent?.unitTotal,
            parentPhaseLabel: parent?.label,
            completedUnits: args.baseline + appliedUnits,
            totalUnits: args.phaseUnits.total,
            phaseUnits: phaseUnitsFromParts(args.phaseUnits),
        });
    };

    return {
        emitOuter(label, unitCompleted, applied): void {
            emitParent(label, unitCompleted, args.unitTotal, applied);
        },
        nestedSink(parent): ActionListProgressSink | undefined {
            if (args.sink === undefined) return undefined;
            const nestedStart = appliedUnits;
            return (inner) => {
                const nestedCompleted = Math.max(0, inner.completedUnits);
                emitParent(
                    inner.phaseLabel,
                    inner.unitCompleted,
                    inner.unitTotal,
                    nestedStart + nestedCompleted,
                    parent
                );
            };
        },
        getAppliedUnits(): number {
            return appliedUnits;
        },
    };
}

function recomputeTotal(b: ActionListPhaseUnits): number {
    return b.readPart + b.hydratePart + b.applyPart;
}
