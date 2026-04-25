import * as vscode from "vscode";
import * as htsw from "htsw";

type CompletionKind =
    | "action"
    | "condition"
    | "constant"
    | "operator"
    | "placeholder"
    | "sound"
    | "snippet";

// Overrides for actions whose snippet has syntactic quirks the spec format
// can't express. Everything else is auto-generated from `ACTION_SPECS` via
// `generateActionSnippet`, so adding a new action doesn't require touching
// this table.
//
// `if` needs the `(...)` paren block and the `{...}` body — the spec format
// just lists fields, it doesn't know about the surrounding syntax.
// `tp` defaults to `custom_coordinates` mode because that's the form 99% of
// users want; otherwise the snippet expands to a tab stop where the user
// would have to remember to type `custom_coordinates` first.
const ACTION_SNIPPETS: Record<string, string> = {
    if: "if ${1|and,or,true,false|} (${2}) {\n\t${3}\n}",
    tp: "tp custom_coordinates \"${1}\"",
};

// --- completions ---

export class CompletionAdapter implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        if (document.languageId !== "htsl") return [];

        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const range = this.getReplacementRange(document, position);
        const documentPrefix = document.getText(
            new vscode.Range(new vscode.Position(0, 0), position)
        );
        const completions = provideHtslCompletions(
            linePrefix,
            documentPrefix,
            this.getTypedPrefix(document, range, position)
        );

        return completions.map((completion) => {
            const item = new vscode.CompletionItem(
                completion.label,
                this.toVscodeCompletionKind(completion.kind)
            );
            item.detail = completion.detail;
            item.range = range;
            item.insertText = completion.snippet
                ? new vscode.SnippetString(completion.insertText)
                : completion.insertText;
            if (completion.filterText) item.filterText = completion.filterText;
            if (completion.sortText) item.sortText = completion.sortText;
            return item;
        });
    }

    private getReplacementRange(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Range | undefined {
        return document.getWordRangeAtPosition(position, /[%\w./-]+/);
    }

    private getTypedPrefix(
        document: vscode.TextDocument,
        range: vscode.Range | undefined,
        position: vscode.Position
    ): string {
        if (!range) return "";
        // Only consider text from the start of the replacement range up to the
        // cursor — using the full range text would include characters after the
        // caret (e.g. when the cursor is inside an existing `%player.trig%`),
        // which makes the prefix never match any completion.
        const prefixRange = new vscode.Range(range.start, position);
        return document.getText(prefixRange).replace(/^%/, "").toLowerCase();
    }

    private toVscodeCompletionKind(kind: CompletionKind): vscode.CompletionItemKind {
        switch (kind) {
            case "action":
                return vscode.CompletionItemKind.Function;
            case "condition":
                return vscode.CompletionItemKind.Event;
            case "operator":
                return vscode.CompletionItemKind.Operator;
            case "placeholder":
                return vscode.CompletionItemKind.Variable;
            case "sound":
                return vscode.CompletionItemKind.Value;
            case "snippet":
                return vscode.CompletionItemKind.Snippet;
            case "constant":
                return vscode.CompletionItemKind.Constant;
        }
    }
}

export function provideHtslCompletions(
    linePrefix: string,
    documentPrefix: string,
    typedPrefix: string,
): CompletionSpec[] {
    const provider = new HtslCompletionProvider();
    return provider.complete(linePrefix, documentPrefix, typedPrefix);
}

class HtslCompletionProvider {
    complete(linePrefix: string, documentPrefix: string, typedPrefix: string): CompletionSpec[] {
        return this.filterCompletions(
            this.completeForContext(linePrefix, documentPrefix),
            typedPrefix,
        );
    }

