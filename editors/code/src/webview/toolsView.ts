import * as vscode from "vscode";
import { handleItemEditorMessage } from "./itemEditorView";
import { renderWebviewHtml } from "./html";
import {
    copyImportablePathFromContext,
    deleteImportJsonFromContext,
    deleteImportableFromContext,
    handleProjectMessage,
    moveImportableFromContext,
    renameImportableFromContext,
    revealImportableFromContext,
    type ImportJsonContext,
    type ImportableContext,
} from "./projectView";
import type { ItemEditorToHostMessage, ProjectToHostMessage, SoundPreviewToHostMessage } from "./protocol";
import { SoundPreviewController } from "./soundPreviewView";

type HtswToolsMessage = ProjectToHostMessage | ItemEditorToHostMessage | SoundPreviewToHostMessage;

const PROJECT_MESSAGE_TYPES = new Set([
    "requestProjectTree",
    "openProjectFile",
    "createIncludedImportJson",
    "addImportable",
    "moveImportable",
    "editImportableMetadata",
    "openItemInEditor",
]);
const ITEM_MESSAGE_TYPES = new Set(["requestImportTargets", "submitItem", "saveItem"]);

export class HtswToolsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "htsw.tools";
    private readonly soundController: SoundPreviewController;
    private webview: vscode.Webview | undefined;

    public constructor(
        private readonly extensionUri: vscode.Uri,
        globalStorageUri: vscode.Uri,
        globalState: vscode.Memento,
    ) {
        this.soundController = new SoundPreviewController(globalStorageUri, globalState);
    }

    public registerImportableCommands(): vscode.Disposable[] {
        return [
            vscode.commands.registerCommand("htsw.importable.move", async (context?: ImportableContext) => {
                if (!this.webview) return;
                await moveImportableFromContext(this.webview, context);
            }),
            vscode.commands.registerCommand("htsw.importable.rename", async (context?: ImportableContext) => {
                if (!this.webview) return;
                await renameImportableFromContext(this.webview, context);
            }),
            vscode.commands.registerCommand("htsw.importable.reveal", async (context?: ImportableContext) => {
                if (!this.webview) return;
                await revealImportableFromContext(this.webview, context);
            }),
            vscode.commands.registerCommand("htsw.importable.copyPath", async (context?: ImportableContext) => {
                if (!this.webview) return;
                await copyImportablePathFromContext(this.webview, context);
            }),
            vscode.commands.registerCommand("htsw.importable.delete", async (context?: ImportableContext) => {
                if (!this.webview) return;
                await deleteImportableFromContext(this.webview, context);
            }),
            vscode.commands.registerCommand("htsw.importJson.delete", async (context?: ImportJsonContext) => {
                if (!this.webview) return;
                await deleteImportJsonFromContext(this.webview, context);
            }),
        ];
    }

    public resolveWebviewView(view: vscode.WebviewView): void {
        this.webview = view.webview;
        view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, {
            scriptName: "tools.js",
            extraLocalResourceRoots: [this.soundController.cacheRootUri()],
        });

        view.webview.onDidReceiveMessage((message: HtswToolsMessage) => {
            if (PROJECT_MESSAGE_TYPES.has(message.type)) {
                void handleProjectMessage(view.webview, message as ProjectToHostMessage);
                return;
            }
            if (ITEM_MESSAGE_TYPES.has(message.type)) {
                void handleItemEditorMessage(view.webview, message as ItemEditorToHostMessage);
                return;
            }
            void this.soundController.handleMessage(view.webview, message as SoundPreviewToHostMessage);
        });

        // Re-push the tree when diagnostics change so the error/warning badges
        // track the editor live, like VS Code's explorer. Debounced because
        // diagnostics fire on every keystroke-parse; skipped while hidden.
        let diagTimer: ReturnType<typeof setTimeout> | undefined;
        const diagSub = vscode.languages.onDidChangeDiagnostics(() => {
            if (diagTimer) clearTimeout(diagTimer);
            diagTimer = setTimeout(() => {
                if (!view.visible) return;
                void handleProjectMessage(view.webview, { type: "requestProjectTree" });
            }, 750);
        });
        view.onDidDispose(() => {
            if (diagTimer) clearTimeout(diagTimer);
            diagSub.dispose();
            if (this.webview === view.webview) this.webview = undefined;
        });
    }
}
