import * as vscode from "vscode";
import * as htsw from "htsw";
import * as common from "htsw-editor-common";
import * as fs from "node:fs";
import * as path from "node:path";
import { computeBestLayout } from "./loreLineLayout";
import { findLoreStrings, type LoreStringMatch } from "./snbtLoreScanner";

export { CompletionAdapter, SnbtCompletionAdapter } from "./completions";

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

// --- code actions ---

export class SnbtCodeActionAdapter implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.RefactorRewrite,
    ];

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        if (document.languageId !== "snbt") return [];

        const config = vscode.workspace.getConfiguration("htsw", document.uri);
        if (!config.get<boolean>("snbt.suggestLoreSplitting", false)) return [];
        const maxWidth = Math.max(8, config.get<number>("snbt.loreLineMaxWidth", 40));

        const text = document.getText();
        const matches = findLoreStrings(text);
        if (matches.length === 0) return [];

        const cursorOffset = document.offsetAt(range.start);
        const target = pickTarget(matches, cursorOffset);
        if (!target) return [];

        const layout = computeBestLayout(target.value, { maxLength: maxWidth });
        if (!layout.includes("\n")) return [];

        const lines = layout.split("\n");
        const quoted = lines.map((line) => quoteSnbtString(line, target.quote));

        const editRange = new vscode.Range(
            document.positionAt(target.start),
            document.positionAt(target.end),
        );

        // If the original string sits alone on its own line (only whitespace
        // before, only optional comma + whitespace after), put each split
        // entry on its own line at the same indent — matches how
        // multi-entry Lore arrays are typically formatted by hand. Otherwise
        // fall back to inline `, ` so we don't mangle a one-liner Lore.
        const startLineText = document.lineAt(editRange.start.line).text;
        const endLineText = document.lineAt(editRange.end.line).text;
        const prefixBeforeString = startLineText.slice(0, editRange.start.character);
        const suffixAfterString = endLineText.slice(editRange.end.character);
        const stringIsAlone =
            editRange.start.line === editRange.end.line &&
            /^\s*$/.test(prefixBeforeString) &&
            /^\s*,?\s*$/.test(suffixAfterString);

        const separator = stringIsAlone ? `,\n${prefixBeforeString}` : ", ";
        const replacement = quoted.join(separator);

        const action = new vscode.CodeAction(
            `Split lore line for optimal display (→ ${lines.length} lines)`,
            vscode.CodeActionKind.RefactorRewrite,
        );
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, editRange, replacement);

        return [action];
    }
}

function pickTarget(
    matches: LoreStringMatch[],
    cursorOffset: number,
): LoreStringMatch | undefined {
    // Prefer the string the cursor is actually inside (between the quotes,
    // inclusive of the quote chars themselves so a click on the opening
    // quote still triggers the action).
    return matches.find(
        (m) => cursorOffset >= m.start && cursorOffset <= m.end,
    );
}

function quoteSnbtString(text: string, quote: '"' | "'"): string {
    // Re-escape the same way the SNBT lexer reads it: backslash and the
    // chosen quote char need a leading backslash; control chars get the
    // standard \n / \r / \t shorthands so the output stays human-readable
    // and round-trips through the lexer's decodeEscape.
    let escaped = "";
    for (const ch of text) {
        if (ch === "\\") escaped += "\\\\";
        else if (ch === quote) escaped += "\\" + quote;
        else if (ch === "\n") escaped += "\\n";
        else if (ch === "\r") escaped += "\\r";
        else if (ch === "\t") escaped += "\\t";
        else escaped += ch;
    }
    return quote + escaped + quote;
}

// --- hover ---

// --- rename ---

// --- references ---