    private completeForContext(linePrefix: string, documentPrefix: string): CompletionSpec[] {
        const conditionPrefix = getOpenIfConditionPrefix(documentPrefix);
        const completionPrefix = conditionPrefix ?? linePrefix;
        const tokens = tokenize(completionPrefix);
        const trimmed = linePrefix.trimStart();
        const lastToken = last(tokens)?.text ?? "";
        const firstToken = tokens[0]?.text ?? "";
        const quoteMode = getQuoteMode(last(tokens));
        const hasTrailingWhitespace = /\s$/.test(linePrefix);

        if (this.isPlaceholderContext(linePrefix, lastToken)) {
            return placeholderCompletions();
        }

        if (/^\s*if\s+\w*$/i.test(linePrefix)) {
            return ifModeCompletions();
        }

        if (conditionPrefix !== undefined) {
            if (isConditionStartContext(conditionPrefix, tokens)) {
                return this.conditionCompletions();
            }

            return this.conditionValueCompletions(tokens, quoteMode, /\s$/.test(conditionPrefix));
        }

        if (trimmed.length === 0) {
            return this.actionCompletions();
        }

        if (tokens.length === 1 && /\s$/.test(linePrefix) && isActionKeyword(firstToken)) {
            return this.actionValueCompletions(firstToken, tokens, quoteMode, hasTrailingWhitespace);
        }

        if (tokens.length <= 1) {
            return this.actionCompletions();
        }

        return this.actionValueCompletions(firstToken, tokens, quoteMode, hasTrailingWhitespace);
    }

    private actionCompletions(): CompletionSpec[] {
        return htsw.htsl.helpers.ACTION_KWS.map((kw) => {
            const spec = htsw.types.getActionSpec(kw);
            // Hardcoded snippet overrides for actions with quirks the spec
            // can't express (e.g. `tp custom_coordinates "$1"` defaults to
            // custom-coords mode, `if` needs the brace block).
            const overrideSnippet = ACTION_SNIPPETS[kw];
            // Otherwise generate a snippet from the spec so every action gets
            // tab-stops for its arguments — not just the dozen that were
            // hardcoded. Actions with no fields fall back to the bare keyword.
            const generatedSnippet = spec ? generateActionSnippet(spec) : undefined;
            const insertText = overrideSnippet ?? generatedSnippet ?? kw;
            const isSnippet = Boolean(overrideSnippet) || Boolean(generatedSnippet && spec && spec.fields.length > 0);
            // Prefer the data-driven signature ("var <name> <op> <value>
            // [automaticUnset]") over the generic "HTSL action snippet"
            // tooltip so the popup actually tells you what each action takes.
            const detail = spec
                ? htsw.types.renderActionSignature(spec)
                : "HTSL action";
            return {
                label: kw,
                insertText,
                kind: "action",
                detail,
                snippet: isSnippet,
                sortText: isSnippet ? `0_${kw}` : `1_${kw}`,
            };
        });
    }

    private conditionCompletions(): CompletionSpec[] {
        return htsw.htsl.helpers.CONDITION_KWS.map((kw) => ({
            label: kw,
            insertText: kw,
            kind: "condition",
            detail: "HTSL condition",
        }));
    }

    private actionValueCompletions(
        firstToken: string,
        tokens: TokenInfo[],
        quoteMode: QuoteMode,
        hasTrailingWhitespace: boolean,
    ): CompletionSpec[] {
        const action = unquote(firstToken).toLowerCase();
        const argCount = Math.max(0, tokens.length - 1);
        const lastToken = unquote(last(tokens)?.text ?? "");

        // `sound` has bespoke completions (sound paths + names from the SOUNDS
        // table) that don't fit the generic option-list dispatch, so handle it
        // first and let the spec drive the remaining args (volume/pitch/loc).
        if (action === "sound" && argCount <= 1) {
            return soundCompletions(quoteMode);
        }

        // Var-family actions have a quirk the spec can't express directly:
        // when `op` is `unset`, no value/automaticUnset args follow. Keep the
        // dedicated handler for that.
        if (["var", "globalvar", "teamvar", "stat", "globalstat", "teamstat"].includes(action)) {
            return actionVarCompletions(action, argCount, lastToken, hasTrailingWhitespace);
        }

        const spec = htsw.types.getActionSpec(action);
        if (spec) {
            return actionFieldCompletionsFromSpec(spec, argCount, hasTrailingWhitespace, quoteMode);
        }

        return [];
    }

