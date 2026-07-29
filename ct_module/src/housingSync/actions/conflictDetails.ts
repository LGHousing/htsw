import type { Action, Condition } from "htsw/types";

import { getActionScalarLoreFields, getChildListFields } from "../fields/actionMappings";
import { getConditionScalarLoreFields } from "../fields/conditionMappings";
import { noteCompareKey, scalarFieldCompareKey } from "./comparison";
import type { ItemFieldContent } from "../items/fieldContent";

export type ActionListConflictDifference = {
    path: string;
    live: string;
    source: string;
};

export type ActionListConflictDetails = {
    differences: ActionListConflictDifference[];
    moreCount: number;
};

const MAX_DIFFERENCES = 5;
const MAX_VALUE_LENGTH = 48;

type DifferenceCollector = {
    differences: ActionListConflictDifference[];
    liveItemContent?: ItemFieldContent;
    sourceItemContent?: ItemFieldContent;
};

function actionLabel(index: number, type: string): string {
    return `action ${index + 1} (${type.toLowerCase().replace(/_/g, " ")})`;
}

function conditionLabel(index: number, type: string): string {
    return `condition ${index + 1} (${type.toLowerCase().replace(/_/g, " ")})`;
}

function compact(value: string | undefined): string {
    if (value === undefined) return "<unset>";
    if (value.length <= MAX_VALUE_LENGTH) return value;
    return `${value.substring(0, MAX_VALUE_LENGTH - 1)}…`;
}

function addDifference(
    collector: DifferenceCollector,
    path: string,
    live: string | undefined,
    source: string | undefined
): void {
    collector.differences.push({
        path,
        live: live ?? "<unset>",
        source: source ?? "<unset>",
    });
}

function compareScalarFields(
    collector: DifferenceCollector,
    path: string,
    type: string,
    live: Record<string, unknown>,
    source: Record<string, unknown>,
    fields: readonly { prop: string; kind?: string }[]
): void {
    for (const field of fields) {
        if (field.kind === "item") {
            const liveItem = collector.liveItemContent?.(
                live as unknown as Action | Condition,
                field.prop
            );
            const sourceItem = collector.sourceItemContent?.(
                source as unknown as Action | Condition,
                field.prop
            );
            if (liveItem !== sourceItem) {
                addDifference(
                    collector,
                    `${path} · ${field.prop}`,
                    "<item>",
                    "<item>"
                );
            }
            continue;
        }
        const liveKey = scalarFieldCompareKey(type, field.prop, live[field.prop]);
        const sourceKey = scalarFieldCompareKey(type, field.prop, source[field.prop]);
        if (liveKey !== sourceKey) {
            addDifference(collector, `${path} · ${field.prop}`, liveKey, sourceKey);
        }
    }
    const liveNote = noteCompareKey(
        typeof live.note === "string" ? live.note : undefined
    );
    const sourceNote = noteCompareKey(
        typeof source.note === "string" ? source.note : undefined
    );
    if (liveNote !== sourceNote) {
        addDifference(collector, `${path} · note`, liveNote, sourceNote);
    }
}

function compareChildActions(
    collector: DifferenceCollector,
    path: string,
    live: readonly Action[],
    source: readonly Action[]
): void {
    compareChildEntries(collector, path, live, source, compareChildAction, actionLabel);
}

function compareChildConditions(
    collector: DifferenceCollector,
    path: string,
    live: readonly Condition[],
    source: readonly Condition[]
): void {
    compareChildEntries(collector, path, live, source, compareCondition, conditionLabel);
}

function childCount(count: number): string {
    return `<${count} ${count === 1 ? "child" : "children"}>`;
}

function compareChildEntries<T extends { type: string }>(
    collector: DifferenceCollector,
    path: string,
    live: readonly T[],
    source: readonly T[],
    compare: (collector: DifferenceCollector, path: string, live: T, source: T) => void,
    label: (index: number, type: string) => string
): void {
    if (live.length !== source.length) {
        addDifference(
            collector,
            path,
            childCount(live.length),
            childCount(source.length)
        );
    }
    const shared = Math.min(live.length, source.length);
    compareEntries(
        collector,
        path,
        live.slice(0, shared),
        source.slice(0, shared),
        compare,
        label
    );
}

