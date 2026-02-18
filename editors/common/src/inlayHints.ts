import { FileLoader, parseIrActions, SourceMap, Span } from "htsw";
import { IrAction, IrCondition, irKeys } from "htsw/ir";

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

    fileExists(path: string): boolean {
        return true;
    }
    readFile(path: string): string {
        return this.src;
    }
    getParentPath(base: string): string {
        return "";
    }
    resolvePath(base: string, other: string): string {
        return "";
    }
}

export function provideInlayHints(src: string): InlayHint[] {
    const fileLoader = new StringFileLoader(src);
    const sourceMap = new SourceMap(fileLoader);
    const actions = parseIrActions(sourceMap, "file.htsl");

    const hints: InlayHint[] = [];

    hints.push(...provideInlayHintsForActions(actions.value));

    return hints;
}

function provideInlayHintsForActions(actions: IrAction[]): InlayHint[] {
    const hints: InlayHint[] = [];

    for (const action of actions) {
        if (action.type === "CONDITIONAL") {
            hints.push(...provideInlayHintsForConditions(action.conditions?.value ?? []));

            hints.push(...provideInlayHintsForActions(action.ifActions?.value ?? []));
            hints.push(...provideInlayHintsForActions(action.elseActions?.value ?? []));
        } else if (action.type === "RANDOM") {
            hints.push(...provideInlayHintsForActions(action.actions?.value ?? []));
        }

        if (
            action.type === "CHANGE_VAR" ||
            action.type === "CONDITIONAL" ||
            action.type === "RANDOM"
        )
            continue; // don't provide hints for these

        for (const key of irKeys(action)) {
            if (key === "function") continue; // skip these
            if (key === "note") continue; // skip these

            // @ts-ignore
            const element: { value: any; span: Span } = action[key];

            // this element was skipped on purpose
            if (element.value === null) continue;

            if (element.value === undefined) break;

            hints.push(hint(key, element.span));
        }
    }

    return hints;
}

function provideInlayHintsForConditions(conditions: IrCondition[]): InlayHint[] {
    const hints: InlayHint[] = [];

    for (const condition of conditions) {
        if (condition.type === "COMPARE_VAR" || condition.type === "COMPARE_PLACEHOLDER")
            continue; // don't provide hints for these

        for (const key of irKeys(condition)) {
            if (key === "inverted") continue; // skip these
            if (key === "note") continue; // skip these

            // @ts-ignore
            const element: { value: any; span: htsl.Span } = condition[key];

            // this element was skipped on purpose
            if (element.value === null) continue;

            if (element.value === undefined) break;

            hints.push(hint(key, element.span));
        }
    }

    return hints;
}
