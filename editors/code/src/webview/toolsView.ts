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
import { onDidChangeGitStatus } from "./gitDecorations";

type HtswToolsMessage = ProjectToHostMessage | ItemEditorToHostMessage | SoundPreviewToHostMessage;

const PROJECT_MESSAGE_TYPES = new Set([
    "requestProjectTree",
    "openProjectFile",
    "openImportableDeclaration",
    "createIncludedImportJson",
    "addImportable",
    "moveImportable",
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

    public async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
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
        // diagnostics fire on every keystroke-parse.
        let refreshTimer: ReturnType<typeof setTimeout> | undefined;
        let refreshPending = false;
        const refreshProjectTree = () => {
            void handleProjectMessage(view.webview, { type: "requestProjectTree" });
        };
        const debounceRefresh = (delay: number) => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                refreshTimer = undefined;
                if (!view.visible) {
                    refreshPending = true;
                    return;
                }
                refreshProjectTree();
            }, delay);
        };
        const diagSub = vscode.languages.onDidChangeDiagnostics(() => {
            debounceRefresh(750);
        });
        const gitSub = await onDidChangeGitStatus(() => {
            debounceRefresh(500);
        });
        const visibilitySub = view.onDidChangeVisibility(() => {
            if (!view.visible || !refreshPending) return;
            refreshPending = false;
            refreshProjectTree();
        });
        view.onDidDispose(() => {
            if (refreshTimer) clearTimeout(refreshTimer);
            diagSub.dispose();
            gitSub.dispose();
            visibilitySub.dispose();
            if (this.webview === view.webview) this.webview = undefined;
        });
    }
}
