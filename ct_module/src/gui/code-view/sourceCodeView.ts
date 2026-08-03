/// <reference types="../../../CTAutocomplete" />

import * as htsw from "htsw";

import { CodeView } from "./codeView";
import { ROW_BG_BY_STATE } from "./diffPalette";
import {
    ensureSourceDiff,
    getSourceDiffRevision,
    type SourceDiffGhost,
} from "./sourceDiff";
import type { Element } from "../lib/layout";
import { extract, type Extractable } from "../lib/extractable";
import type { LineDecorations, LineDecorator, RenderableLine } from "./lineTypes";
import { ActionPath } from "../../housingSync/actionPath";
import { tokenizeHtsl } from "../right-panel/syntax";

export type SourceCodeViewProps = {
    source: Extractable<string | null>;
    sourceImportJsonPath?: Extractable<string | null>;
    onOpenPath?: (path: string, options: { activate: boolean }) => void;
    emptyMessage?: Extractable<string>;
};

export function SourceCodeView(props: SourceCodeViewProps): Element {
    return CodeView({
        scrollId: "right-source-scroll",
        source: props.source,
        sourceImportJsonPath: props.sourceImportJsonPath,
        lineDecorator: () =>
            sourceDiffDecorator(
                extract(props.source),
                props.sourceImportJsonPath === undefined
                    ? null
                    : extract(props.sourceImportJsonPath)
            ),
        onOpenPath: props.onOpenPath,
        emptyMessage: props.emptyMessage,
    });
}

function sourceDiffDecorator(
    path: string | null,
    importJsonPath: string | null
): LineDecorator {
    function ghostRows(ghosts: readonly SourceDiffGhost[]) {
        const rows: { line: RenderableLine; decorations: LineDecorations }[] = [];
        for (let i = 0; i < ghosts.length; i++) {
            let printed: string;
            try {
                printed = htsw.htsl.printAction(ghosts[i].action);
            } catch (_e) {
                printed = `${ghosts[i].action.type.toLowerCase()} ...`;
            }
            let printedLines = printed.split("\n");
            if (ghosts[i].headOnly) printedLines = printedLines.slice(0, 1);
            let indent = "";
            for (let depth = 0; depth < ghosts[i].depth; depth++) indent += "    ";
            for (let j = 0; j < printedLines.length; j++) {
                if (printedLines[j] === "" && j === printedLines.length - 1) continue;
                rows.push({
                    line: {
                        id: `static-ghost:${ghosts[i].id}:${j}`,
                        lineNum: 0,
                        depth: ghosts[i].depth,
                        tokens: tokenizeHtsl(indent + printedLines[j]),
                    },
                    decorations: {
                        state: "delete",
                        background:
                            ROW_BG_BY_STATE[
                                ghosts[i].role === "edit" ? "edit" : "delete"
                            ],
                        foregroundColor: 0xff444444 | 0,
                        hideLineNum: true,
                    },
                });
            }
        }
        return rows;
    }

    return {
        decorateLine(line: RenderableLine): LineDecorations {
            if (path === null) return {};
            const overlay = ensureSourceDiff(path, importJsonPath);
            if (overlay === undefined) return {};
            const before = overlay.ghostsBeforeLine.get(line.lineNum);
            const extraLinesBefore = before === undefined ? undefined : ghostRows(before);
            if (line.actionPath?.kind !== "action") return { extraLinesBefore };
            const actionPathKeyValue = ActionPath.key(line.actionPath);
            const state = overlay.states.get(actionPathKeyValue);
            if (state === undefined) return { extraLinesBefore };
            const itemHint = !overlay.changedItems.has(actionPathKeyValue)
                ? {}
                : { hoverLines: () => ["&eReferenced item changed"] };
            if (state === "edit") {
                if (overlay.itemOnlyChanges.has(actionPathKeyValue)) {
                    if (line.id !== `htsl:${actionPathKeyValue}`) {
                        return { extraLinesBefore };
                    }
                    return { state: "edit", extraLinesBefore, ...itemHint };
                }
                if (line.id !== `htsl:${actionPathKeyValue}`) return { extraLinesBefore };
                return {
                    state: "add",
                    background: ROW_BG_BY_STATE.edit,
                    extraLinesBefore,
                    ...itemHint,
                };
            }
            return { state, extraLinesBefore };
        },
        focusedLineId(): string | null {
            return null;
        },
        extraLinesAtEnd() {
            if (path === null) return [];
            const overlay = ensureSourceDiff(path, importJsonPath);
            return overlay === undefined ? [] : ghostRows(overlay.ghostsAtEnd);
        },
        modelKey(): string | null {
            if (path === null) return "diff:none";
            return `diff:${path}\n${importJsonPath ?? ""}\n${getSourceDiffRevision()}`;
        },
    };
}
