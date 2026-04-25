import * as languageFeatures from "./languageFeatures";
import { provideHtslCompletions } from "./completions";
import { commands, Disposable, languages, Position, Range, TextEditorSelectionChangeKind, window, workspace } from "vscode";

const disposables: Disposable[] = [];
const providers: Disposable[] = [];
const HTSL_COMPLETION_TRIGGER_CHARACTERS = [
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_",
    " ",
    "\"",
    "%",
    ".",
    "/",
];

export function activate() {
    // context: ExtensionContext
    function registerProviders() {
        disposeAll(disposables);

        providers.push(
            languages.registerInlayHintsProvider(
                "htsl",
                new languageFeatures.InlayHintsAdapter()
            )
        );

        providers.push(
            languages.registerCompletionItemProvider(
                "htsl",
                new languageFeatures.CompletionAdapter(),
                ...HTSL_COMPLETION_TRIGGER_CHARACTERS
            )
        );

        let lastTextChangeAt = 0;
        providers.push(
            workspace.onDidChangeTextDocument((event) => {
                const editor = window.activeTextEditor;
                if (!editor || event.document !== editor.document) return;
                if (event.document.languageId !== "htsl") return;
                if (event.contentChanges.length !== 1) return;

                const text = event.contentChanges[0].text;
                if (!/^[A-Za-z_]$/.test(text)) return;

                lastTextChangeAt = Date.now();
                void commands.executeCommand("editor.action.triggerSuggest");
            })
        );

        // Auto-popup at each snippet placeholder. Hide any stale popup first
        // so Tab can't accept a leftover suggestion from the previous stop
        // into the new position.
        providers.push(
            window.onDidChangeTextEditorSelection((event) => {
                const doc = event.textEditor.document;
                if (doc.languageId !== "htsl") return;
                if (event.kind === TextEditorSelectionChangeKind.Mouse) return;
                if (event.selections.length !== 1) return;
                const sel = event.selections[0];
                if (sel.isEmpty) return;
                if (sel.start.line !== sel.end.line) return;
                if (sel.end.character - sel.start.character > 30) return;
                if (Date.now() - lastTextChangeAt < 50) return;

                const linePrefix = doc.lineAt(sel.active.line).text.slice(0, sel.active.character);
                const documentPrefix = doc.getText(new Range(new Position(0, 0), sel.active));
                const typedPrefix = doc.getText(sel).replace(/^%/, "").toLowerCase();
                if (provideHtslCompletions(linePrefix, documentPrefix, typedPrefix).length === 0) return;

                void commands.executeCommand("hideSuggestWidget");
                setTimeout(() => {
                    void commands.executeCommand("editor.action.triggerSuggest");
                }, 30);
            })
        );

        providers.push(new languageFeatures.DiagnosticsAdapter());
    }

    registerProviders();

    disposables.push(asDisposable(providers));
}

export function deactivate() {
    disposeAll(disposables);
}

function asDisposable(disposables: Disposable[]): Disposable {
    return { dispose: () => disposeAll(disposables) };
}

function disposeAll(disposables: Disposable[]) {
    while (disposables.length) {
        disposables.pop()!.dispose();
    }
}
