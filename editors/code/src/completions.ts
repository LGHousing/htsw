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

const ACTION_SNIPPETS: Record<string, string> = {
    if: "if ${1|and,or,true,false|} ($2) {\n\t$0\n}",
    random: "random {\n\t$0\n}",
    chat: "chat \"$1\"",
    actionBar: "actionBar \"$1\"",
    title: "title \"$1\" \"${2}\" ${3:1} ${4:3} ${5:1}",
    sound: "sound \"$1\" ${2:0.7} ${3:1.0}",
    tp: "tp custom_coordinates \"$1\"",
    changeVelocity: "changeVelocity ${1:0} ${2:0} ${3:0}",
    giveItem: "giveItem \"$1\" ${2:false} \"${3:First Available Slot}\" ${4:false}",
    var: "var ${1:name} ${2:=} ${3:0}",
    globalvar: "globalvar ${1:name} ${2:=} ${3:0}",
    teamvar: "teamvar ${1:name} ${2:=} ${3:0}",
    function: "function \"$1\"",
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
            this.getTypedPrefix(document, range)
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
        range: vscode.Range | undefined
    ): string {
        if (!range) return "";
        return document.getText(range).replace(/^%/, "").toLowerCase();
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
            const snippet = ACTION_SNIPPETS[kw];
            return {
                label: kw,
                insertText: snippet ?? kw,
                kind: "action",
                detail: snippet ? "HTSL action snippet" : "HTSL action",
                snippet: Boolean(snippet),
                sortText: snippet ? `0_${kw}` : `1_${kw}`,
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

        if (action === "sound" && argCount <= 1) {
            return soundCompletions(quoteMode);
        }

        if (action === "gamemode") return optionCompletions(htsw.types.GAMEMODES, "constant", quoteMode);
        if (action === "lobby") return optionCompletions(htsw.types.LOBBIES, "constant", quoteMode);
        if (action === "applypotion") return optionCompletions(htsw.types.POTION_EFFECTS, "constant", quoteMode);
        if (action === "enchant") return optionCompletions(htsw.types.ENCHANTMENTS, "constant", quoteMode);

        if ((action === "tp" || action === "compasstarget") && argCount <= 1) {
            return optionCompletions(htsw.types.LOCATIONS, "constant", quoteMode);
        }

        if (action === "giveitem" && argCount >= 2 && argCount <= 3) {
            return inventorySlotCompletions(quoteMode);
        }

        if (["var", "globalvar", "teamvar", "stat", "globalstat", "teamstat"].includes(action)) {
            return actionVarCompletions(action, argCount, lastToken, hasTrailingWhitespace);
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

        if (["var", "globalvar", "teamvar", "stat", "globalstat", "teamstat"].includes(condition)) {
            return conditionVarCompletions(
                condition,
                argCount,
                unquote(last(currentCondition)?.text ?? ""),
                hasTrailingWhitespace,
            );
        }

        if (["health", "maxhealth", "hunger", "damageamount"].includes(condition)) {
            if (argCount <= 1) return comparisonCompletions();
            return [...valueCompletions(), ...placeholderCompletions()];
        }

        if (condition === "hasitem" || condition === "isitem" || condition === "blocktype") {
            if (argCount <= 2) return optionCompletions(htsw.types.ITEM_PROPERTIES, "constant", quoteMode);
            if (argCount <= 3) return optionCompletions(htsw.types.ITEM_LOCATIONS, "constant", quoteMode);
            return optionCompletions(htsw.types.ITEM_AMOUNTS, "constant", quoteMode);
        }

        if (condition === "haspotion") return optionCompletions(htsw.types.POTION_EFFECTS, "constant", quoteMode);
        if (condition === "haspermission") return optionCompletions(htsw.types.PERMISSIONS, "constant", quoteMode);
        if (condition === "gamemode") return optionCompletions(htsw.types.GAMEMODES, "constant", quoteMode);
        if (condition === "damagecause") return optionCompletions(htsw.types.DAMAGE_CAUSES, "constant", quoteMode);
        if (condition === "fishingenv") return optionCompletions(htsw.types.FISHING_ENVIRONMENTS, "constant", quoteMode);
        if (condition === "portal") return optionCompletions(htsw.types.PORTAL_TYPES, "constant", quoteMode);
        if (condition === "placeholder") {
            if (argCount <= 1) return placeholderCompletions();
            return [...comparisonCompletions(), ...valueCompletions(), ...placeholderCompletions()];
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
    quoteMode: QuoteMode = "none"
): CompletionSpec[] {
    return values.map((value) => ({
        label: value,
        insertText: formatQuotedCompletion(value, quoteMode),
        filterText: `${value} ${value.split(" ").join("_")}`,
        kind,
    }));
}

function inventorySlotCompletions(quoteMode: QuoteMode = "none"): CompletionSpec[] {
    const slots = [
        ...htsw.types.INVENTORY_SLOTS,
        ...Array.from({ length: 9 }, (_, index) => `Hotbar Slot ${index + 1}`),
        ...Array.from({ length: 27 }, (_, index) => `Inventory Slot ${index + 1}`),
    ];

    return optionCompletions(slots, "constant", quoteMode);
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

function placeholderCompletions(): CompletionSpec[] {
    return htsw.types.PLACEHOLDER_COMPLETIONS.map((placeholder) => ({
        label: `%${placeholder}%`,
        insertText: `%${placeholder}%`,
        filterText: placeholder,
        kind: "placeholder",
    }));
}

function last<T>(values: T[]): T | undefined {
    return values.length === 0 ? undefined : values[values.length - 1];
}

function nthFromEnd<T>(values: T[], offset: number): T | undefined {
    const index = values.length - offset;
    return index < 0 ? undefined : values[index];
}

function comparisonCompletions(): CompletionSpec[] {
    return [
        ...Object.values(htsw.htsl.helpers.COMPARISON_SYMBOLS),
        ...htsw.types.COMPARISONS.map(quoteIfNeeded),
    ].map((value) => ({
        label: value,
        insertText: value,
        kind: "operator",
    }));
}

function operatorCompletions(): CompletionSpec[] {
    return [
        ...Object.values(htsw.htsl.helpers.OPERATION_SYMBOLS),
        ...Object.values(htsw.htsl.helpers.COMPARISON_SYMBOLS),
    ].map((value) => ({
        label: value,
        insertText: value,
        kind: "operator",
    }));
}

function varOperationCompletions(): CompletionSpec[] {
    return Object.values(htsw.htsl.helpers.OPERATION_SYMBOLS).map((value) => ({
        label: value,
        insertText: value,
        kind: "operator",
    }));
}

function actionVarCompletions(
    action: string,
    argCount: number,
    lastToken: string,
    hasTrailingWhitespace: boolean,
): CompletionSpec[] {
    const isTeamVar = action === "teamvar" || action === "teamstat";
    const opArgIndex = isTeamVar ? 2 : 1;
    const valueArgIndex = opArgIndex + 1;
    const unsetArgIndex = valueArgIndex + 1;

    if (argCount === 0) {
        return placeholderCompletions();
    }

    if (isTeamVar && argCount === 1) {
        return [];
    }

    if (argCount === opArgIndex) {
        if (!hasTrailingWhitespace) {
            return isTeamVar ? [] : placeholderCompletions();
        }
        return varOperationCompletions();
    }

    if (argCount === valueArgIndex) {
        if (isUnsetOperation(lastToken)) return [];
        return [...valueCompletions(), ...placeholderCompletions()];
    }

    if (argCount === unsetArgIndex) {
        return booleanCompletions();
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
    const opArgIndex = isTeamVar ? 2 : 1;
    const valueArgIndex = opArgIndex + 1;
    const fallbackArgIndex = valueArgIndex + 1;

    if (argCount === 0) {
        return placeholderCompletions();
    }

    if (isTeamVar && argCount === 1) {
        return [];
    }

    if (argCount === opArgIndex) {
        if (!hasTrailingWhitespace) {
            return isTeamVar ? [] : placeholderCompletions();
        }
        return comparisonCompletions();
    }

    if (argCount === valueArgIndex) {
        return [...valueCompletions(), ...placeholderCompletions()];
    }

    if (argCount === fallbackArgIndex) {
        return [...valueCompletions(), ...placeholderCompletions()];
    }

    return [];
}

function isUnsetOperation(value: string): boolean {
    return value.toLowerCase() === "unset";
}

function valueCompletions(): CompletionSpec[] {
    return ["true", "false", "null", "unset"].map((value) => ({
        label: value,
        insertText: value,
        kind: "constant",
    }));
}

function booleanCompletions(): CompletionSpec[] {
    return ["true", "false"].map((value) => ({
        label: value,
        insertText: value,
        kind: "constant",
    }));
}

function ifModeCompletions(): CompletionSpec[] {
    return ["and", "or", "true", "false"].map((value) => ({
        label: value,
        insertText: value,
        kind: "constant",
        detail: "Conditional match mode",
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

