import type { ParsedTestFixture } from "./fixtures";
import {
    allActionTypes,
    allConditionTypes,
    allImplementedImportableTypes,
    createCoverage,
    collectImportablesCoverage,
    uncovered,
    type SuiteCoverage,
} from "./coverage";

type Display = (message: string) => void;

export function coverageForFixtures(
    fixtures: readonly ParsedTestFixture[]
): SuiteCoverage {
    const coverage = createCoverage();
    for (let i = 0; i < fixtures.length; i++) {
        collectImportablesCoverage(coverage, fixtures[i].parsed.value);
    }
    return coverage;
}

export function emitCoverageReport(
    display: Display,
    coverage: SuiteCoverage,
    fixtureCount: number
): void {
    display(`&7[htsw test] fixtures: &f${fixtureCount}`);
    emitCoverageLine(
        display,
        "importables",
        allImplementedImportableTypes(),
        coverage.importableTypes
    );
    emitCoverageLine(display, "actions", allActionTypes(), coverage.actionTypes);
    emitCoverageLine(display, "conditions", allConditionTypes(), coverage.conditionTypes);
}

function emitCoverageLine(
    display: Display,
    label: string,
    all: string[],
    covered: Set<string>
): void {
    const missing = uncovered(all, covered);
    display(
        `&7[htsw test] ${label}: &f${all.length - missing.length}/${all.length}` +
            (missing.length === 0 ? " &aall covered" : "")
    );
    if (missing.length > 0) {
        emitWrapped(display, `&7[htsw test] uncovered ${label}: &e`, missing);
    }
}

function emitWrapped(display: Display, prefix: string, values: readonly string[]): void {
    let line = prefix;
    for (let i = 0; i < values.length; i++) {
        const next = (line === prefix ? "" : ", ") + values[i];
        if (line.length + next.length > 180) {
            display(line);
            line = prefix + values[i];
        } else {
            line += next;
        }
    }
    if (line !== prefix) display(line);
}
