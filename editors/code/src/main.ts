import * as languageFeatures from "./languageFeatures";
import { provideHtslCompletions } from "./completions";
import { commands, Disposable, languages, Position, Range, Selection, window, workspace } from "vscode";

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
        providers.push(
            languages.registerCompletionItemProvider(
                "snbt",
                new languageFeatures.SnbtCompletionAdapter(),
                ...HTSL_COMPLETION_TRIGGER_CHARACTERS,
                ":"
            )
        );

        let lastTextChangeAt = 0;
        let lastSelectionMutationAt = 0;
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
        // into the new position. We DELETE the selected snippet default before
        // triggering so (a) the dropdown's search filter is empty, and (b)
        // typing into the now-empty slot inserts cleanly instead of appending
        // alongside the placeholder text.
        providers.push(
            window.onDidChangeTextEditorSelection((event) => {
                if (Date.now() - lastSelectionMutationAt < 100) return;
                const doc = event.textEditor.document;
                if (doc.languageId !== "htsl") return;
                if (event.selections.length !== 1) return;
                const sel = event.selections[0];
                if (sel.isEmpty) return;
                if (sel.start.line !== sel.end.line) return;
                if (sel.end.character - sel.start.character > 30) return;
                if (Date.now() - lastTextChangeAt < 50) return;

                // Probe at the selection start with an empty typed prefix —
                // the snippet default text (e.g. `%placeholder%`) would
                // otherwise over-filter the gate and bail here.
                const linePrefix = doc.lineAt(sel.start.line).text.slice(0, sel.start.character);
                const documentPrefix = doc.getText(new Range(new Position(0, 0), sel.start));
                if (provideHtslCompletions(linePrefix, documentPrefix, "").length === 0) return;

                lastSelectionMutationAt = Date.now();
                const editor = event.textEditor;
                const range = new Range(sel.start, sel.end);

                void commands.executeCommand("hideSuggestWidget");
                void editor.edit(
                    (builder) => builder.delete(range),
                    { undoStopBefore: false, undoStopAfter: false },
                ).then((ok) => {
                    if (!ok) return;
                    setTimeout(() => {
                        void commands.executeCommand("editor.action.triggerSuggest");
                    }, 30);
                });
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
