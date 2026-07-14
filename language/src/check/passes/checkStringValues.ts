import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Action, Importable } from "../../types";
import { visitActionTrees } from "../actionTree";

const MAX_CHAT_INPUT_LENGTH = 256;

type StringField = {
    key: string;
    allowEmpty: boolean;
};

const ACTION_STRING_FIELDS: Partial<Record<Action["type"], StringField[]>> = {
    MESSAGE: [{ key: "message", allowEmpty: false }],
    TITLE: [
        { key: "title", allowEmpty: false },
        { key: "subtitle", allowEmpty: true },
    ],
    ACTION_BAR: [{ key: "message", allowEmpty: false }],
    FAIL_PARKOUR: [{ key: "message", allowEmpty: true }],
    CHANGE_VAR: [{ key: "value", allowEmpty: false }],
};

export function checkStringValues(
    gcx: GlobalCtxt,
    importables: Importable[] = gcx.importables,
) {
    visitActionTrees(importables, {
        action: action => checkAction(gcx, action),
    });
}

function checkAction(gcx: GlobalCtxt, action: Action) {
    const fields = ACTION_STRING_FIELDS[action.type];
    if (!fields) return;

    for (const field of fields) {
        const value = (action as Record<string, unknown>)[field.key];
        if (typeof value !== "string") continue;

        const key = field.key as keyof Action;

        if (!field.allowEmpty && value === "") {
            gcx.addDiagnostic(
                Diagnostic.error(
                    `Empty string is not a valid value for this field.`
                ).addPrimarySpan(gcx.spans.getField(action, key))
            );
        }

        if (value.length > MAX_CHAT_INPUT_LENGTH) {
            gcx.addDiagnostic(
                Diagnostic.error(
                    `String length ${value.length} exceeds the maximum of ${MAX_CHAT_INPUT_LENGTH} characters.`
                ).addPrimarySpan(gcx.spans.getField(action, key))
            );
        }
    }
}
