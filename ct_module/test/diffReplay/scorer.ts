import type {
    ActionListDiff,
    ActionListOperation,
} from "../../src/housingSync/actions/diff/types";
import { actionCompareKey } from "../../src/housingSync/actions/comparison";

type OperationCounts = Record<ActionListOperation["kind"], number>;

export type DiffScore = {
    operations: OperationCounts;
    churn: number;
};

export function scoreDiff(diff: ActionListDiff): DiffScore {
    const operations = emptyOperationCounts();
    const deleted = new Map<string, number>();
    const added = new Map<string, number>();

    for (const operation of diff.operations) {
        operations[operation.kind]++;
        if (operation.kind === "delete" && operation.baselineAction !== null) {
            increment(deleted, actionCompareKey(operation.baselineAction));
        } else if (operation.kind === "add") {
            increment(added, actionCompareKey(operation.desired));
        }
    }

    let churn = 0;
    for (const [action, deleteCount] of deleted) {
        churn += Math.min(deleteCount, added.get(action) ?? 0);
    }
    return { operations, churn };
}

export function aggregateScores(scores: readonly DiffScore[]): DiffScore {
    const aggregate: DiffScore = { operations: emptyOperationCounts(), churn: 0 };
    for (const score of scores) {
        aggregate.operations.add += score.operations.add;
        aggregate.operations.delete += score.operations.delete;
        aggregate.operations.edit += score.operations.edit;
        aggregate.operations.move += score.operations.move;
        aggregate.churn += score.churn;
    }
    return aggregate;
}

function emptyOperationCounts(): OperationCounts {
    return { add: 0, delete: 0, edit: 0, move: 0 };
}

function increment(counts: Map<string, number>, key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1);
}
