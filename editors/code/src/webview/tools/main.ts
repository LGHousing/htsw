import projectStyles from "../project/styles.css?inline";
import { mountProjectExplorer } from "../project/ui";
import type { ProjectExplorerPersistedState } from "../project/ui";
import type { ProjectImportableReveal } from "../protocol";
import itemStyles from "../itemEditor/styles.css?inline";
import { mountItemEditor, type ItemEditorLoad } from "../itemEditor/ui";
import soundStyles from "../soundPreviewer/styles.css?inline";
import { mountSoundPreviewer } from "../soundPreviewer/ui";
import shellStyles from "./styles.css?inline";
import { installTooltips } from "../tooltip";

type ActiveTool = "project" | "item" | "sound";
type ToolScrollState = Record<string, number>;
type WebviewState = {
    activeTool?: ActiveTool;
    project?: ProjectExplorerPersistedState;
    scroll?: Partial<Record<ActiveTool, ToolScrollState>>;
};

const vscode = acquireVsCodeApi<WebviewState>();
const root = document.getElementById("app");
let activeTool: ActiveTool = vscode.getState()?.activeTool ?? "project";
let pendingItemLoad: ItemEditorLoad | null = null;
const toolHosts = new Map<ActiveTool, HTMLElement>();
const toolDisposers = new Map<ActiveTool, () => void>();
const activeStyle = document.createElement("style");

if (root) {
    installTooltips();
    window.addEventListener("message", onShellMessage);
    renderShell();
    window.addEventListener("pagehide", disposeTools, { once: true });
}

function onShellMessage(event: MessageEvent): void {
    const message = event.data as ({ type?: string } & Partial<ProjectImportableReveal>) | undefined;
    if (message?.type === "loadItem") {
        pendingItemLoad = event.data as ItemEditorLoad;
        if (activeTool !== "item") {
            persistActiveScroll();
            activeTool = "item";
            vscode.setState({ ...(vscode.getState() ?? {}), activeTool });
        }
        showActiveTool();
        return;
    }

    if (message?.type !== "revealProjectImportable"
        || typeof message.importJsonPath !== "string"
        || typeof message.kind !== "string"
        || typeof message.identity !== "string") return;
    if (activeTool !== "project") persistActiveScroll();
    activeTool = "project";
    const state = vscode.getState() ?? {};
    vscode.setState({
        ...state,
        activeTool,
        project: {
            ...state.project,
            pendingReveal: {
                importJsonPath: message.importJsonPath,
                kind: message.kind as ProjectImportableReveal["kind"],
                identity: message.identity,
            },
        },
    });
    showActiveTool();
}

function renderShell(): void {
    if (!root) return;
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
    for (const tool of ["project", "item", "sound"] as const) {
        const host = document.createElement("div");
        host.className = "tools-view";
        host.dataset.tool = tool;
        host.hidden = true;
        toolHosts.set(tool, host);
        body.appendChild(host);
    }
    document.head.appendChild(activeStyle);
    showActiveTool();
}

function showActiveTool(): void {
    activeStyle.textContent = activeToolStyles(activeTool) + "\n" + shellStyles;
    for (const [tool, host] of toolHosts) host.hidden = tool !== activeTool;
    for (const tool of ["project", "item", "sound"] as const) {
        document.getElementById(`tab-${tool}`)?.classList.toggle("active", tool === activeTool);
    }

    const host = toolHosts.get(activeTool);
    if (!host) return;
    if (toolDisposers.has(activeTool)) {
        if (activeTool === "item") pendingItemLoad = null;
        return;
    }
    let dispose: () => void;
    if (activeTool === "project") {
        dispose = mountProjectExplorer(host, vscode, () => selectTool("item"), savedScroll("project").tree);
    } else if (activeTool === "item") {
        dispose = mountItemEditor(host, vscode, pendingItemLoad ?? undefined, savedScroll("item"));
        pendingItemLoad = null;
    } else {
        dispose = mountSoundPreviewer(host, vscode, savedScroll("sound").list);
    }
    toolDisposers.set(activeTool, dispose);
}

function selectTool(next: ActiveTool): void {
    if (activeTool === next) return;
    persistActiveScroll();
    activeTool = next;
    vscode.setState({ ...(vscode.getState() ?? {}), activeTool });
    showActiveTool();
}

function persistActiveScroll(): void {
    const state = vscode.getState() ?? {};
    const scroll = { ...(state.scroll ?? {}) };
    const host = toolHosts.get(activeTool);
    if (!host) return;
    if (activeTool === "project") {
        scroll.project = { tree: host.querySelector<HTMLElement>("#projectTree")?.scrollTop ?? 0 };
    } else if (activeTool === "item") {
        scroll.item = {
            page: host.querySelector<HTMLElement>(":scope > .app")?.scrollTop ?? 0,
            form: host.querySelector<HTMLElement>(".form-panel")?.scrollTop ?? 0,
            preview: host.querySelector<HTMLElement>(".preview-panel")?.scrollTop ?? 0,
        };
    } else {
        scroll.sound = { list: host.querySelector<HTMLElement>(".list")?.scrollTop ?? 0 };
    }
    vscode.setState({ ...state, scroll });
}

function savedScroll(tool: ActiveTool): ToolScrollState {
    return vscode.getState()?.scroll?.[tool] ?? {};
}

function disposeTools(): void {
    toolDisposers.forEach((dispose) => dispose());
    toolDisposers.clear();
}

function activeToolStyles(tool: ActiveTool): string {
    if (tool === "project") return projectStyles;
    if (tool === "item") return itemStyles;
    return soundStyles;
}
