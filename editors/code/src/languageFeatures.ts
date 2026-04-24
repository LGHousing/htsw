import * as vscode from "vscode";
import * as htsw from "htsw";
import * as common from "htsw-editor-common";
import * as fs from "node:fs";
import * as path from "node:path";

class StringFileLoader implements htsw.FileLoader {
    constructor(private readonly src: string) {}

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

class HybridFileLoader implements htsw.FileLoader {
    constructor(
        private readonly currentPath: string,
        private readonly currentSource: string
    ) {}

    fileExists(filePath: string): boolean {
        if (this.normalize(filePath) === this.normalize(this.currentPath)) return true;
        return fs.existsSync(filePath);
    }

    readFile(filePath: string): string {
        if (this.normalize(filePath) === this.normalize(this.currentPath)) {
            return this.currentSource;
        }

        return fs.readFileSync(filePath, "utf8");
    }

    getParentPath(base: string): string {
        return path.dirname(base);
    }

    resolvePath(base: string, other: string): string {
        return path.resolve(base, other);
    }

    private normalize(filePath: string): string {
        return path.resolve(filePath).toLowerCase();
    }
}

type CompletionKind =
    | "action"
    | "condition"
    | "constant"
    | "operator"
    | "placeholder"
    | "sound"
    | "snippet";

const ACTION_SNIPPETS: Record<string, string> = {
    if: "if ${1:and} (${2:condition}) {\n\t$0\n}",
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
        const completions = this.completeForContext(linePrefix);

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

    private completeForContext(linePrefix: string): CompletionSpec[] {
        const tokens = tokenize(linePrefix);
        const trimmed = linePrefix.trimStart();
        const lastToken = last(tokens)?.text ?? "";
        const previousToken = nthFromEnd(tokens, 2)?.text ?? "";
        const firstToken = tokens[0]?.text ?? "";
        const quoteMode = getQuoteMode(last(tokens));

        if (trimmed.length === 0) {
            return this.actionCompletions();
        }

        if (this.isPlaceholderContext(linePrefix, lastToken)) {
            return placeholderCompletions();
        }

        if (isConditionStartContext(linePrefix, tokens)) {
            return this.conditionCompletions();
        }

        if (isInsideIfCondition(linePrefix)) {
            return this.conditionValueCompletions(tokens, quoteMode);
        }

        if (tokens.length <= 1) {
            return this.actionCompletions();
        }

        return this.actionValueCompletions(firstToken, previousToken, tokens, quoteMode);
    }

    private actionCompletions(): CompletionSpec[] {
        return htsw.htsl.helpers.ACTION_KWS.map((kw) => {
            const snippet = ACTION_SNIPPETS[kw];
            return {
                label: kw,
                insertText: snippet ?? kw,
                kind: snippet ? "snippet" : "action",
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
        previousToken: string,
        tokens: TokenInfo[],
        quoteMode: QuoteMode
    ): CompletionSpec[] {
        const action = unquote(firstToken).toLowerCase();
        const argCount = Math.max(0, tokens.length - 1);

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
            if (["=", "+=", "-=", "*=", "/=", "<<=", ">>=", "&=", "|=", "^="].includes(previousToken)) {
                return [...valueCompletions(), ...placeholderCompletions()];
            }
            return operatorCompletions();
        }

        return [
            ...valueCompletions(),
            ...optionCompletions(htsw.types.LOCATIONS, "constant", quoteMode),
        ];
    }

    private conditionValueCompletions(tokens: TokenInfo[], quoteMode: QuoteMode): CompletionSpec[] {
        const currentCondition = getCurrentConditionTokens(tokens);
        const condition = unquote(currentCondition[0]?.text ?? "").replace(/^!/, "").toLowerCase();
        const previousToken = nthFromEnd(currentCondition, 2)?.text ?? "";
        const argCount = Math.max(0, currentCondition.length - 1);

        if (currentCondition.length === 0 || condition === "") {
            return this.conditionCompletions();
        }

        if (["var", "globalvar", "teamvar", "stat", "globalstat", "teamstat", "health", "maxhealth", "hunger", "damageamount", "placeholder"].includes(condition)) {
            if (argCount >= 1 || previousToken === "") {
                return [
                    ...comparisonCompletions(),
                    ...valueCompletions(),
                    ...placeholderCompletions(),
                ];
            }
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
        if (condition === "placeholder") return placeholderCompletions();

        return [
            ...this.conditionCompletions(),
            ...comparisonCompletions(),
            ...valueCompletions(),
        ];
    }

    private isPlaceholderContext(linePrefix: string, lastToken: string): boolean {
        return lastToken.startsWith("%") || /%[\w./-]*$/.test(linePrefix);
    }

    private getReplacementRange(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Range | undefined {
        return document.getWordRangeAtPosition(position, /[%\w./-]+/);
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

function isConditionStartContext(linePrefix: string, tokens: TokenInfo[]): boolean {
    if (!isInsideIfCondition(linePrefix)) return false;
    const trimmed = linePrefix.trimEnd();
    if (trimmed.endsWith("(") || trimmed.endsWith(",")) return true;
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
        filterText: `${value} ${value.replaceAll(" ", "_")}`,
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
            filterText: `${sound.name} ${sound.name.replaceAll(" ", "_")} ${sound.path}`,
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

function valueCompletions(): CompletionSpec[] {
    return ["true", "false", "null", "unset"].map((value) => ({
        label: value,
        insertText: value,
        kind: "constant",
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

// --- inlay hints ---

export class InlayHintsAdapter implements vscode.InlayHintsProvider {
    public provideInlayHints(
        document: vscode.TextDocument
        // range: vscode.Span,
        // token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlayHint[]> {
        const htslHints = common.provideInlayHints(document.getText());

        return htslHints.map((hint) => {
            return {
                kind: vscode.InlayHintKind.Parameter,
                position: document.positionAt(hint.span.start),
                label: hint.label + ":",
            };
        });
    }
}

// --- diagnostics ---

export class DiagnosticsAdapter {
    private disposables: vscode.Disposable[] = [];
    private pendingValidations: Map<string, NodeJS.Timeout> = new Map();
    private diagnosticCollection: vscode.DiagnosticCollection =
        vscode.languages.createDiagnosticCollection("htsl");

    constructor() {
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument((document) => this.scheduleValidate(document))
        );
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => this.scheduleValidate(e.document))
        );
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((document) => this.scheduleValidate(document))
        );
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                const key = document.uri.toString();
                const timer = this.pendingValidations.get(key);
                if (timer) {
                    clearTimeout(timer);
                    this.pendingValidations.delete(key);
                }
            })
        );
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                void this.refreshWorkspaceDiagnostics();
            })
        );
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("htsw.diagnostics.excludeFolders")) return;

                this.diagnosticCollection.clear();
                vscode.workspace.textDocuments.forEach((document) =>
                    this.scheduleValidate(document, 0)
                );
                void this.refreshWorkspaceDiagnostics();
            })
        );

        this.addWorkspaceWatcher("**/*.htsl");
        this.addWorkspaceWatcher("**/import.json");
        this.addWorkspaceWatcher("**/*.import.json");

        vscode.workspace.textDocuments.forEach((document) => this.scheduleValidate(document, 0));
        void this.refreshWorkspaceDiagnostics();
    }

    public dispose() {
        for (const timer of this.pendingValidations.values()) {
            clearTimeout(timer);
        }
        this.pendingValidations.clear();
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

    private addWorkspaceWatcher(pattern: string) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.disposables.push(watcher);
        this.disposables.push(
            watcher.onDidCreate((uri) => void this.validateUriFromDisk(uri))
        );
        this.disposables.push(
            watcher.onDidChange((uri) => void this.validateUriFromDisk(uri))
        );
        this.disposables.push(
            watcher.onDidDelete((uri) => this.diagnosticCollection.set(uri, []))
        );
    }

    private scheduleValidate(document: vscode.TextDocument, delayMs = 250) {
        if (!this.isSupportedDocument(document)) return;
        if (this.isExcludedUri(document.uri)) {
            this.diagnosticCollection.set(document.uri, []);
            return;
        }

        const key = document.uri.toString();
        const existing = this.pendingValidations.get(key);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.pendingValidations.delete(key);
            this.validate(document);
        }, delayMs);

        this.pendingValidations.set(key, timer);
    }

    private async refreshWorkspaceDiagnostics() {
        const exclude = "**/{node_modules,dist,out}/**";
        const [htslFiles, importJsonFiles, dotImportJsonFiles] = await Promise.all([
            vscode.workspace.findFiles("**/*.htsl", exclude),
            vscode.workspace.findFiles("**/import.json", exclude),
            vscode.workspace.findFiles("**/*.import.json", exclude),
        ]);

        const seen = new Set<string>();
        for (const uri of [...htslFiles, ...importJsonFiles, ...dotImportJsonFiles]) {
            const key = uri.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            if (this.isExcludedUri(uri)) {
                this.diagnosticCollection.set(uri, []);
                continue;
            }
            await this.validateUriFromDisk(uri);
        }
    }

    private async validateUriFromDisk(uri: vscode.Uri) {
        if (this.isExcludedUri(uri)) {
            this.diagnosticCollection.set(uri, []);
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            this.validate(document);
        } catch {
            this.diagnosticCollection.set(uri, []);
        }
    }

    private validate(document: vscode.TextDocument) {
        const diagnostics = this.collectDiagnostics(document);
        const markers = diagnostics.flatMap((diagnostic) => {
            const diagnosticSpan =
                diagnostic.spans.find((span) => span.kind === "primary")?.span ||
                diagnostic.spans[0]?.span;

            if (!diagnosticSpan) return [];

            const start = document.positionAt(diagnosticSpan.start);
            const end = document.positionAt(diagnosticSpan.end);
            const relatedInformation = this.buildRelatedInformation(
                document,
                diagnostic
            );

            return [
                this.createVscodeDiagnostic(
                    new vscode.Range(start, end),
                    diagnostic,
                    relatedInformation
                ),
            ];
        });

        this.diagnosticCollection.set(document.uri, markers);
    }

    private createVscodeDiagnostic(
        range: vscode.Range,
        diagnostic: htsw.Diagnostic,
        relatedInformation: vscode.DiagnosticRelatedInformation[]
    ): vscode.Diagnostic {
        const marker = new vscode.Diagnostic(
            range,
            this.formatDiagnosticMessage(diagnostic),
            this.htslDiagnosticLevelToMarkerSeverity(diagnostic.level)
        );

        marker.source = "htsw";
        if (relatedInformation.length > 0) {
            marker.relatedInformation = relatedInformation;
        }

        return marker;
    }

    private formatDiagnosticMessage(diagnostic: htsw.Diagnostic): string {
        return diagnostic.message;
    }

    private buildRelatedInformation(
        document: vscode.TextDocument,
        diagnostic: htsw.Diagnostic
    ): vscode.DiagnosticRelatedInformation[] {
        const related: vscode.DiagnosticRelatedInformation[] = [];

        for (const spanPart of diagnostic.spans) {
            if (spanPart.kind !== "secondary") continue;
            related.push(
                    this.relatedFromSpan(
                        document,
                        spanPart.span,
                        spanPart.label ?? "Related location"
                    )
                );
            }

        for (const sub of this.flattenSubDiagnostics(diagnostic)) {
            const label = `${sub.level}: ${sub.message}`;
            for (const spanPart of sub.spans) {
                related.push(
                    this.relatedFromSpan(
                        document,
                        spanPart.span,
                        spanPart.label ? `${label} (${spanPart.label})` : label
                    )
                );
            }
        }

        return related;
    }

    private relatedFromSpan(
        document: vscode.TextDocument,
        span: htsw.Span,
        message: string
    ): vscode.DiagnosticRelatedInformation {
        const start = document.positionAt(span.start);
        const end = document.positionAt(span.end);

        return new vscode.DiagnosticRelatedInformation(
            new vscode.Location(document.uri, new vscode.Range(start, end)),
            message
        );
    }

    private flattenSubDiagnostics(root: htsw.Diagnostic): htsw.Diagnostic[] {
        const result: htsw.Diagnostic[] = [];
        const stack = [...root.subDiagnostics];

        while (stack.length > 0) {
            const current = stack.shift()!;
            result.push(current);
            if (current.subDiagnostics.length > 0) {
                stack.unshift(...current.subDiagnostics);
            }
        }

        return result;
    }

    private collectDiagnostics(document: vscode.TextDocument): htsw.Diagnostic[] {
        if (document.languageId === "htsl") {
            const sourceMap = new htsw.SourceMap(new StringFileLoader(document.getText()));
            return htsw.parseActionsResult(sourceMap, "file.htsl").diagnostics;
        }

        if (this.isImportJsonDocument(document)) {
            const docPath = document.uri.fsPath;
            const sourceMap = new htsw.SourceMap(
                new HybridFileLoader(docPath, document.getText())
            );
            const result = htsw.parseImportablesResult(sourceMap, docPath);
            return result.diagnostics.filter((diagnostic) =>
                this.isDiagnosticForFile(diagnostic, sourceMap, docPath)
            );
        }

        return [];
    }

    private isDiagnosticForFile(
        diagnostic: htsw.Diagnostic,
        sourceMap: htsw.SourceMap,
        docPath: string
    ): boolean {
        const span =
            diagnostic.spans.find((it) => it.kind === "primary")?.span ||
            diagnostic.spans[0]?.span;

        if (!span) return true;

        try {
            const sourceFile = sourceMap.getFileByPos(span.start);
            return path.resolve(sourceFile.path).toLowerCase() === path.resolve(docPath).toLowerCase();
        } catch {
            return true;
        }
    }

    private isSupportedDocument(document: vscode.TextDocument): boolean {
        return document.languageId === "htsl" || this.isImportJsonDocument(document);
    }

    private isExcludedUri(uri: vscode.Uri): boolean {
        if (uri.scheme !== "file") return false;

        return this.getContainingWorkspaceFolders(uri).some((workspaceFolder) => {
            const relativePath = this.normalizePath(
                path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
            );
            if (!relativePath || relativePath.startsWith("../")) return false;

            return this.getExcludedFolders(workspaceFolder.uri).some(
                (folder) => relativePath === folder || relativePath.startsWith(`${folder}/`)
            );
        });
    }

    private isImportJsonDocument(document: vscode.TextDocument): boolean {
        if (document.languageId !== "json" && document.languageId !== "jsonc") return false;
        const filePath = document.uri.fsPath.toLowerCase();
        return filePath.endsWith("import.json") || filePath.endsWith(".import.json");
    }

    private getExcludedFolders(uri: vscode.Uri): string[] {
        return vscode.workspace
            .getConfiguration("htsw", uri)
            .get<string[]>("diagnostics.excludeFolders", [])
            .map((folder) => this.normalizePath(folder).replace(/^\/+|\/+$/g, ""))
            .filter(Boolean);
    }

    private getContainingWorkspaceFolders(uri: vscode.Uri): vscode.WorkspaceFolder[] {
        return (vscode.workspace.workspaceFolders ?? [])
            .filter((workspaceFolder) => {
                const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                return relativePath === "" || !relativePath.startsWith("..");
            })
            .sort((left, right) => right.uri.fsPath.length - left.uri.fsPath.length);
    }

    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, "/").toLowerCase();
    }

    private htslDiagnosticLevelToMarkerSeverity(
        severity: htsw.DiagnosticLevel
    ): vscode.DiagnosticSeverity {
        switch (severity) {
            case "bug":
            case "error":
                return vscode.DiagnosticSeverity.Error;
            case "warning":
                return vscode.DiagnosticSeverity.Warning;
            case "note":
                return vscode.DiagnosticSeverity.Information;
            case "help":
                return vscode.DiagnosticSeverity.Hint;
        }
    }
}

// --- hover ---

// --- rename ---

// --- references ---
