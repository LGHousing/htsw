import * as htsw from "htsw";
import { ensureMinecraftFont, itemSpriteDataUri } from "../mcItem/render";
import type {
    ItemPreviewData,
    ProjectFromHostMessage,
    ProjectImportableMetadata,
    ProjectImportableReveal,
    ProjectImportableSub,
    ProjectImportableSummary,
    GitDecoration,
    ProjectImportJsonNode,
    ProjectTextSpan,
    ProjectToHostMessage,
} from "../protocol";

export type ProjectExplorerPersistedState = {
    expanded?: string[];
    query?: string;
    sort?: "default" | "name" | "type";
    selectedParent?: string;
    showCreate?: boolean;
    showAdd?: boolean;
    addKind?: ProjectImportableSummary["type"];
    addName?: string;
    pendingReveal?: ProjectImportableReveal;
};

type WebviewState = {
    activeTool?: unknown;
    project?: ProjectExplorerPersistedState;
};

type VsCodeApi = ReturnType<typeof acquireVsCodeApi<WebviewState>>;

type SortMode = NonNullable<ProjectExplorerPersistedState["sort"]>;

type ImportableKind = NonNullable<ProjectExplorerPersistedState["addKind"]>;

type ImportableSelectionPayload = {
    importJsonPath: string;
    importableKind: ProjectImportableSummary["type"];
    importableIdentity: string;
};

type State = {
    roots: ProjectImportJsonNode[];
    expanded: Set<string>;
    selection: Set<string>;
    selectionAnchor: string | null;
    importableIndex: Map<string, ImportableSelectionPayload & { label: string }>;
    query: string;
    sort: SortMode;
    selectedParent: string;
    showCreate: boolean;
    showAdd: boolean;
    addKind: ImportableKind;
    addName: string;
    pendingReveal: ProjectImportableReveal | undefined;
    workspaceName: string;
    status: { kind: "idle" | "ok" | "error"; text: string };
    loading: boolean;
};

const ADD_KINDS: { value: ImportableKind; label: string }[] = [
    { value: "function", label: "Function" },
    { value: "event", label: "Event" },
    { value: "region", label: "Region" },
    { value: "item", label: "Item" },
    { value: "menu", label: "Menu" },
    { value: "command", label: "Command" },
    { value: "npc", label: "NPC" },
];

const EVENT_NAMES = htsw.types.EVENTS as readonly string[];

const SORT_LABEL: Record<SortMode, string> = {
    default: "File order",
    name: "Name",
    type: "Type",
};

type RestoredProjectState = {
    expanded: string[] | undefined;
    query: string;
    sort: SortMode;
    selectedParent: string;
    showCreate: boolean;
    showAdd: boolean;
    addKind: ImportableKind;
    addName: string;
    pendingReveal: ProjectImportableReveal | undefined;
};