    private conditionValueCompletions(
        tokens: TokenInfo[],
        quoteMode: QuoteMode,
        hasTrailingWhitespace: boolean,
    ): CompletionSpec[] {
        const currentCondition = getCurrentConditionTokens(tokens);
        const condition = unquote(currentCondition[0]?.text ?? "").replace(/^!/, "").toLowerCase();
        const argCount = Math.max(0, currentCondition.length - 1);

        if (currentCondition.length === 0 || condition === "") {
            return this.conditionCompletions();
        }

        // Var-family conditions have a fallback-arg shape (`var foo == 5 0`)
        // that the generic spec format can't express, so they keep a dedicated
        // handler.
        if (["var", "globalvar", "teamvar", "stat", "globalstat", "teamstat"].includes(condition)) {
            return conditionVarCompletions(
                condition,
                argCount,
                unquote(last(currentCondition)?.text ?? ""),
                hasTrailingWhitespace,
            );
        }

        const spec = htsw.types.getConditionSpec(condition);
        if (spec) {
            return actionFieldCompletionsFromSpec(spec, argCount, hasTrailingWhitespace, quoteMode);
        }

        return this.conditionCompletions();
    }

    private isPlaceholderContext(linePrefix: string, lastToken: string): boolean {
        return lastToken.startsWith("%") || /%[\w./-]*$/.test(linePrefix);
    }

    private filterCompletions(
        completions: CompletionSpec[],
        typedPrefix: string,
    ): CompletionSpec[] {
        const normalized = typedPrefix.replace(/^"|"$/g, "");
        if (!normalized) return completions;

        return completions.flatMap((completion) => {
            const haystack = [
                completion.label,
                completion.insertText,
                completion.filterText ?? "",
            ].join(" ").toLowerCase();

            const candidates = haystack
                .split(/\s+/)
                .map((candidate) => candidate.replace(/^%/, ""));
            const bestCandidate = candidates
                .filter((candidate) => candidate.startsWith(normalized))
                .sort((left, right) => left.length - right.length)[0];

            if (!bestCandidate) return [];

            const rank = bestCandidate === normalized ? 0 : 1;
            return [{
                ...completion,
                sortText: `${rank}_${bestCandidate.length.toString().padStart(3, "0")}_${completion.label}`,
            }];
        });
    }

}

type CompletionSpec = {
    label: string;
    insertText: string;
    kind: CompletionKind;
    detail?: string;
    filterText?: string;
    sortText?: string;
    snippet?: boolean;
};

type TokenInfo = {
    text: string;
    quoted: boolean;
};

type QuoteMode = "none" | "closed" | "open";

function tokenize(input: string): TokenInfo[] {
    const tokens: TokenInfo[] = [];
    let current = "";
    let quoted = false;
    let inString = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (char === "\"" && input[i - 1] !== "\\") {
            if (!inString && current.length === 0) quoted = true;
            inString = !inString;
            current += char;
            continue;
        }

        if (/\s/.test(char) && !inString) {
            if (current.length > 0) {
                tokens.push({ text: current, quoted });
                current = "";
                quoted = false;
            }
            continue;
        }

        current += char;
    }

    if (current.length > 0) {
        tokens.push({ text: current, quoted });
    }

    return tokens;
}

function isInsideIfCondition(linePrefix: string): boolean {
    const ifIndex = linePrefix.search(/\bif\b/i);
    if (ifIndex < 0) return false;

    const openIndex = linePrefix.indexOf("(", ifIndex);
    if (openIndex < 0) return false;

    const closeIndex = linePrefix.indexOf(")", openIndex);
    return closeIndex < 0 || closeIndex >= linePrefix.length;
}

function getOpenIfConditionPrefix(documentPrefix: string): string | undefined {
    const parens: number[] = [];
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < documentPrefix.length; i++) {
        const char = documentPrefix[i];
        const next = documentPrefix[i + 1];

        if (inLineComment) {
            if (char === "\n") inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inString) {
            if (char === "\"" && documentPrefix[i - 1] !== "\\") inString = false;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            i++;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "(") {
            parens.push(i);
        } else if (char === ")") {
            parens.pop();
        }
    }

    const openParen = last(parens);
    if (openParen === undefined) return undefined;

    const beforeOpenParen = documentPrefix.slice(0, openParen).trimEnd();
    if (!/\bif\s*(?:and|or|true|false)?\s*$/i.test(beforeOpenParen)) return undefined;

    return documentPrefix.slice(openParen + 1);
}

