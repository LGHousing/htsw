import * as languageFeatures from "./languageFeatures";
import { commands, Disposable, languages, TextEditorSelectionChangeKind, window, workspace } from "vscode";

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

        // Track when a text edit just happened so the selection-change
        // listener below can avoid firing `triggerSuggest` redundantly — the
        // text-change handler already calls it for letter input.
        let lastTextChangeAt = 0;
        providers.push(
            workspace.onDidChangeTextDocument((event) => {
                const editor = window.activeTextEditor;
                if (!editor || event.document !== editor.document) return;
                if (event.document.languageId !== "htsl") return;
                if (event.contentChanges.length !== 1) return;
                lastTextChangeAt = Date.now();

                const text = event.contentChanges[0].text;
                if (!/^[A-Za-z_]$/.test(text)) return;

                void commands.executeCommand("editor.action.triggerSuggest");
            })
        );

        // Tab through a snippet only moves the cursor — it doesn't insert
        // text, so `onDidChangeTextDocument` above never fires. We need a
        // separate listener so the popup shows for free at every tab stop.
        //
        // The trick: when VS Code lands on a `${N:placeholder}` tab stop, it
        // *auto-selects the placeholder text*. So we trigger on
        // selection-change events where a real (non-empty) selection appears
        // on a single line — that's almost always a snippet placeholder
        // landing. Plain cursor moves (arrow keys, mouse clicks past the
        // current word) give an *empty* selection and are deliberately
        // ignored to avoid popping a "No suggestions" tooltip on every
        // keystroke.
        //
        // This means an empty `${N}` tab stop won't auto-show the popup
        // (since there's no placeholder text to select). The fix is to keep
        // every required field in `actionSpecs.ts` using `${N:fieldName}`
        // form so VS Code has something to select on tab.
        providers.push(
            window.onDidChangeTextEditorSelection((event) => {
                if (event.textEditor.document.languageId !== "htsl") return;
                if (event.kind !== TextEditorSelectionChangeKind.Keyboard) return;
                if (event.selections.length !== 1) return;
                const sel = event.selections[0];
                // Skip empty cursors — this is what excludes arrow-key noise.
                if (sel.isEmpty) return;
                // Skip multi-line / huge selections — those are user
                // selection actions (Shift+End, Ctrl+A, etc.), not snippet
                // landings. 30 chars is generous for any reasonable
                // placeholder text.
                if (sel.start.line !== sel.end.line) return;
                if (sel.end.character - sel.start.character > 30) return;
                // Skip if a text change just fired the typing handler — no
                // need to trigger twice in the same beat.
                if (Date.now() - lastTextChangeAt < 50) return;

                void commands.executeCommand("editor.action.triggerSuggest");
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
