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
            await this.validateUriFromDisk(uri);
        }
    }

    private async validateUriFromDisk(uri: vscode.Uri) {
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

    private isImportJsonDocument(document: vscode.TextDocument): boolean {
        if (document.languageId !== "json" && document.languageId !== "jsonc") return false;
        const filePath = document.uri.fsPath.toLowerCase();
        return filePath.endsWith("import.json") || filePath.endsWith(".import.json");
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
