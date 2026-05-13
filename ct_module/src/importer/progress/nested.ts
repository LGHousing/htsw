import type { ActionListPhaseBudget } from "./costs";
import type { ActionListProgressSink } from "./types";

export type ApplyProgressAdapter = {
    emitOuter(label: string, unitCompleted: number, appliedBudget: number): void;
    nestedSink(): ActionListProgressSink | undefined;
    getAppliedBudget(): number;
};

export function createApplyProgressAdapter(args: {
    phaseBudget: ActionListPhaseBudget;
    baseline: number;
    unitTotal: number;
    sink?: ActionListProgressSink;
}): ApplyProgressAdapter {
    let appliedBudget = 0;

    const growApplyPart = (applied: number): void => {
        if (applied > args.phaseBudget.applyPart) {
            args.phaseBudget.applyPart = applied;
            args.phaseBudget.total = recomputeTotal(args.phaseBudget);
        }
    };

    const emitParent = (
        label: string,
        unitCompleted: number,
        unitTotal: number,
        applied: number
    ): void => {
        appliedBudget = Math.max(appliedBudget, applied);
        growApplyPart(appliedBudget);
        args.sink?.({
            phase: "applying",
            phaseLabel: label,
            unitCompleted,
            unitTotal,
            estimatedCompleted: args.baseline + appliedBudget,
            estimatedTotal: args.phaseBudget.total,
            etaConfidence: "planned",
            phaseBudget: args.phaseBudget,
        });
    };

    return {
        emitOuter(label, unitCompleted, applied): void {
            emitParent(label, unitCompleted, args.unitTotal, applied);
        },
        nestedSink(): ActionListProgressSink | undefined {
            if (args.sink === undefined) return undefined;
            const nestedStart = appliedBudget;
            return (inner) => {
                const nestedCompleted = Math.max(0, inner.estimatedCompleted);
                emitParent(
                    inner.phaseLabel,
                    inner.unitCompleted,
                    inner.unitTotal,
                    nestedStart + nestedCompleted
                );
            };
        },
        getAppliedBudget(): number {
            return appliedBudget;
        },
    };
}

function recomputeTotal(b: ActionListPhaseBudget): number {
    return b.readPart + b.hydratePart + b.applyPart;
}
