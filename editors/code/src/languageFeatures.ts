import * as vscode from "vscode";
import * as htsl from "htsl/src";
import * as common from "htsl-editor-common/src";

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
    private listeners: { [uri: string]: vscode.Disposable } = Object.create(null);
    private diagnosticCollection: vscode.DiagnosticCollection =
        vscode.languages.createDiagnosticCollection("htsl");

    constructor() {
        const onModelAdded = (document: vscode.TextDocument) => {
            if (document.languageId !== "htsl") return;

            let handle: NodeJS.Timeout;
            const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document === document) {
                    clearTimeout(handle);
                    handle = setTimeout(() => this.validate(document), 500);
                }
            });

            const visibleSubscription = vscode.window.onDidChangeVisibleTextEditors(
                (editors) => {
                    if (editors.some((editor) => editor.document === document)) {
                        this.validate(document);
                    } else {
                        this.diagnosticCollection.set(document.uri, []);
                    }
                }
            );

            this.listeners[document.uri.toString()] = {
                dispose() {
                    changeSubscription.dispose();
                    visibleSubscription.dispose();
                    clearTimeout(handle);
                },
            };

            this.validate(document);
        };

        const onModelRemoved = (document: vscode.TextDocument) => {
            this.diagnosticCollection.set(document.uri, []);
            const key = document.uri.toString();
            if (this.listeners[key]) {
                this.listeners[key].dispose();
                delete this.listeners[key];
            }
        };

        this.disposables.push(vscode.workspace.onDidOpenTextDocument(onModelAdded));
        this.disposables.push(vscode.workspace.onDidCloseTextDocument(onModelRemoved));
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                vscode.workspace.textDocuments.forEach(onModelAdded);
            })
        );

        vscode.workspace.textDocuments.forEach(onModelAdded);
    }

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

    private validate(document: vscode.TextDocument) {
        const htslDiagnostics = htsl.diagnostics(document.getText());

        const markers = htslDiagnostics.map((diagnostic) => {
            const start = document.positionAt(diagnostic.span!!.start);
            const end = document.positionAt(diagnostic.span!!.end);

            return new vscode.Diagnostic(
                new vscode.Range(start, end),
                diagnostic.message,
                this.htslDiagnosticLevelToMarkerSeverity(diagnostic.level)
            );
        });

        this.diagnosticCollection.set(document.uri, markers);
    }

    private htslDiagnosticLevelToMarkerSeverity(
        severity: string
    ): vscode.DiagnosticSeverity {
        severity.split(""); // placeholder for logic, adjust if necessary
        return vscode.DiagnosticSeverity.Error;
    }
}

// --- hover ---

// --- rename ---

// --- references ---