function isActionKeyword(value: string): boolean {
    const normalized = unquote(value);
    return htsw.htsl.helpers.ACTION_KWS.some((kw) => kw === normalized);
}

function isSameLineConditionStartContext(linePrefix: string, tokens: TokenInfo[]): boolean {
    if (!isInsideIfCondition(linePrefix)) return false;
    return isConditionStartContext(linePrefix.slice(linePrefix.indexOf("(") + 1), tokens);
}

function isConditionStartContext(conditionPrefix: string, tokens: TokenInfo[]): boolean {
    const trimmed = conditionPrefix.trimEnd();
    if (trimmed.length === 0 || trimmed.endsWith(",")) return true;
    return last(tokens)?.text === "!" || Boolean(last(tokens)?.text.endsWith("(!"));
}

function getCurrentConditionTokens(tokens: TokenInfo[]): TokenInfo[] {
    let start = 0;
    for (let i = tokens.length - 1; i >= 0; i--) {
        const text = tokens[i].text;
        if (text.includes("(")) {
            start = text.endsWith("(") ? i + 1 : i;
            break;
        }
        if (text.endsWith(",")) {
            start = i + 1;
            break;
        }
    }

    return tokens.slice(start).map((token, index) => {
        let text = token.text;
        if (index === 0) text = text.replace(/^[,(]+/, "");
        return { ...token, text: text.replace(/,$/, "") };
    }).filter((token) => token.text.length > 0);
}

function optionCompletions(
    values: readonly string[],
    kind: CompletionKind,
    quoteMode: QuoteMode = "none",
    detail?: string,
): CompletionSpec[] {
    return values.map((value) => ({
        label: value,
        insertText: formatQuotedCompletion(value, quoteMode),
        // `${value} ${value with underscores}` lets users type either form;
        // appending `${detail}` lets the placeholder text (e.g. `gamemode`,
        // `slot`) match every option so the popup shows the full list when
        // the cursor lands on a snippet placeholder of that name.
        filterText: detail
            ? `${value} ${value.split(" ").join("_")} ${detail}`
            : `${value} ${value.split(" ").join("_")}`,
        kind,
        detail,
    }));
}

function inventorySlotCompletions(quoteMode: QuoteMode = "none", detail?: string): CompletionSpec[] {
    const slots = [
        ...htsw.types.INVENTORY_SLOTS,
        ...Array.from({ length: 9 }, (_, index) => `Hotbar Slot ${index + 1}`),
        ...Array.from({ length: 27 }, (_, index) => `Inventory Slot ${index + 1}`),
    ];

    return optionCompletions(slots, "constant", quoteMode, detail);
}

function soundCompletions(quoteMode: QuoteMode = "none"): CompletionSpec[] {
    return htsw.types.SOUNDS.flatMap((sound) => [
        {
            label: sound.name,
            insertText: formatQuotedCompletion(sound.name, quoteMode),
            filterText: `${sound.name} ${sound.name.split(" ").join("_")} ${sound.path}`,
            detail: sound.path,
            kind: "sound" as const,
        },
        {
            label: sound.path,
            insertText: formatQuotedCompletion(sound.path, quoteMode),
            filterText: `${sound.path} ${sound.name}`,
            detail: sound.name,
            kind: "sound" as const,
        },
    ]);
}

function placeholderCompletions(detail?: string): CompletionSpec[] {
    return htsw.types.PLACEHOLDER_COMPLETIONS.map((placeholder) => ({
        label: `%${placeholder}%`,
        insertText: `%${placeholder}%`,
        // The replacement range includes the leading `%` (see
        // `getReplacementRange`), so VS Code fuzzy-matches the typed text
        // (e.g. `%pl`) against `filterText`. If `filterText` were just
        // `placeholder` (no `%`), VS Code would reject every item because the
        // `%` from the typed text wouldn't appear in the target — leading to
        // an empty "No suggestions" popup. Keep the `%` in `filterText` so the
        // matcher lines up with what's actually being typed.
        filterText: `%${placeholder}`,
        kind: "placeholder",
        detail,
    }));
}

function last<T>(values: T[]): T | undefined {
    return values.length === 0 ? undefined : values[values.length - 1];
}

function nthFromEnd<T>(values: T[], offset: number): T | undefined {
    const index = values.length - offset;
    return index < 0 ? undefined : values[index];
}

// Each item's `filterText` includes the field name (`detail`) when supplied,
// so when the cursor lands on a placeholder text like `op` (auto-selected by
// the snippet), VS Code's fuzzy matcher matches `op` against the field-name
// suffix rather than against the operator symbol alone — which has no
// letters in common with `op` and would otherwise filter every item out and
// show "No suggestions".
function comparisonCompletions(detail?: string): CompletionSpec[] {
    return [
        ...Object.values(htsw.htsl.helpers.COMPARISON_SYMBOLS),
        ...htsw.types.COMPARISONS.map(quoteIfNeeded),
    ].map((value) => ({
        label: value,
        insertText: value,
        filterText: detail ? `${value} ${detail}` : value,
        kind: "operator",
        detail,
    }));
}

function operatorCompletions(detail?: string): CompletionSpec[] {
    return [
        ...Object.values(htsw.htsl.helpers.OPERATION_SYMBOLS),
        ...Object.values(htsw.htsl.helpers.COMPARISON_SYMBOLS),
    ].map((value) => ({
        label: value,
        insertText: value,
        filterText: detail ? `${value} ${detail}` : value,
        kind: "operator",
        detail,
    }));
}

function varOperationCompletions(detail?: string): CompletionSpec[] {
    return Object.values(htsw.htsl.helpers.OPERATION_SYMBOLS).map((value) => ({
        label: value,
        insertText: value,
        filterText: detail ? `${value} ${detail}` : value,
        kind: "operator",
        detail,
    }));
}

/**
 * Generate a VS Code snippet from a spec so every action has tab-stops for
 * its args, not just the dozen with hardcoded snippets in `ACTION_SNIPPETS`.
 *
 * Snippet syntax used:
 *   `${N:placeholder}`   - tab stop with default text (auto-selected on tab,
 *                          so typing replaces — no need to delete)
 *   `${N|a,b|}`          - choice picker (auto-pops a list)
 *   `"${N:placeholder}"` - quoted string
 *
 * Optional fields are intentionally skipped from the snippet. Including them
 * meant choice pickers (e.g. `automaticUnset`'s `${N|true,false|}`) would
 * insert their first option as text the user had to clean up if they didn't
 * want it — accidentally producing things like `var <empty> <empty> <empty>
 * true`, which the parser then treated as a var named `true`. Optional args
 * can always be added manually after the snippet expands.
 */
function generateActionSnippet(spec: htsw.types.ActionSpec): string {
    const required = spec.fields.filter((field) => !field.optional);
    if (required.length === 0) return spec.kw;
    const args = required.map((field, i) => snippetForField(field, i + 1));
    return `${spec.kw} ${args.join(" ")}`;
}

function snippetForField(field: htsw.types.ActionFieldSpec, n: number): string {
    switch (field.kind) {
        // Closed-set fields use the choice-picker syntax so the user gets a
        // popup on tab and selects with one keystroke. The first option is
        // inserted as default — that's fine for required fields where the
        // user has to pick *something*. `false` is listed first because
        // Hypixel's default for almost every boolean (including
        // `automaticUnset`, `replaceExisting`, etc. — see
        // `ct_module/src/importer/actionMappings.ts`) is `false`.
        case "boolean":
            return `\${${n}|false,true|}`;
        case "ifMode":
            return `\${${n}|and,or,true,false|}`;
        // String-quoted fields. The placeholder text is the field name so the
        // user sees what's expected; VS Code auto-selects the placeholder on
        // tab so typing immediately replaces it (no manual delete).
        case "string":
        case "item":
        case "team":
        case "function":
        case "group":
            return `"\${${n}:${field.name}}"`;
        case "block":
            // Nested action blocks need braces; tab-stop into the body.
            return `{\n\t\${${n}}\n}`;
        // Everything else: placeholder text = field name. Same auto-select
        // behavior — type to replace, don't have to delete.
        default:
            return `\${${n}:${field.name}}`;
    }
}

/**
 * Generic per-position completions driven by `ACTION_SPECS`.
 *
 * The user's cursor sits at field index:
 *   - `argCount` when there's trailing whitespace (they just finished the
 *     previous arg and are about to type the next one)
 *   - `argCount - 1` when there isn't (they're still typing the current arg)
 *
 * When the spec has no field at that index (e.g. they've typed past the end),
 * we return [] — VS Code will show "No suggestions" rather than a stale list.
 */
function actionFieldCompletionsFromSpec(
    spec: htsw.types.ActionSpec,
    argCount: number,
    hasTrailingWhitespace: boolean,
    quoteMode: QuoteMode,
): CompletionSpec[] {
    const fieldIndex = hasTrailingWhitespace ? argCount : argCount - 1;
    const field = spec.fields[fieldIndex];
    if (!field) return [];
    return completionsForFieldKind(field.kind, field.name, quoteMode);
}

function completionsForFieldKind(
    kind: htsw.types.ActionFieldKind,
    fieldName: string,
    quoteMode: QuoteMode,
): CompletionSpec[] {
    // `fieldName` is passed as `detail` on every generated item so the popup
    // tells the user which argument position the suggestion is for (e.g.
    // selecting `==` from a long list of operators shows `op` as detail).
    const d = fieldName;
    switch (kind) {
        case "boolean":
            return booleanCompletions(d);
        case "value":
            return [...valueCompletions(d), ...placeholderCompletions(d)];
        case "placeholder":
            return placeholderCompletions(d);
        case "gamemode":
            return optionCompletions(htsw.types.GAMEMODES, "constant", quoteMode, d);
        case "lobby":
            return optionCompletions(htsw.types.LOBBIES, "constant", quoteMode, d);
        case "potion":
            return optionCompletions(htsw.types.POTION_EFFECTS, "constant", quoteMode, d);
        case "enchant":
            return optionCompletions(htsw.types.ENCHANTMENTS, "constant", quoteMode, d);
        case "location":
            return optionCompletions(htsw.types.LOCATIONS, "constant", quoteMode, d);
        case "slot":
            return inventorySlotCompletions(quoteMode, d);
        case "varOp":
            return varOperationCompletions(d);
        case "operation":
            return operatorCompletions(d);
        case "comparison":
            return comparisonCompletions(d);
        case "ifMode":
            return ifModeCompletions(d);
        // Condition-side option lists.
        case "itemProperty":
            return optionCompletions(htsw.types.ITEM_PROPERTIES, "constant", quoteMode, d);
        case "itemLocation":
            return optionCompletions(htsw.types.ITEM_LOCATIONS, "constant", quoteMode, d);
        case "itemAmount":
            return optionCompletions(htsw.types.ITEM_AMOUNTS, "constant", quoteMode, d);
        case "permission":
            return optionCompletions(htsw.types.PERMISSIONS, "constant", quoteMode, d);
        case "damageCause":
            return optionCompletions(htsw.types.DAMAGE_CAUSES, "constant", quoteMode, d);
        case "fishingEnv":
            return optionCompletions(htsw.types.FISHING_ENVIRONMENTS, "constant", quoteMode, d);
        case "portal":
            return optionCompletions(htsw.types.PORTAL_TYPES, "constant", quoteMode, d);
        // Free-form fields that don't have a finite suggestion list. The
        // inlay hint adapter still labels these with the field name from the
        // spec, so users get the parameter name even without a popup.
        case "string":
        case "number":
        case "varName":
        case "team":
        case "function":
        case "group":
        case "item":
        case "weather":
        case "time":
        case "block":
            return [];
    }
}

function actionVarCompletions(
    action: string,
    argCount: number,
    lastToken: string,
    hasTrailingWhitespace: boolean,
): CompletionSpec[] {
    const isTeamVar = action === "teamvar" || action === "teamstat";
    // Resolve the field position the user is *typing into*, not the count of
    // tokens already entered. With trailing whitespace the user has finished
    // the previous arg and is starting the next one (fieldIndex = argCount).
    // Without trailing whitespace they're still mid-typing the current arg
    // (fieldIndex = argCount - 1). The original code used bare argCount,
    // which meant `var foo o` (cursor on `o`, typing the op) was incorrectly
    // treated as the value position and produced wrong suggestions.
    const fieldIndex = hasTrailingWhitespace ? argCount : argCount - 1;

    // Field positions:
    //   non-team:  0=name  1=op  2=value  3=automaticUnset
    //   team:      0=name  1=team  2=op  3=value  4=automaticUnset
    const opIdx = isTeamVar ? 2 : 1;
    const valueIdx = opIdx + 1;
    const unsetIdx = valueIdx + 1;

    if (fieldIndex < 0 || fieldIndex === 0) {
        // Name position. No specific completions — var names are free text.
        return [];
    }
    if (isTeamVar && fieldIndex === 1) {
        // Team name — also free text.
        return [];
    }
    if (fieldIndex === opIdx) {
        return varOperationCompletions("op");
    }
    if (fieldIndex === valueIdx) {
        // When the op is `unset` no value follows; suppress suggestions so
        // the user gets a clean line ending instead of a noisy popup.
        if (isUnsetOperation(lastToken)) return [];
        return [...valueCompletions("value"), ...placeholderCompletions("value")];
    }
    if (fieldIndex === unsetIdx) {
        return booleanCompletions("automaticUnset");
    }
    return [];
}

function conditionVarCompletions(
    condition: string,
    argCount: number,
    lastToken: string,
    hasTrailingWhitespace: boolean,
): CompletionSpec[] {
    const isTeamVar = condition === "teamvar" || condition === "teamstat";
    // Same fieldIndex logic as `actionVarCompletions`. See that function's
    // comment for why bare argCount is wrong.
    const fieldIndex = hasTrailingWhitespace ? argCount : argCount - 1;

    // Field positions:
    //   non-team:  0=var  1=op  2=amount  3=fallback
    //   team:      0=var  1=team  2=op  3=amount  4=fallback
    const opIdx = isTeamVar ? 2 : 1;
    const amountIdx = opIdx + 1;
    const fallbackIdx = amountIdx + 1;

    if (fieldIndex < 0 || fieldIndex === 0) {
        return [];
    }
    if (isTeamVar && fieldIndex === 1) {
        return [];
    }
    if (fieldIndex === opIdx) {
        return comparisonCompletions("op");
    }
    if (fieldIndex === amountIdx) {
        return [...valueCompletions("amount"), ...placeholderCompletions("amount")];
    }
    if (fieldIndex === fallbackIdx) {
        return [...valueCompletions("fallback"), ...placeholderCompletions("fallback")];
    }
    return [];
}

function isUnsetOperation(value: string): boolean {
    return value.toLowerCase() === "unset";
}

function valueCompletions(detail?: string): CompletionSpec[] {
    return ["true", "false", "null", "unset"].map((value) => ({
        label: value,
        insertText: value,
        kind: "constant",
        detail,
    }));
}

function booleanCompletions(detail?: string): CompletionSpec[] {
    // Both items share a `filterText` that contains every option in the set.
    // Without this, when the cursor sits on an existing `false`, VS Code's
    // fuzzy matcher rejects `true` (none of f-a-l-s-e appear in `true`) and
    // then suppresses the popup entirely because the sole remaining item
    // exactly matches the typed text — leaving the user with no way to flip
    // the value without first deleting it. With both values in `filterText`,
    // typing/holding either one keeps both options visible.
    return ["true", "false"].map((value) => ({
        label: value,
        insertText: value,
        filterText: "true false",
        kind: "constant",
        detail,
    }));
}

function ifModeCompletions(detail?: string): CompletionSpec[] {
    // Same shared-filterText trick as `booleanCompletions` so the popup keeps
    // showing alternatives when the cursor sits on an existing mode keyword.
    const all = "and or true false";
    return ["and", "or", "true", "false"].map((value) => ({
        label: value,
        insertText: value,
        filterText: all,
        kind: "constant",
        detail: detail ?? "Conditional match mode",
    }));
}

function quoteIfNeeded(value: string): string {
    return /\s/.test(value) ? `"${value}"` : value;
}

function formatQuotedCompletion(value: string, quoteMode: QuoteMode): string {
    if (quoteMode === "closed") return value;
    if (quoteMode === "open") return `${value}"`;
    return quoteIfNeeded(value);
}

function getQuoteMode(token: TokenInfo | undefined): QuoteMode {
    if (!token?.quoted) return "none";
    return token.text.length > 1 && token.text.endsWith("\"") ? "closed" : "open";
}

function unquote(value: string): string {
    return value.replace(/^"|"$/g, "");
}

