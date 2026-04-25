import * as languageFeatures from "./languageFeatures";
import { commands, Disposable, languages, window, workspace } from "vscode";

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
            workspace.onDidChangeTextDocument((event) => {
                const editor = window.activeTextEditor;
                if (!editor || event.document !== editor.document) return;
                if (event.document.languageId !== "htsl") return;
                if (event.contentChanges.length !== 1) return;

                const text = event.contentChanges[0].text;
                if (!/^[A-Za-z_]$/.test(text)) return;

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
