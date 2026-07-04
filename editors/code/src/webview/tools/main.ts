import projectStyles from "../project/styles.css?inline";
import { mountProjectExplorer } from "../project/ui";
import type { ProjectExplorerPersistedState } from "../project/ui";
import itemStyles from "../itemEditor/styles.css?inline";
import { mountItemEditor, type ItemEditorLoad } from "../itemEditor/ui";
import soundStyles from "../soundPreviewer/styles.css?inline";
import { mountSoundPreviewer } from "../soundPreviewer/ui";
import shellStyles from "./styles.css?inline";
import { installTooltips } from "../tooltip";

type ActiveTool = "project" | "item" | "sound";
type WebviewState = {
    activeTool?: ActiveTool;
    project?: ProjectExplorerPersistedState;
};

const vscode = acquireVsCodeApi<WebviewState>();
const root = document.getElementById("app");
let activeTool: ActiveTool = vscode.getState()?.activeTool ?? "project";
let disposeActive: (() => void) | null = null;
let activeStyle: HTMLStyleElement | null = null;
let pendingItemLoad: ItemEditorLoad | null = null;

if (root) {
    installTooltips();
    window.addEventListener("message", onShellMessage);
    renderShell();
}

// The host answers a project-tree item click with `loadItem`; the shell catches
// it here (whatever tab is showing), switches to the Item editor, and hands the
// parsed item to the mount. Other messages fall through to the active tool.
function onShellMessage(event: MessageEvent): void {
    const message = event.data as { type?: string } | undefined;
    if (message?.type !== "loadItem") return;
    pendingItemLoad = event.data as ItemEditorLoad;
    if (activeTool !== "item") {
        activeTool = "item";
        vscode.setState({ ...(vscode.getState() ?? {}), activeTool });
    }
    renderShell();
}

function renderShell(): void {
    if (!root) return;
    disposeActive?.();
    disposeActive = null;
    activeStyle?.remove();

    root.innerHTML = `
        <div class="tools-shell">
            <div class="tools-tabs">
                <button id="tab-project" class="tools-tab ${activeTool === "project" ? "active" : ""}" type="button">Importables</button>
                <button id="tab-item" class="tools-tab ${activeTool === "item" ? "active" : ""}" type="button">Item / SNBT</button>
                <button id="tab-sound" class="tools-tab ${activeTool === "sound" ? "active" : ""}" type="button">Sound Previewer</button>
            </div>
            <div id="tools-body" class="tools-body"></div>
        </div>
    `;

    document.getElementById("tab-project")?.addEventListener("click", () => selectTool("project"));
    document.getElementById("tab-item")?.addEventListener("click", () => selectTool("item"));
    document.getElementById("tab-sound")?.addEventListener("click", () => selectTool("sound"));

    const body = document.getElementById("tools-body");
    if (!body) return;

    activeStyle = document.createElement("style");
    activeStyle.textContent = activeToolStyles(activeTool) + "\n" + shellStyles;
    document.head.appendChild(activeStyle);

    if (activeTool === "project") {
        disposeActive = mountProjectExplorer(body, vscode, () => selectTool("item"));
    } else if (activeTool === "item") {
        disposeActive = mountItemEditor(body, vscode, pendingItemLoad ?? undefined);
        pendingItemLoad = null;
    } else {
        disposeActive = mountSoundPreviewer(body, vscode);
    }
}

function selectTool(next: ActiveTool): void {
    if (activeTool === next) return;
    activeTool = next;
    vscode.setState({ ...(vscode.getState() ?? {}), activeTool });
    renderShell();
}

function activeToolStyles(tool: ActiveTool): string {
    if (tool === "project") return projectStyles;
    if (tool === "item") return itemStyles;
    return soundStyles;
}
