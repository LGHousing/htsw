import type { ActionListPhaseUnits } from "./costs";
import { phaseUnitsFromParts } from "./costs";
import type { ActionListProgressHandler } from "./types";

export type ApplyProgressAdapter = {
    emitOuter(label: string, unitCompleted: number, appliedUnits: number): void;
    nestedHandler(parent?: {
        label: string;
        unitCompleted: number;
        unitTotal: number;
    }): ActionListProgressHandler | undefined;
    getAppliedUnits(): number;
};

export function createApplyProgressAdapter(args: {
    phaseUnits: ActionListPhaseUnits;
    baseline: number;
    unitTotal: number;
    handler?: ActionListProgressHandler;
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
        args.handler?.({
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
            // Forward-project the apply budget from observed per-op
            // cost so the bar reflects "more ops left at the rate I'm
            // running." Without this, `growApplyPart` only floors at
            // `applied`, so once actual cost exceeds the initial
            // estimate the bar pegs at 100% for every remaining op
            // (and ETA collapses to 0). `unitCompleted` here is the
            // outer ops completed before this emit (callers pass it
            // pre-increment), and `args.unitTotal` is the outer op
            // count, so the ratio is a real "observed rate × remaining
            // work" projection.
            if (
                unitCompleted > 0 &&
                unitCompleted < args.unitTotal &&
                applied > 0
            ) {
                const projected = (applied * args.unitTotal) / unitCompleted;
                if (projected > args.phaseUnits.applyPart) {
                    args.phaseUnits.applyPart = projected;
                    args.phaseUnits.total = recomputeTotal(args.phaseUnits);
                }
            }
            emitParent(label, unitCompleted, args.unitTotal, applied);
        },
        nestedHandler(parent): ActionListProgressHandler | undefined {
            if (args.handler === undefined) return undefined;
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