function restoreProjectState(saved: ProjectExplorerPersistedState | undefined): RestoredProjectState {
    const addKind = validImportableKind(saved?.addKind) ? saved.addKind : "function";
    let addName = typeof saved?.addName === "string" ? saved.addName : "";
    if (addKind === "event" && !EVENT_NAMES.includes(addName)) {
        addName = EVENT_NAMES[0] ?? "";
    }
    return {
        expanded: Array.isArray(saved?.expanded) ? saved.expanded.filter(isString) : undefined,
        query: typeof saved?.query === "string" ? saved.query : "",
        sort: validSortMode(saved?.sort) ? saved.sort : "default",
        selectedParent: typeof saved?.selectedParent === "string" ? saved.selectedParent : "",
        showCreate: saved?.showCreate === true,
        showAdd: saved?.showCreate === true ? false : saved?.showAdd === true,
        addKind,
        addName,
        pendingReveal: validImportableReveal(saved?.pendingReveal) ? saved.pendingReveal : undefined,
    };
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function validSortMode(value: unknown): value is SortMode {
    return value === "default" || value === "name" || value === "type";
}

function validImportableKind(value: unknown): value is ImportableKind {
    return ADD_KINDS.some((kind) => kind.value === value);
}

function validProjectImportableKind(value: unknown): value is ProjectImportableSummary["type"] {
    return value === "function"
        || value === "event"
        || value === "region"
        || value === "item"
        || value === "menu"
        || value === "command"
        || value === "npc"
        || value === "team"
        || value === "group";
}

function validImportableReveal(value: unknown): value is ProjectImportableReveal {
    if (typeof value !== "object" || value === null) return false;
    const reveal = value as Partial<ProjectImportableReveal>;
    return typeof reveal.importJsonPath === "string"
        && validProjectImportableKind(reveal.kind)
        && typeof reveal.identity === "string";
}

export function mountProjectExplorer(
    app: HTMLElement,
    vscode: VsCodeApi,
    onOpenItemEditor?: () => void,
    initialScrollTop = 0,
): () => void {
    ensureMinecraftFont();
    const persisted = restoreProjectState(vscode.getState()?.project);
    const hasPersistedExpanded = persisted.expanded !== undefined;
    const state: State = {
        roots: [],
        expanded: new Set(persisted.expanded ?? []),
        selection: new Set(),
        selectionAnchor: null,
        importableIndex: new Map(),
        query: persisted.query,
        sort: persisted.sort,
        selectedParent: persisted.selectedParent,
        showCreate: persisted.showCreate,
        showAdd: persisted.showAdd,
        addKind: persisted.addKind,
        addName: persisted.addName,
        pendingReveal: persisted.pendingReveal,
        workspaceName: "",
        status: { kind: "idle", text: "" },
        loading: true,
    };
    let drag: {
        anchor: string;
        pending: boolean;
        dragging: boolean;
        suppressClick: boolean;
        removeMouseUp?: () => void;
    } | null = null;
    let pendingScrollTop: number | undefined = initialScrollTop;

    const onMessage = (event: MessageEvent<ProjectFromHostMessage>) => {
        const message = event.data;
        if (message.type === "projectTree") {
            const hadRoots = state.roots.length > 0;
            const wasLoading = state.loading;
            state.roots = message.roots;
            state.workspaceName = message.workspaceName ?? "";
            state.loading = false;
            reconcileProjectTreeState(state);
            if (!hadRoots && !hasPersistedExpanded) seedExpanded(state);
            const revealedId = applyPendingReveal(state);
            persistProjectState();
            // Only a full re-render on the first load. Later updates (e.g. the
            // live diagnostics refresh) patch the tree in place so they don't
            // reset scroll or steal focus from the search box.
            if (wasLoading || revealedId !== null) render();
            else refreshTreeData();
            if (revealedId !== null) scrollImportableIntoView(revealedId);
            return;
        }

        if (message.type === "revealProjectImportable") {
            state.pendingReveal = message;
            persistProjectState();
            post(vscode, { type: "requestProjectTree", fresh: true });
            return;
        }

        if (message.type === "projectResult") {
            state.status = message.ok
                ? { kind: "ok", text: message.message }
                : { kind: "error", text: message.error };
            scheduleStatusDismiss(state.status.text, message.ok ? 5000 : 12000);
            if (message.ok && message.createdPath) {
                state.selectedParent = message.createdPath;
                state.expanded.add(message.createdPath);
                state.showCreate = false;
                persistProjectState();
                render();
                return;
            }
            renderStatus();
        }
    };

    // Status notices fade out on their own; errors linger longer so they can
    // still be read after a missed click.
    let statusDismissTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleStatusDismiss(text: string, delayMs: number): void {
        if (statusDismissTimer) clearTimeout(statusDismissTimer);
        statusDismissTimer = setTimeout(() => {
            if (state.status.text !== text) return;
            state.status = { kind: "idle", text: "" };
            renderStatus();
        }, delayMs);
    }

    function persistProjectState(): void {
        vscode.setState({
            ...(vscode.getState() ?? {}),
            project: {
                expanded: [...state.expanded],
                query: state.query,
                sort: state.sort,
                selectedParent: state.selectedParent,
                showCreate: state.showCreate,
                showAdd: state.showAdd,
                addKind: state.addKind,
                addName: state.addName,
                pendingReveal: state.pendingReveal,
            },
        });
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
    render();
    post(vscode, { type: "requestProjectTree" });
    return () => {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("keydown", onKeyDown);
    };

    function onKeyDown(event: KeyboardEvent): void {
        if (event.key !== "Escape" || state.selection.size === 0) return;
        state.selection.clear();
        state.selectionAnchor = null;
        renderTreeOnly();
    }

    function render(): void {
        const scroll = !state.loading && pendingScrollTop !== undefined
            ? pendingScrollTop
            : document.getElementById("projectTree")?.scrollTop ?? 0;
        app.innerHTML = `
            <div class="project-app">
                <div class="toolbar">
                    <div class="search">
                        ${SVG.search}
                        <input id="projectQuery" value="${escapeAttr(state.query)}" placeholder="Search importables…">
                    </div>
                    <button id="sortProject" class="icon-button" type="button" title="Sort: ${SORT_LABEL[state.sort]}">${SVG.sort}</button>
                    <button id="refreshProject" class="icon-button" type="button" title="Refresh">${SVG.refresh}</button>
                    <button id="toggleAdd" class="icon-button ${state.showAdd ? "active" : ""}" type="button" title="Add importable">${SVG.addImportable}</button>
                    <button id="toggleCreate" class="icon-button ${state.showCreate ? "active" : ""}" type="button" title="New folder">${SVG.plus}</button>
                </div>
                <div id="projectContext">${renderContext(state)}</div>
                ${renderAddPanel(state)}
                ${renderCreatePanel(state)}
                <div id="projectStatus" class="project-status"></div>
                <div id="projectTree" class="project-tree">
                    ${renderTree(state)}
                </div>
            </div>
        `;

        bind();
        renderStatus();
        const tree = document.getElementById("projectTree");
        if (tree) tree.scrollTop = scroll;
        if (!state.loading) pendingScrollTop = undefined;
        if (state.showCreate) {
            (document.getElementById("folderPath") as HTMLInputElement | null)?.focus();
        }
        if (state.showAdd) {
            (document.getElementById("addName") as HTMLInputElement | null)?.focus();
        }
    }

    function refreshTreeData(): void {
        renderTreeOnly();
        const context = document.getElementById("projectContext");
        if (context) context.innerHTML = renderContext(state);
    }

    function bind(): void {
        document.getElementById("refreshProject")?.addEventListener("click", () => {
            state.loading = true;
            renderTreeOnly();
            post(vscode, { type: "requestProjectTree", fresh: true });
        });

        document.getElementById("sortProject")?.addEventListener("click", () => {
            const order: SortMode[] = ["default", "name", "type"];
            state.sort = order[(order.indexOf(state.sort) + 1) % order.length];
            persistProjectState();
            render();
        });

        document.getElementById("toggleCreate")?.addEventListener("click", () => {
            state.showCreate = !state.showCreate;
            if (state.showCreate) state.showAdd = false;
            persistProjectState();
            render();
        });

        document.getElementById("toggleAdd")?.addEventListener("click", () => {
            state.showAdd = !state.showAdd;
            if (state.showAdd) state.showCreate = false;
            persistProjectState();
            render();
        });

        document.getElementById("addKind")?.addEventListener("change", (event) => {
            state.addKind = (event.target as HTMLSelectElement).value as ImportableKind;
            if (state.addKind === "event" && !EVENT_NAMES.includes(state.addName)) {
                state.addName = EVENT_NAMES[0] ?? "";
            }
            persistProjectState();
            render();
        });

        const addName = document.getElementById("addName") as HTMLInputElement | HTMLSelectElement | null;
        addName?.addEventListener("input", () => {
            state.addName = addName.value;
            persistProjectState();
        });
        addName?.addEventListener("change", () => {
            state.addName = addName.value;
            persistProjectState();
        });

        const addParent = document.getElementById("addParent") as HTMLSelectElement | null;
        addParent?.addEventListener("change", () => updateSelectedParent(addParent.value));

        document.getElementById("addImportableForm")?.addEventListener("submit", (event) => {
            event.preventDefault();
            if (state.addKind === "item") {
                state.showAdd = false;
                persistProjectState();
                onOpenItemEditor?.();
                render();
                return;
            }
            // Read the live field, not just state.addName: a freshly-opened
            // event form shows its first <option> selected before any change
            // event has synced state, so submitting would otherwise no-op.
            const nameField = document.getElementById("addName") as
                | HTMLInputElement
                | HTMLSelectElement
                | null;
            const identity = (nameField?.value ?? state.addName).trim();
            if (!state.selectedParent || !identity) return;
            state.status = { kind: "idle", text: "Adding…" };
            renderStatus();
            post(vscode, {
                type: "addImportable",
                importJsonPath: state.selectedParent,
                kind: state.addKind,
                identity,
            });
            state.addName = "";
            state.showAdd = false;
            persistProjectState();
            render();
        });

        document.getElementById("cancelAdd")?.addEventListener("click", () => {
            state.showAdd = false;
            persistProjectState();
            render();
        });

        const query = document.getElementById("projectQuery") as HTMLInputElement | null;
        query?.addEventListener("input", () => {
            state.query = query.value;
            persistProjectState();
            renderTreeOnly();
        });

        const parent = document.getElementById("parentImportJson") as HTMLSelectElement | null;
        parent?.addEventListener("change", () => {
            updateSelectedParent(parent.value);
        });

        document.getElementById("createFolderForm")?.addEventListener("submit", (event) => {
            event.preventDefault();
            const input = document.getElementById("folderPath") as HTMLInputElement | null;
            const folderPath = input?.value.trim() ?? "";
            if (!state.selectedParent || !folderPath) return;
            state.status = { kind: "idle", text: "Creating…" };
            renderStatus();
            post(vscode, {
                type: "createIncludedImportJson",
                parentImportJsonPath: state.selectedParent,
                folderPath,
            });
            if (input) input.value = "";
        });

        document.getElementById("cancelCreate")?.addEventListener("click", () => {
            state.showCreate = false;
            persistProjectState();
            render();
        });

        bindTree();
    }

    function bindTree(): void {
        const tree = document.getElementById("projectTree");
        // renderTreeOnly() reuses this container element (only its children are
        // rebuilt), so binding these once per element keeps the listeners from
        // stacking on every re-render. A full render() makes a fresh element,
        // which then binds once again.
        if (tree && tree.dataset.selectionBound !== "1") {
            tree.dataset.selectionBound = "1";
            tree.addEventListener("mousedown", (event) => {
                if (event.button !== 0) return;
                const row = selectableImportableRow(event.target);
                if (!row) return;
                const id = row.dataset.importableId;
                if (!id) return;
                drag = { anchor: id, pending: true, dragging: false, suppressClick: false };
                const onMouseUp = () => {
                    const wasDragging = drag?.dragging === true;
                    if (drag) drag.pending = false;
                    window.removeEventListener("mouseup", onMouseUp);
                    if (drag) drag.removeMouseUp = undefined;
                    // Sync data-vscode-context (used by the right-click menu) once,
                    // after the cheap per-move highlight updates during the drag.
                    if (wasDragging) renderTreeOnly();
                };
                drag.removeMouseUp = () => window.removeEventListener("mouseup", onMouseUp);
                window.addEventListener("mouseup", onMouseUp);
            });
            tree.addEventListener("mousemove", (event) => {
                if (!drag || (event.buttons & 1) === 0) return;
                const element = document.elementFromPoint(event.clientX, event.clientY);
                const row = selectableImportableRow(element);
                const id = row?.dataset.importableId;
                if (!id) return;
                const range = importableRange(drag.anchor, id);
                if (!range) return;
                drag.dragging = true;
                drag.suppressClick = true;
                state.selection = range;
                refreshSelectionHighlight();
            });
            tree.addEventListener("click", (event) => {
                const row = selectableImportableRow(event.target);
                if (!row && state.selection.size > 0) {
                    state.selection.clear();
                    state.selectionAnchor = null;
                    renderTreeOnly();
                }
            });
        }

        for (const button of document.querySelectorAll<HTMLButtonElement>("[data-toggle-node]")) {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                // A file node's fsPath or an importable's child list id — both are
                // just opaque keys into state.expanded.
                const key = button.dataset.toggleNode;
                if (!key) return;
                toggleExpanded(state, key);
                persistProjectState();
                renderTreeOnly();
            });
        }

        for (const row of document.querySelectorAll<HTMLElement>("[data-open-path]")) {
            row.addEventListener("click", (event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("button")) return;
                const importableId = row.dataset.importableId;
                if (importableId) {
                    if (drag?.suppressClick) {
                        drag.removeMouseUp?.();
                        drag = null;
                        return;
                    }
                    if (event.shiftKey) {
                        if (state.selectionAnchor) {
                            selectImportableRange(state.selectionAnchor, importableId);
                            return;
                        }
                        selectSingleImportable(importableId);
                    } else if (event.metaKey || event.ctrlKey) {
                        toggleImportableSelection(importableId);
                        return;
                    } else {
                        selectSingleImportable(importableId);
                    }
                    const importablePath = row.dataset.openPath;
                    if (importablePath) {
                        post(vscode, { type: "openProjectFile", fsPath: importablePath, preview: true });
                    } else {
                        openImportableDeclaration(row, true);
                    }
                    return;
                }
                const fsPath = row.dataset.openPath;
                if (!fsPath) return;
                // The caret + file-icon strip toggles an expandable node, giving
                // a bigger hit target than the caret alone; the label still opens.
                const togglePath = expandableTogglePath(row);
                if (togglePath && target?.closest(".row-icon")) {
                    toggleExpanded(state, togglePath);
                    persistProjectState();
                    renderTreeOnly();
                    return;
                }
                const parentPath = row.dataset.parentPath;
                if (parentPath) updateSelectedParent(parentPath);
                post(vscode, { type: "openProjectFile", fsPath, preview: true });
            });
            row.addEventListener("dblclick", (event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("button")) return;
                if (target?.closest(".row-icon") && expandableTogglePath(row)) return;
                const itemPath = row.dataset.itemPath;
                if (itemPath) {
                    post(vscode, { type: "openItemInEditor", snbtPath: itemPath });
                    return;
                }
                const fsPath = row.dataset.openPath;
                if (fsPath) {
                    post(vscode, { type: "openProjectFile", fsPath, preview: false });
                    return;
                }
                if (row.dataset.importableId) openImportableDeclaration(row, false);
            });
            row.addEventListener("contextmenu", () => {
                const importableId = row.dataset.importableId;
                if (!importableId || state.selection.has(importableId)) return;
                state.selection = new Set([importableId]);
                state.selectionAnchor = importableId;
                renderTreeOnly();
            });
        }

        for (const row of document.querySelectorAll<HTMLElement>("[data-jump-to]")) {
            row.addEventListener("click", () => {
                const fsPath = row.dataset.jumpTo;
                if (fsPath) jumpToHomeNode(fsPath);
            });
            row.addEventListener("dblclick", () => {
                const fsPath = row.dataset.jumpTo;
                if (fsPath) post(vscode, { type: "openProjectFile", fsPath, preview: false });
            });
        }

        for (const row of document.querySelectorAll<HTMLElement>("[data-import-json-field-path]")) {
            row.addEventListener("click", () => {
                const rawPath = row.dataset.importJsonFieldPath;
                if (rawPath === undefined) return;
                try {
                    const fieldPath = JSON.parse(rawPath) as unknown;
                    if (!Array.isArray(fieldPath) || !fieldPath.every((part) => typeof part === "string")) return;
                    openImportableDeclaration(row, true, fieldPath);
                } catch (_error) {
                    openImportableDeclaration(row, true);
                }
            });
        }

    }

    function openImportableDeclaration(
        row: HTMLElement,
        preview: boolean,
        fieldPath?: string[],
    ): void {
        const importJsonPath = row.dataset.importJsonPath;
        const kind = row.dataset.importableKind;
        const identity = row.dataset.importableIdentity;
        if (!importJsonPath || !validProjectImportableKind(kind) || identity === undefined) return;

        const message: Extract<ProjectToHostMessage, { type: "openImportableDeclaration" }> = {
            type: "openImportableDeclaration",
            importJsonPath,
            kind,
            identity,
            preview,
        };
        if (fieldPath !== undefined) message.fieldPath = fieldPath;
        const declarationSpan = declarationSpanFromRow(row);
        if (declarationSpan !== undefined) message.declarationSpan = declarationSpan;
        post(vscode, message);
    }

    function declarationSpanFromRow(row: HTMLElement): ProjectTextSpan | undefined {
        const start = Number(row.dataset.declarationStart);
        const end = Number(row.dataset.declarationEnd);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return undefined;
        return { start, end };
    }

    function selectableImportableRow(target: EventTarget | Element | null): HTMLElement | null {
        if (!(target instanceof Element)) return null;
        const row = target.closest<HTMLElement>(".row.imp[data-importable-id]");
        if (!row) return null;
        return importableContextIsSelectable(row) ? row : null;
    }

    function importableContextIsSelectable(row: HTMLElement): boolean {
        try {
            const context = JSON.parse(row.dataset.vscodeContext ?? "{}") as { webviewSection?: unknown };
            return context.webviewSection === "importable";
        } catch (_err) {
            return false;
        }
    }

    function orderedImportableIds(): string[] {
        return Array.from(document.querySelectorAll<HTMLElement>(".row.imp[data-importable-id]"))
            .map((row) => row.dataset.importableId)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
    }

    function selectSingleImportable(id: string): void {
        state.selection = new Set([id]);
        state.selectionAnchor = id;
        renderTreeOnly();
    }

    function toggleImportableSelection(id: string): void {
        const next = new Set(state.selection);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        state.selection = next;
        state.selectionAnchor = id;
        renderTreeOnly();
    }

    function importableRange(anchor: string, current: string): Set<string> | null {
        const ids = orderedImportableIds();
        const start = ids.indexOf(anchor);
        const end = ids.indexOf(current);
        if (start < 0 || end < 0) return null;
        const [from, to] = start <= end ? [start, end] : [end, start];
        return new Set(ids.slice(from, to + 1));
    }

    function selectImportableRange(anchor: string, current: string): void {
        const range = importableRange(anchor, current);
        if (!range) {
            selectSingleImportable(current);
            return;
        }
        state.selection = range;
        renderTreeOnly();
    }

    // Toggle the highlight class in place — used during a drag so we don't
    // rebuild the whole tree (and rebind every listener) on each mousemove.
    function refreshSelectionHighlight(): void {
        for (const row of document.querySelectorAll<HTMLElement>(".row.imp[data-importable-id]")) {
            const id = row.dataset.importableId;
            row.classList.toggle("selected", id !== undefined && state.selection.has(id));
        }
    }

    // Reveal the expandable "home" appearance of an import.json that a reference
    // row points at: expand its ancestor chain, re-render, scroll, flash.
    function jumpToHomeNode(fsPath: string): void {
        const chain = ancestorChain(state.roots, fsPath);
        if (!chain) return;
        for (const node of chain) state.expanded.add(node.fsPath);
        state.expanded.add(fsPath);
        persistProjectState();
        renderTreeOnly();
        const rows = document.querySelectorAll<HTMLElement>(`[data-open-path]`);
        for (const candidate of rows) {
            if (candidate.dataset.openPath !== fsPath || !candidate.classList.contains("file")) continue;
            flashRowIntoView(candidate);
            return;
        }
    }

    function scrollImportableIntoView(id: string): void {
        for (const row of document.querySelectorAll<HTMLElement>(".row.imp[data-importable-id]")) {
            if (row.dataset.importableId !== id) continue;
            flashRowIntoView(row);
            return;
        }
    }

    function flashRowIntoView(row: HTMLElement): void {
        row.scrollIntoView({ block: "center" });
        row.classList.add("jump-flash");
        setTimeout(() => row.classList.remove("jump-flash"), 1200);
    }

    function renderTreeOnly(): void {
        const tree = document.getElementById("projectTree");
        if (!tree) return;
        const scroll = tree.scrollTop;
        tree.innerHTML = renderTree(state);
        tree.scrollTop = scroll;
        bindTree();
    }

    function renderStatus(): void {
        const status = document.getElementById("projectStatus");
        if (!status) return;
        status.className = `project-status ${state.status.kind}`;
        status.textContent = state.status.text;
        status.title = state.status.text;
    }

    function updateSelectedParent(fsPath: string): void {
        state.selectedParent = fsPath;
        persistProjectState();
        const parent = document.getElementById("parentImportJson") as HTMLSelectElement | null;
        if (parent) parent.value = fsPath;
        for (const row of document.querySelectorAll<HTMLElement>(".row.file")) {
            row.classList.toggle("selected", row.dataset.parentPath === fsPath);
        }
    }

}

