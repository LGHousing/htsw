import {
    FileLoader,
    parseActionsResult,
    SourceMap,
    Span,
    SpanTable,
    types,
} from "htsw";

type InlayHint = {
    label: string;
    span: Span;
};

function hint(label: string, span: Span): InlayHint {
    return { label, span };
}

export class StringFileLoader implements FileLoader {
    src: string;

    constructor(src: string) {
        this.src = src;
    }

    fileExists(_path: string): boolean {
        return true;
    }
    readFile(_path: string): string {
        return this.src;
    }
    getParentPath(_base: string): string {
        return "";
    }
    resolvePath(_base: string, _other: string): string {
        return "";
    }
}

export function provideInlayHints(src: string): InlayHint[] {
    const fileLoader = new StringFileLoader(src);
    const sourceMap = new SourceMap(fileLoader);
    const result = parseActionsResult(sourceMap, "file.htsl");

    return provideInlayHintsForActions(result.value, result.spans);
}

const SKIP_INLAY_FIELDS = new Set(["type", "note"]);

function provideInlayHintsForActions(actions: types.Action[], spans: SpanTable): InlayHint[] {
    const hints: InlayHint[] = [];

    for (const action of actions) {
        // `if` reads cleanly already; just recurse into its branches.
        if (action.type === "CONDITIONAL") {
            hints.push(...provideInlayHintsForConditions(action.conditions ?? [], spans));
            hints.push(...provideInlayHintsForActions(action.ifActions ?? [], spans));
            hints.push(...provideInlayHintsForActions(action.elseActions ?? [], spans));
            continue;
        }
        if (action.type === "RANDOM") {
            hints.push(...provideInlayHintsForActions(action.actions ?? [], spans));
            continue;
        }

        for (const key of Object.keys(action)) {
            if (SKIP_INLAY_FIELDS.has(key)) continue;
            // `holder` shares the keyword span; `function` collides with the keyword.
            if (action.type === "CHANGE_VAR" && key === "holder") continue;
            if (action.type === "FUNCTION" && key === "function") continue;

            const value = (action as any)[key];
            if (value === null || value === undefined) continue;

            const span = getOptionalFieldSpan(spans, action as object, key);
            if (!span) continue;

            hints.push(hint(key, span));
        }
    }

    return hints;
}

const SKIP_INLAY_CONDITION_FIELDS = new Set(["type", "inverted", "note"]);

function provideInlayHintsForConditions(
    conditions: types.Condition[],
    spans: SpanTable,
): InlayHint[] {
    const hints: InlayHint[] = [];

    for (const condition of conditions) {
        for (const key of Object.keys(condition)) {
            if (SKIP_INLAY_CONDITION_FIELDS.has(key)) continue;
            if (condition.type === "COMPARE_VAR" && key === "holder") continue;

            const value = (condition as any)[key];
            if (value === null || value === undefined) continue;

            const span = getOptionalFieldSpan(spans, condition as object, key);
            if (!span) continue;

            hints.push(hint(key, span));
        }
    }

    return hints;
}

function getOptionalFieldSpan(
    spans: SpanTable,
    node: object,
    key: string,
): Span | undefined {
    try {
        return spans.getField(node, key as never);
    } catch {
        return undefined;
    }
}