function compareEntries<T extends { type: string }>(
    collector: DifferenceCollector,
    path: string,
    live: readonly T[],
    source: readonly T[],
    compare: (collector: DifferenceCollector, path: string, live: T, source: T) => void,
    label: (index: number, type: string) => string
): void {
    const shared = Math.min(live.length, source.length);
    for (let i = 0; i < shared; i++) {
        const entryPath =
            path === "" ? label(i, live[i].type) : `${path} · ${label(i, live[i].type)}`;
        if (live[i].type !== source[i].type) {
            addDifference(collector, `${entryPath} · type`, live[i].type, source[i].type);
        } else {
            compare(collector, entryPath, live[i], source[i]);
        }
    }
    for (let i = shared; i < live.length; i++) {
        const entryPath =
            path === "" ? label(i, live[i].type) : `${path} · ${label(i, live[i].type)}`;
        addDifference(collector, entryPath, `<${live[i].type.toLowerCase()}>`, undefined);
    }
    for (let i = shared; i < source.length; i++) {
        const entryPath =
            path === ""
                ? label(i, source[i].type)
                : `${path} · ${label(i, source[i].type)}`;
        addDifference(
            collector,
            entryPath,
            undefined,
            `<${source[i].type.toLowerCase()}>`
        );
    }
}

function compareAction(
    collector: DifferenceCollector,
    path: string,
    live: Action,
    source: Action
): void {
    compareActionFields(collector, path, live, source, true);
}

function compareChildAction(
    collector: DifferenceCollector,
    path: string,
    live: Action,
    source: Action
): void {
    compareActionFields(collector, path, live, source, false);
}

function compareActionFields(
    collector: DifferenceCollector,
    path: string,
    live: Action,
    source: Action,
    includeChildLists: boolean
): void {
    const liveValue = live as unknown as Record<string, unknown>;
    const sourceValue = source as unknown as Record<string, unknown>;
    compareScalarFields(
        collector,
        path,
        live.type,
        liveValue,
        sourceValue,
        getActionScalarLoreFields(live.type)
    );
    if (!includeChildLists) return;
    for (const field of getChildListFields(live.type)) {
        const liveChildren = Array.isArray(liveValue[field.prop])
            ? liveValue[field.prop]
            : [];
        const sourceChildren = Array.isArray(sourceValue[field.prop])
            ? sourceValue[field.prop]
            : [];
        const childPath = `${path} · ${field.prop}`;
        if (field.kind === "conditionList") {
            compareChildConditions(
                collector,
                childPath,
                liveChildren as Condition[],
                sourceChildren as Condition[]
            );
        } else {
            compareChildActions(
                collector,
                childPath,
                liveChildren as Action[],
                sourceChildren as Action[]
            );
        }
    }
}

function compareCondition(
    collector: DifferenceCollector,
    path: string,
    live: Condition,
    source: Condition
): void {
    const liveValue = live as unknown as Record<string, unknown>;
    const sourceValue = source as unknown as Record<string, unknown>;
    compareScalarFields(
        collector,
        path,
        live.type,
        liveValue,
        sourceValue,
        getConditionScalarLoreFields(live.type)
    );
    if (live.inverted !== source.inverted) {
        addDifference(
            collector,
            `${path} · inverted`,
            live.inverted === undefined ? undefined : String(live.inverted),
            source.inverted === undefined ? undefined : String(source.inverted)
        );
    }
}

export function actionListConflictDetails(
    live: readonly Action[],
    source: readonly Action[],
    liveItemContent?: ItemFieldContent,
    sourceItemContent?: ItemFieldContent
): ActionListConflictDetails {
    const collector = collectActionListConflictDifferences(
        live,
        source,
        liveItemContent,
        sourceItemContent
    );
    return summarizeActionListConflictDifferences(collector.differences);
}

export function summarizeActionListConflictDifferences(
    differences: readonly ActionListConflictDifference[]
): ActionListConflictDetails {
    return {
        differences: differences.slice(0, MAX_DIFFERENCES).map((difference) => ({
            path: difference.path,
            live: compact(difference.live),
            source: compact(difference.source),
        })),
        moreCount: Math.max(0, differences.length - MAX_DIFFERENCES),
    };
}

export function actionListConflictDifferences(
    live: readonly Action[],
    source: readonly Action[],
    liveItemContent?: ItemFieldContent,
    sourceItemContent?: ItemFieldContent
): ActionListConflictDifference[] {
    return collectActionListConflictDifferences(
        live,
        source,
        liveItemContent,
        sourceItemContent
    ).differences;
}

function collectActionListConflictDifferences(
    live: readonly Action[],
    source: readonly Action[],
    liveItemContent?: ItemFieldContent,
    sourceItemContent?: ItemFieldContent
): DifferenceCollector {
    const collector: DifferenceCollector = {
        differences: [],
        liveItemContent,
        sourceItemContent,
    };
    compareEntries(collector, "", live, source, compareAction, actionLabel);
    return collector;
}