function renderCreatePanel(state: State): string {
    if (!state.showCreate) return "";
    return `
        <form id="createFolderForm" class="create-panel">
            <div class="create-title">New folder</div>
            <p class="create-hint">Creates a folder with an empty <code>import.json</code> and adds it to the chosen file's <code>include</code> list. Pick the parent from the dropdown, or by clicking an <code>import.json</code> in the tree.</p>
            <label class="create-field">
                <span>Include from</span>
                <select id="parentImportJson">${parentOptions(state).join("")}</select>
            </label>
            <label class="create-field">
                <span>Folder</span>
                <input id="folderPath" placeholder="functions/clocks" autocomplete="off">
            </label>
            <div class="create-actions">
                <button id="cancelCreate" class="secondary" type="button">Cancel</button>
                <button type="submit">Create</button>
            </div>
        </form>
    `;
}

function renderAddPanel(state: State): string {
    if (!state.showAdd) return "";
    const isItem = state.addKind === "item";
    const isEvent = state.addKind === "event";
    const typeOptions = ADD_KINDS.map((kind) =>
        `<option value="${kind.value}" ${kind.value === state.addKind ? "selected" : ""}>${kind.label}</option>`
    ).join("");

    let identityField: string;
    if (isItem) {
        identityField = `<p class="create-hint">Items have a dedicated editor (icon, name, lore, enchants). “Open Item Editor” switches to the Item / SNBT tab.</p>`;
    } else if (isEvent) {
        const options = EVENT_NAMES.map((name) =>
            `<option value="${escapeAttr(name)}" ${name === state.addName ? "selected" : ""}>${escapeHtml(name)}</option>`
        ).join("");
        identityField = `
            <label class="create-field">
                <span>Event</span>
                <select id="addName">${options}</select>
            </label>`;
    } else {
        identityField = `
            <label class="create-field">
                <span>Name</span>
                <input id="addName" value="${escapeAttr(state.addName)}" placeholder="${escapeAttr(namePlaceholder(state.addKind))}" autocomplete="off">
            </label>`;
    }

    return `
        <form id="addImportableForm" class="create-panel">
            <div class="create-title">Add importable</div>
            <p class="create-hint">Adds the entry to the chosen <code>import.json</code> — plus a starter <code>.htsl</code> for functions and events.</p>
            <label class="create-field">
                <span>In file</span>
                <select id="addParent">${parentOptions(state).join("")}</select>
            </label>
            <label class="create-field">
                <span>Type</span>
                <select id="addKind">${typeOptions}</select>
            </label>
            ${identityField}
            <div class="create-actions">
                <button id="cancelAdd" class="secondary" type="button">Cancel</button>
                <button type="submit">${isItem ? "Open Item Editor" : "Add"}</button>
            </div>
        </form>
    `;
}

