import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { describeCharCode, findIllegalChatCharacter } from "../../helpers";
import type { Action, Condition, Importable } from "../../types";
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

/**
 * `type` names the action/condition rather than carrying a user-authored
 * value, so it never reaches Housing's input prompt and is skipped by the
 * chat-safety sweep below.
 */
const NON_VALUE_KEYS = new Set(["type"]);

export function checkStringValues(
    gcx: GlobalCtxt,
    importables: Importable[] = gcx.importables,
) {
    visitActionTrees(importables, {
        action: action => {
            checkAction(gcx, action);
            checkChatSafety(gcx, action);
        },
        conditions: conditions => {
            for (const condition of conditions) checkChatSafety(gcx, condition);
        },
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

/**
 * Every string HTSW writes into a Housing field travels as a chat payload, and
 * the server disconnects the player with "Illegal characters in chat" the
 * moment one carries a character the vanilla chat box would have filtered out.
 * A kick mid-import abandons the remaining rows, so reject the value here —
 * before anything is written — instead of discovering it on the server.
 */
function checkChatSafety(gcx: GlobalCtxt, node: Action | Condition) {
    for (const key of Object.keys(node) as (keyof typeof node)[]) {
        if (NON_VALUE_KEYS.has(key as string)) continue;
        const value = (node as Record<string, unknown>)[key as string];
        if (typeof value !== "string") continue;

        const illegal = findIllegalChatCharacter(value);
        if (illegal === null) continue;

        const span = gcx.spans.tryGetField(node, key) ?? gcx.spans.get(node);
        gcx.addDiagnostic(
            Diagnostic.error(
                `Value contains ${describeCharCode(illegal.code)} at index ` +
                    `${illegal.index}, which Minecraft's chat cannot carry. ` +
                    `Housing rejects the whole message and disconnects you with ` +
                    `"Illegal characters in chat".`
            ).addPrimarySpan(span)
        );
    }
}
