import * as languageFeatures from "./languageFeatures";
import { provideHtslCompletions } from "./completions";
import {
    SnbtFormattingProvider,
    formatSnbtText,
    findEnclosingJsonString,
    decodeJsonStringContent,
    encodeJsonString,
} from "./snbtFormat";
import { commands, Disposable, languages, Position, Range, window, workspace } from "vscode";

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

        providers.push(
            languages.registerCodeActionsProvider(
                "snbt",
                new languageFeatures.SnbtCodeActionAdapter(),
                {
                    providedCodeActionKinds: languageFeatures.SnbtCodeActionAdapter.providedCodeActionKinds,
                }
            )
        );

        providers.push(
            languages.registerDocumentFormattingEditProvider(
                "snbt",
                new SnbtFormattingProvider()
            )
        );

        for (const lang of ["json", "jsonc"]) {
            providers.push(
                languages.registerCodeActionsProvider(
                    lang,
                    new languageFeatures.JsonSnbtCodeActionAdapter(),
                    {
                        providedCodeActionKinds:
                            languageFeatures.JsonSnbtCodeActionAdapter.providedCodeActionKinds,
                    }
                )
            );
        }

        providers.push(
            commands.registerCommand("htsw.snbt.format", () => formatSnbtCommand())
        );

        providers.push(
            commands.registerCommand("htsw.snbt.openFormattedPreview", async (text: string) => {
                const doc = await workspace.openTextDocument({ language: "snbt", content: text });
                await window.showTextDocument(doc, { preview: false });
            })
        );

        providers.push(
            workspace.onDidChangeTextDocument((event) => {
                const editor = window.activeTextEditor;
                if (!editor || event.document !== editor.document) return;
                if (event.document.languageId !== "htsl") return;
                if (event.contentChanges.length !== 1) return;

                const text = event.contentChanges[0].text;
                if (!/^[A-Za-z_]$/.test(text)) return;

                // Only trigger suggest if our provider has something to offer.
                // `editor.action.triggerSuggest` is an explicit invocation, so
                // VS Code displays "No suggestions" when nothing comes back.
                const sel = editor.selection;
                if (!sel.isEmpty) return;
                const pos = sel.active;
                const doc = editor.document;
                const linePrefix = doc.lineAt(pos.line).text.slice(0, pos.character);
                const documentPrefix = doc.getText(new Range(new Position(0, 0), pos));
                if (provideHtslCompletions(linePrefix, documentPrefix, "").length === 0) return;

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

async function formatSnbtCommand() {
    const editor = window.activeTextEditor;
    if (!editor) {
        void window.showInformationMessage("No active editor.");
        return;
    }

    const document = editor.document;

    if (document.languageId === "snbt") {
        await commands.executeCommand("editor.action.formatDocument");
        return;
    }

    const text = document.getText();
    const cursorOffset = document.offsetAt(editor.selection.active);
    const stringRange = findEnclosingJsonString(text, cursorOffset);

    if (!stringRange) {
        void window.showWarningMessage(
            "Place the cursor inside a string containing SNBT, or open a .snbt file."
        );
        return;
    }

    const inner = text.slice(stringRange.openQuote + 1, stringRange.closeQuote);
    const decoded = decodeJsonStringContent(inner);
    const result = formatSnbtText(decoded);

    if (!result.ok) {
        void window.showWarningMessage(`Not valid SNBT: ${result.error}`);
        return;
    }

    const choice = await window.showQuickPick(
        [
            { label: "Replace string with formatted SNBT (re-encoded)", value: "replace" as const },
            { label: "Open formatted SNBT in new editor", value: "open" as const },
        ],
        { placeHolder: "How would you like to format the SNBT?" }
    );
    if (!choice) return;

    if (choice.value === "open") {
        const doc = await workspace.openTextDocument({ language: "snbt", content: result.output });
        await window.showTextDocument(doc, { preview: false });
        return;
    }

    const replacement = encodeJsonString(result.output);
    await editor.edit((builder) => {
        builder.replace(
            new Range(
                document.positionAt(stringRange.openQuote),
                document.positionAt(stringRange.closeQuote + 1),
            ),
            replacement,
        );
    });
}