function namePlaceholder(kind: ImportableKind): string {
    if (kind === "function") return "my_function";
    if (kind === "region") return "spawn";
    if (kind === "menu") return "shop";
    if (kind === "command") return "visit";
    if (kind === "npc") return "guide";
    return "name";
}

function renderContext(state: State): string {
    if (state.loading || !state.workspaceName) return "";
    const count = state.roots.length;
    const label = count === 1 ? "1 import.json root" : `${count} import.json roots`;
    return `
        <div class="project-context" title="${escapeAttr(state.workspaceName)}">
            ${SVG.folder}
            <span class="ctx-name">${escapeHtml(state.workspaceName)}</span>
            <span class="ctx-meta">${escapeHtml(label)}</span>
        </div>
    `;
}

function pruneSelection(state: State): void {
    for (const id of state.selection) {
        if (!state.importableIndex.has(id)) state.selection.delete(id);
    }
    if (state.selectionAnchor !== null && !state.importableIndex.has(state.selectionAnchor)) {
        state.selectionAnchor = null;
    }
}

function renderTree(state: State): string {
    if (state.loading) return emptyState("Loading import.json tree…");
    if (state.roots.length === 0) return emptyState("No import.json files found in this workspace.");
    const query = state.query.trim().toLowerCase();
    state.importableIndex = new Map();
    try {
        const rows = sortNodes(state.roots, state.sort)
            .filter((root) => nodeMatches(root, query))
            .map((root) => renderNode(root, state, 0, true, query))
            .join("");
        pruneSelection(state);
        return rows || emptyState("No matching importables.");
    } catch (err) {
        return emptyState(`Failed to render tree: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function emptyState(text: string): string {
    return `<div class="project-empty">${escapeHtml(text)}</div>`;
}

function renderNode(
    node: ProjectImportJsonNode,
    state: State,
    depth: number,
    root: boolean,
    query: string,
): string {
    if (node.reference) {
        return `
            <div class="row file reference" data-jump-to="${escapeAttr(node.fsPath)}"
                title="${escapeAttr(`${node.label}\nAlso included here - click to jump to its contents`)}">
                ${indentGuides(depth)}
                <span class="twisty empty"></span>
                <span class="row-icon json">${SVG.braces}</span>
                <span class="row-label ${diagClass(node.errors, node.warnings)} ${gitClass(node.git)}">${escapeHtml(node.label)}</span>
                <span class="row-jump">↩</span>
                ${diagBadge(node.errors, node.warnings)}
                ${gitBadge(node.git)}
                ${gitRollupBadge(node.gitRollup)}
                <span class="row-count">${node.importableCount}</span>
            </div>
        `;
    }
    const expanded = query.length > 0 || state.expanded.has(node.fsPath);
    const visibleChildren = sortNodes(node.children, state.sort).filter((child) => nodeMatches(child, query));
    const visibleImportables = sortImportables(node.importables, state.sort)
        .filter((entry) => importableMatches(entry, query));
    const hasChildren = visibleChildren.length > 0 || visibleImportables.length > 0;
    const selected = state.selectedParent === node.fsPath;
    const problem = node.missing || node.cycle;
    const count = subtreeCount(node);
    const badge = node.missing ? "missing" : node.cycle ? "cycle" : String(count);
    const row = `
        <div class="row file ${root ? "root" : ""} ${selected ? "selected" : ""} ${problem ? "problem" : ""}"
            data-open-path="${escapeAttr(node.fsPath)}"
            data-parent-path="${escapeAttr(node.fsPath)}"
            data-vscode-context="${escapeAttr(importJsonContext(node))}"
            title="${escapeAttr(node.label)}">
            ${indentGuides(depth)}
            <button class="twisty ${hasChildren ? "" : "empty"} ${expanded ? "open" : ""}" type="button"
                data-toggle-node="${escapeAttr(node.fsPath)}" ${hasChildren ? "" : "disabled"}>${SVG.chevron}</button>
            <span class="row-icon json">${SVG.braces}</span>
            <span class="row-label ${diagClass(node.errors, node.warnings)} ${gitClass(node.git)}">${escapeHtml(node.label)}</span>
            ${diagBadge(node.errors, node.warnings)}
            ${gitBadge(node.git)}
            ${gitRollupBadge(node.gitRollup)}
            <span class="row-count ${problem ? "problem" : ""}">${escapeHtml(badge)}</span>
        </div>
    `;
    if (!expanded) return row;
    return row +
        visibleChildren.map((child) => renderNode(child, state, depth + 1, false, query)).join("") +
        visibleImportables.map((entry) => renderImportable(entry, depth + 1, state, query, node.fsPath)).join("");
}

function importJsonContext(node: ProjectImportJsonNode): string {
    const context: {
        webviewSection: string;
        preventDefaultContextMenuItems: boolean;
        importJsonPath: string;
        parentImportJsonPath?: string;
    } = {
        webviewSection: "importJson",
        preventDefaultContextMenuItems: true,
        importJsonPath: node.fsPath,
    };
    if (node.parentFsPath !== undefined) context.parentImportJsonPath = node.parentFsPath;
    return JSON.stringify(context);
}

function renderImportable(
    entry: ProjectImportableSummary,
    depth: number,
    state: State,
    query: string,
    declaringPath: string,
): string {
    const subs = entry.subEntries ?? [];
    const metadata = entry.metadataEntries ?? [];
    const hasChildren = subs.length > 0 || metadata.length > 0;
    const expanded = hasChildren && (query.length > 0 || state.expanded.has(entry.id));
    state.importableIndex.set(entry.id, {
        importJsonPath: declaringPath,
        importableKind: entry.type,
        importableIdentity: entry.identity,
        label: entry.label,
    });
    const selected = state.selection.has(entry.id);
    const itemPath = entry.type === "item" ? entry.sourcePath : undefined;
    const itemAttrs = itemPath ? ` data-item-path="${escapeAttr(itemPath)}"` : "";
    const row = `
        <div class="row imp ${entry.type} ${selected ? "selected" : ""}" data-open-path="${escapeAttr(entry.sourcePath ?? "")}"
            data-importable-id="${escapeAttr(entry.id)}"
            ${importableDeclarationAttrs(entry, declaringPath)}
            data-vscode-context="${escapeAttr(importableContext(entry, declaringPath, state))}"${itemAttrs}
            title="${escapeAttr(importableTooltip(entry))}">
            ${indentGuides(depth)}
            <button class="twisty ${hasChildren ? "" : "empty"} ${expanded ? "open" : ""}" type="button"
                data-toggle-node="${escapeAttr(entry.id)}" ${hasChildren ? "" : "disabled"}>${SVG.chevron}</button>
            ${importableIcon(entry)}
            <span class="row-label ${diagClass(entry.errors, entry.warnings)} ${gitClass(entry.git)}">${escapeHtml(entry.label)}</span>
            ${diagBadge(entry.errors, entry.warnings)}
            ${gitBadge(entry.git)}
            <span class="row-type">${escapeHtml(entry.typeLabel)}</span>
        </div>
    `;
    if (!expanded) return row;
    return row +
        subs.map((sub) => renderSubEntry(sub, depth + 1)).join("") +
        metadata.map((field) => renderMetadataEntry(field, entry, declaringPath, depth + 1)).join("");
}

function importableContext(entry: ProjectImportableSummary, importJsonPath: string, state: State): string {
    const context: {
        webviewSection: string;
        preventDefaultContextMenuItems: boolean;
        importJsonPath: string;
        importableKind: ProjectImportableSummary["type"];
        importableIdentity: string;
        selectedImportables?: ImportableSelectionPayload[];
    } = {
        webviewSection: "importable",
        preventDefaultContextMenuItems: true,
        importJsonPath,
        importableKind: entry.type,
        importableIdentity: entry.identity,
    };
    if (state.selection.has(entry.id) && state.selection.size > 1) {
        context.selectedImportables = [...state.selection]
            .map((id) => state.importableIndex.get(id))
            .filter((item): item is ImportableSelectionPayload & { label: string } => item !== undefined)
            .map(({ importJsonPath: selectedPath, importableKind, importableIdentity }) => ({
                importJsonPath: selectedPath,
                importableKind,
                importableIdentity,
            }));
    }
    return JSON.stringify(context);
}

function renderSubEntry(sub: ProjectImportableSub, depth: number): string {
    const item = sub.kind === "item" ? sub.item : undefined;
    const icon = item ? itemRowIcon(item) : `<span class="row-icon sub ${sub.kind}">${SUB_GLYPH[sub.kind]}</span>`;
    // Item subs open the visual editor on click (data-item-path).
    const itemAttrs = item ? ` data-item-path="${escapeAttr(sub.fsPath)}"` : "";
    return `
        <div class="row sub" data-open-path="${escapeAttr(sub.fsPath)}"${itemAttrs}
            title="${escapeAttr(`${sub.label}\n${baseName(sub.fsPath)}`)}">
            ${indentGuides(depth)}
            <span class="twisty empty"></span>
            ${icon}
            <span class="row-label ${diagClass(sub.errors, sub.warnings)} ${gitClass(sub.git)}">${escapeHtml(sub.label)}</span>
            ${diagBadge(sub.errors, sub.warnings)}
            ${gitBadge(sub.git)}
            <span class="row-type">${escapeHtml(baseName(sub.fsPath))}</span>
        </div>
    `;
}

function renderMetadataEntry(
    field: ProjectImportableMetadata,
    entry: ProjectImportableSummary,
    declaringPath: string,
    depth: number,
): string {
    return `
        <div class="row metadata"
            data-import-json-field-path="${escapeAttr(JSON.stringify(field.jsonPath))}"
            ${importableDeclarationAttrs(entry, declaringPath)}
            title="${escapeAttr(`${field.label}: ${field.value}\nClick to reveal in import.json`)}">
            ${indentGuides(depth)}
            <span class="twisty empty"></span>
            <span class="row-icon metadata">${SVG.metadata}</span>
            <span class="metadata-label">${escapeHtml(field.label)}</span>
            <span class="metadata-value">${escapeHtml(field.value)}</span>
        </div>
    `;
}

function importableDeclarationAttrs(entry: ProjectImportableSummary, declaringPath: string): string {
    const span = entry.declarationSpan;
    const spanAttrs = span === undefined
        ? ""
        : ` data-declaration-start="${span.start}" data-declaration-end="${span.end}"`;
    return `data-import-json-path="${escapeAttr(declaringPath)}" data-importable-kind="${escapeAttr(entry.type)}" data-importable-identity="${escapeAttr(entry.identity)}"${spanAttrs}`;
}

function baseName(fsPath: string): string {
    const parts = fsPath.split(/[\\/]/);
    return parts[parts.length - 1] ?? fsPath;
}

function importableIcon(entry: ProjectImportableSummary): string {
    const uri = entry.iconItem ? itemSpriteDataUri(entry.iconItem, entry.iconMeta ?? 0) : null;
    if (uri) {
        const count = entry.iconCount !== undefined && entry.iconCount > 1
            ? `<span class="row-icon-count">${entry.iconCount}</span>`
            : "";
        return `<span class="row-icon mc"><img src="${uri}" alt="" draggable="false">${count}</span>`;
    }
    return `<span class="row-icon glyph ${entry.type}">${TYPE_GLYPH[entry.type]}</span>`;
}

// An item sub-row (menu slot, npc armor) shows the real sprite when we could
// resolve it, else the generic item glyph.
function itemRowIcon(item: ItemPreviewData): string {
    const uri = itemSpriteDataUri(item.itemId, item.metadata);
    if (uri) {
        return `<span class="row-icon mc"><img src="${uri}" alt="" draggable="false"></span>`;
    }
    return `<span class="row-icon sub item">${SUB_GLYPH.item}</span>`;
}

function importableTooltip(entry: ProjectImportableSummary): string {
    return `${entry.label}\n${entry.typeLabel}`;
}

function indentGuides(depth: number): string {
    let out = "";
    for (let i = 0; i < depth; i++) out += `<span class="indent"></span>`;
    return out;
}

// The toggle path of a row's expand caret, or null for a leaf (importable or
// childless import.json). Lets the icon strip share the caret's toggle action.
function expandableTogglePath(row: HTMLElement): string | null {
    const toggle = row.querySelector<HTMLButtonElement>("[data-toggle-node]:not([disabled])");
    return toggle?.dataset.toggleNode ?? null;
}

function diagClass(errors?: number, warnings?: number): string {
    if (errors && errors > 0) return "has-error";
    if (warnings && warnings > 0) return "has-warning";
    return "";
}

function diagBadge(errors?: number, warnings?: number): string {
    const errorCount = errors ?? 0;
    const warningCount = warnings ?? 0;
    if (errorCount === 0 && warningCount === 0) return "";
    const kind = errorCount > 0 ? "error" : "warning";
    const shown = errorCount > 0 ? errorCount : warningCount;
    const tip = `${errorCount} error${errorCount === 1 ? "" : "s"}, ` +
        `${warningCount} warning${warningCount === 1 ? "" : "s"}`;
    return `<span class="diag-badge ${kind}" title="${escapeAttr(tip)}">${shown}</span>`;
}

function sortNodes(nodes: ProjectImportJsonNode[], sort: SortMode): ProjectImportJsonNode[] {
    if (sort === "default") return nodes;
    return [...nodes].sort((left, right) => left.label.localeCompare(right.label));
}

function sortImportables(entries: ProjectImportableSummary[], sort: SortMode): ProjectImportableSummary[] {
    if (sort === "default") return entries;
    if (sort === "name") return [...entries].sort((a, b) => a.label.localeCompare(b.label));
    return [...entries].sort((a, b) =>
        a.typeLabel.localeCompare(b.typeLabel) || a.label.localeCompare(b.label));
}

function parentOptions(state: State): string[] {
    const nodes = flattenNodes(state.roots);
    if (!state.selectedParent && nodes[0]) state.selectedParent = nodes[0].fsPath;
    return nodes.map((node) => `
        <option value="${escapeAttr(node.fsPath)}" ${node.fsPath === state.selectedParent ? "selected" : ""}>
            ${escapeHtml(node.label)}
        </option>
    `);
}

function flattenNodes(nodes: ProjectImportJsonNode[]): ProjectImportJsonNode[] {
    const out: ProjectImportJsonNode[] = [];
    const seen = new Set<string>();
    const visit = (node: ProjectImportJsonNode): void => {
        if (!node.missing && !node.cycle && !node.reference && !seen.has(node.fsPath)) {
            seen.add(node.fsPath);
            out.push(node);
        }
        node.children.forEach(visit);
    };
    nodes.forEach(visit);
    return out;
}

function reconcileProjectTreeState(state: State): void {
    const nodes = flattenNodes(state.roots);
    if (!nodes.some((node) => node.fsPath === state.selectedParent)) {
        state.selectedParent = nodes[0]?.fsPath ?? "";
    }
    const validKeys = expandedStateKeys(state.roots);
    state.expanded = new Set([...state.expanded].filter((key) => validKeys.has(key)));
}

function applyPendingReveal(state: State): string | null {
    const target = state.pendingReveal;
    if (target === undefined) return null;
    const found = findImportable(state.roots, target);
    if (found === null) return null;

    for (const ancestor of ancestorChain(state.roots, found.node.fsPath) ?? []) {
        state.expanded.add(ancestor.fsPath);
    }
    state.expanded.add(found.node.fsPath);
    state.query = "";
    state.selection = new Set([found.entry.id]);
    state.selectionAnchor = found.entry.id;
    state.pendingReveal = undefined;
    return found.entry.id;
}

function findImportable(
    roots: ProjectImportJsonNode[],
    target: ProjectImportableReveal,
): { node: ProjectImportJsonNode; entry: ProjectImportableSummary } | null {
    const targetPath = normalizedFsPath(target.importJsonPath);
    const visit = (
        node: ProjectImportJsonNode,
    ): { node: ProjectImportJsonNode; entry: ProjectImportableSummary } | null => {
        if (!node.reference && normalizedFsPath(node.fsPath) === targetPath) {
            const entry = node.importables.find((candidate) =>
                candidate.type === target.kind && candidate.identity === target.identity
            );
            if (entry !== undefined) return { node, entry };
        }
        for (const child of node.children) {
            const found = visit(child);
            if (found !== null) return found;
        }
        return null;
    };
    for (const root of roots) {
        const found = visit(root);
        if (found !== null) return found;
    }
    return null;
}

function normalizedFsPath(fsPath: string): string {
    const windowsPath = fsPath.includes("\\") || /^[a-z]:[\\/]/i.test(fsPath);
    const normalized = fsPath.replaceAll("\\", "/");
    return windowsPath ? normalized.toLowerCase() : normalized;
}

function expandedStateKeys(nodes: ProjectImportJsonNode[]): Set<string> {
    const keys = new Set<string>();
    const visit = (node: ProjectImportJsonNode): void => {
        if (node.reference) return;
        keys.add(node.fsPath);
        for (const entry of node.importables) {
            if ((entry.subEntries ?? []).length > 0 || (entry.metadataEntries ?? []).length > 0) keys.add(entry.id);
        }
        node.children.forEach(visit);
    };
    nodes.forEach(visit);
    return keys;
}

// Depth-first path from a root down to the home (non-reference) node for the
// given file, or null if the file only appears as references/missing.
function ancestorChain(
    roots: ProjectImportJsonNode[],
    fsPath: string,
): ProjectImportJsonNode[] | null {
    const walk = (
        node: ProjectImportJsonNode,
        trail: ProjectImportJsonNode[],
    ): ProjectImportJsonNode[] | null => {
        if (node.reference) return null;
        if (node.fsPath === fsPath) return trail;
        for (const child of node.children) {
            const found = walk(child, [...trail, node]);
            if (found) return found;
        }
        return null;
    };
    for (const root of roots) {
        const found = walk(root, []);
        if (found) return found;
    }
    return null;
}

function seedExpanded(state: State): void {
    for (const root of state.roots) {
        if (!root.reference) state.expanded.add(root.fsPath);
        for (const child of root.children) {
            if (!child.reference) state.expanded.add(child.fsPath);
        }
    }
}

function toggleExpanded(state: State, fsPath: string): void {
    if (state.expanded.has(fsPath)) {
        state.expanded.delete(fsPath);
    } else {
        state.expanded.add(fsPath);
    }
}

// Reference children are excluded so a shared module counts once toward every
// ancestor badge; the reference row itself still shows the subtree's count.
function subtreeCount(node: ProjectImportJsonNode): number {
    return node.importableCount + node.children.reduce(
        (total, child) => total + (child.reference ? 0 : subtreeCount(child)),
        0,
    );
}

function nodeMatches(node: ProjectImportJsonNode, query: string): boolean {
    if (!query) return true;
    if (`${node.label} ${node.name}`.toLowerCase().includes(query)) return true;
    return node.importables.some((entry) => importableMatches(entry, query)) ||
        node.children.some((child) => nodeMatches(child, query));
}

function importableMatches(entry: ProjectImportableSummary, query: string): boolean {
    if (!query) return true;
    const subs = (entry.subEntries ?? []).map((sub) => sub.label).join(" ");
    const metadata = (entry.metadataEntries ?? [])
        .map((field) => `${field.label} ${field.value}`)
        .join(" ");
    return `${entry.label} ${entry.typeLabel} ${entry.type} ${subs} ${metadata}`.toLowerCase().includes(query);
}

function gitClass(decoration?: GitDecoration): string {
    return decoration ? `git-${decoration.color}` : "";
}

const GIT_STATUS_LABELS: Record<GitDecoration["color"], string> = {
    modified: "Modified",
    untracked: "Untracked",
    added: "Added",
    deleted: "Deleted",
    renamed: "Renamed",
    conflicting: "Conflicted",
};

function gitBadge(decoration?: GitDecoration): string {
    if (!decoration) return "";
    const label = GIT_STATUS_LABELS[decoration.color];
    return `<span class="git-badge ${gitClass(decoration)}" title="${escapeAttr(label)}">${escapeHtml(decoration.badge)}</span>`;
}

function gitRollupBadge(rollup?: boolean): string {
    return rollup ? `<span class="git-rollup" title="Contains changed files">●</span>` : "";
}

function post(vscode: VsCodeApi, message: ProjectToHostMessage): void {
    vscode.postMessage(message);
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
    return escapeHtml(value).replace(/"/g, "&quot;");
}

const SVG = {
    search: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.6" cy="6.6" r="4.1"/><line x1="9.7" y1="9.7" x2="14" y2="14" stroke-linecap="round"/></svg>`,
    chevron: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,3.5 10.5,8 6,12.5"/></svg>`,
    refresh: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4"/><polyline points="12.9,2.6 12.9,5 10.5,5"/></svg>`,
    sort: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="4.5" x2="13" y2="4.5"/><line x1="3" y1="8" x2="10" y2="8"/><line x1="3" y1="11.5" x2="7" y2="11.5"/></svg>`,
    plus: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="8" y1="3.5" x2="8" y2="12.5"/><line x1="3.5" y1="8" x2="12.5" y2="8"/></svg>`,
    addImportable: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="2.5" y1="4" x2="13.5" y2="4"/><line x1="2.5" y1="8" x2="9" y2="8"/><line x1="2.5" y1="12" x2="7" y2="12"/><line x1="11.8" y1="9.6" x2="11.8" y2="14.4"/><line x1="9.4" y1="12" x2="14.2" y2="12"/></svg>`,
    braces: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 2.5C5 2.5 4.5 3.2 4.5 4.5v1.2c0 1-.5 1.5-1.3 1.5.8 0 1.3.5 1.3 1.5v1.3c0 1.3.5 2 1.9 2"/><path d="M9.6 2.5c1.4 0 1.9.7 1.9 2v1.2c0 1 .5 1.5 1.3 1.5-.8 0-1.3.5-1.3 1.5v1.3c0 1.3-.5 2-1.9 2"/></svg>`,
    folder: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M1.8 4.4c0-.7.5-1.2 1.2-1.2h2.9l1.5 1.6h5.6c.7 0 1.2.5 1.2 1.2v5.8c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z"/></svg>`,
    metadata: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 3.2h7.6"/><path d="M4.2 8h7.6"/><path d="M4.2 12.8h7.6"/><circle cx="2.5" cy="3.2" r=".6" fill="currentColor" stroke="none"/><circle cx="2.5" cy="8" r=".6" fill="currentColor" stroke="none"/><circle cx="2.5" cy="12.8" r=".6" fill="currentColor" stroke="none"/></svg>`,
};

const SUB_GLYPH: Record<ProjectImportableSub["kind"], string> = {
    actions: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4.5" y1="5" x2="11.5" y2="5"/><line x1="4.5" y1="8" x2="11.5" y2="8"/><line x1="4.5" y1="11" x2="8.5" y2="11"/></svg>`,
    item: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2.4 13.4 5.4v5.2L8 13.6 2.6 10.6V5.4z"/><path d="M2.6 5.4 8 8.4l5.4-3M8 8.4v5.2"/></svg>`,
};

const TYPE_GLYPH: Record<ProjectImportableSummary["type"], string> = {
    function: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5.5,4.5 2.8,8 5.5,11.5"/><polyline points="10.5,4.5 13.2,8 10.5,11.5"/></svg>`,
    event: `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M8.7 1.8 3.8 9h3l-.8 5.2L11.6 7H8.4z"/></svg>`,
    region: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.2" stroke-dasharray="2.6 1.9"/></svg>`,
    item: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2.4 13.4 5.4v5.2L8 13.6 2.6 10.6V5.4z"/><path d="M2.6 5.4 8 8.4l5.4-3M8 8.4v5.2"/></svg>`,
    menu: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.8" y="2.8" width="4.2" height="4.2" rx=".7"/><rect x="9" y="2.8" width="4.2" height="4.2" rx=".7"/><rect x="2.8" y="9" width="4.2" height="4.2" rx=".7"/><rect x="9" y="9" width="4.2" height="4.2" rx=".7"/></svg>`,
    command: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 5.2 2.5 8l2 2.8"/><path d="M8.1 4 6.2 12"/><path d="M11.5 5.2 13.5 8l-2 2.8"/></svg>`,
    npc: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="5.4" r="2.4"/><path d="M3.6 13c0-2.5 2-4.1 4.4-4.1s4.4 1.6 4.4 4.1"/></svg>`,
    team: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5.6" r="2.1"/><path d="M2.2 12.6c0-2.1 1.7-3.5 3.8-3.5s3.8 1.4 3.8 3.5"/><path d="M10.6 3.7a2.1 2.1 0 0 1 0 4.1M11.1 9.2c1.8.2 2.9 1.5 2.9 3.4"/></svg>`,
    group: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2.2 3.4 4.1v3.5c0 3 2 5 4.6 6.2 2.6-1.2 4.6-3.2 4.6-6.2V4.1z"/></svg>`,
};
