import { diffActionList } from "../../src/housingSync/actions/diff";
import type { ActionListDiff } from "../../src/housingSync/actions/diff/types";
import type { DiffInputCapture } from "./loader";
import { aggregateScores, scoreDiff, type DiffScore } from "./scorer";
import { actionListsEqual, applyPlan } from "./oracle";
import { scoreOptimality, type OptimalityScore } from "./optimal";

type DiffReplayResult = {
    capture: DiffInputCapture;
    diff: ActionListDiff;
    score: DiffScore;
    oraclePassed: boolean;
    optimality: OptimalityScore;
};

export type DiffReplayReport = {
    records: DiffReplayResult[];
    aggregate: DiffScore;
    oraclePasses: number;
    optimality: {
        compared: number;
        skipped: number;
        totalExcess: number;
        worstExcess: number;
    };
};

export function replayDiffCaptures(
    captures: readonly DiffInputCapture[]
): DiffReplayReport {
    const records = captures.map((capture) => {
        const diff = diffActionList(capture.current, capture.desired);
        return {
            capture,
            diff,
            score: scoreDiff(diff),
            oraclePassed: actionListsEqual(
                applyPlan(capture.current, diff.operations),
                capture.desired
            ),
            optimality: scoreOptimality(capture.current, capture.desired),
        };
    });
    const compared = records.filter((record) => record.optimality.excess !== null);
    return {
        records,
        aggregate: aggregateScores(records.map((record) => record.score)),
        oraclePasses: records.filter((record) => record.oraclePassed).length,
        optimality: {
            compared: compared.length,
            skipped: records.length - compared.length,
            totalExcess: compared.reduce(
                (sum, record) => sum + record.optimality.excess!,
                0
            ),
            worstExcess: compared.reduce(
                (worst, record) => Math.max(worst, record.optimality.excess!),
                0
            ),
        },
    };
}
