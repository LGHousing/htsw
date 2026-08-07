import type { Action } from "htsw/types";

import {
    actionCost,
    actionListCost,
    type DesiredActionEntry,
    type KnownCurrentAction,
} from "../../src/housingSync/actions/diff";
import { actionsEqual } from "../../src/housingSync/actions/comparison";
import type { CurrentActionListEntry } from "../../src/housingSync/actions/diff/types";

export type OptimalityScore = {
    greedyCost: number;
    optimalCost: number | null;
    excess: number | null;
};

export function scoreOptimality(
    current: readonly CurrentActionListEntry[],
    desired: readonly Action[],
    cutoff = 8
): OptimalityScore {
    const greedyCost = actionListCost(
        current.map((entry) => entry.action),
        [...desired]
    );
    const known = current.filter(
        (entry): entry is KnownCurrentAction => entry.action !== null && entry.editable
    );
    const unmatchedCurrent = [...known];
    const unmatchedDesired = desired.map((action, index) => ({ action, index }));
    for (let index = unmatchedDesired.length - 1; index >= 0; index--) {
        const desiredEntry = unmatchedDesired[index];
        let currentIndex = unmatchedCurrent.findIndex(
            (entry) =>
                entry.index === desiredEntry.index &&
                actionsEqual(entry.action, desiredEntry.action)
        );
        if (currentIndex === -1) {
            currentIndex = unmatchedCurrent.findIndex((entry) =>
                actionsEqual(entry.action, desiredEntry.action)
            );
        }
        if (currentIndex !== -1) {
            unmatchedCurrent.splice(currentIndex, 1);
            unmatchedDesired.splice(index, 1);
        }
    }
    const types = new Set([
        ...unmatchedCurrent.map((entry) => entry.action.type),
        ...unmatchedDesired.map((entry) => entry.action.type),
    ]);
    let optimalCost = current.filter(
        (entry) => entry.action === null || !entry.editable
    ).length;

    for (const type of types) {
        const left = unmatchedCurrent.filter((entry) => entry.action.type === type);
        const right = unmatchedDesired.filter((entry) => entry.action.type === type);
        if (left.length > cutoff || right.length > cutoff) {
            return { greedyCost, optimalCost: null, excess: null };
        }
        optimalCost += minimumBucketCost(left, right, current.length);
    }
    return { greedyCost, optimalCost, excess: greedyCost - optimalCost };
}

function minimumBucketCost(
    current: KnownCurrentAction[],
    desired: DesiredActionEntry[],
    listLength: number
): number {
    const memo = new Map<string, number>();
    const visit = (currentIndex: number, usedDesired: number): number => {
        const key = `${currentIndex}:${usedDesired}`;
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        if (currentIndex === current.length) {
            let adds = 0;
            for (let i = 0; i < desired.length; i++) {
                if ((usedDesired & (1 << i)) === 0) adds++;
            }
            return adds;
        }
        let best = 1 + visit(currentIndex + 1, usedDesired);
        for (let i = 0; i < desired.length; i++) {
            if ((usedDesired & (1 << i)) !== 0) continue;
            best = Math.min(
                best,
                actionCost(current[currentIndex], desired[i], listLength) +
                    visit(currentIndex + 1, usedDesired | (1 << i))
            );
        }
        memo.set(key, best);
        return best;
    };
    return visit(0, 0);
}
