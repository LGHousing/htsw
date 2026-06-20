import * as htsw from "htsw";
import * as itemIcons from "minecraft-icon-items";
import type {
    ProjectFromHostMessage,
    ProjectImportableSub,
    ProjectImportableSummary,
    ProjectImportJsonNode,
    ProjectToHostMessage,
} from "../protocol";

type VsCodeApi = ReturnType<typeof acquireVsCodeApi>;

type SortMode = "default" | "name" | "type";

type ImportableKind = ProjectImportableSummary["type"];

type State = {
    roots: ProjectImportJsonNode[];
    expanded: Set<string>;
    query: string;
    sort: SortMode;
    selectedParent: string;
    showCreate: boolean;
    showAdd: boolean;
    addKind: ImportableKind;
    addName: string;
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
    { value: "npc", label: "NPC" },
];

const EVENT_NAMES = htsw.types.EVENTS as readonly string[];

const SORT_LABEL: Record<SortMode, string> = {
    default: "File order",
    name: "Name",
    type: "Type",
};

export function mountProjectExplorer(
    app: HTMLElement,
    vscode: VsCodeApi,
    onOpenItemEditor?: () => void,
): () => void {
    const state: State = {
        roots: [],
        expanded: new Set(),
        query: "",
        sort: "default",
        selectedParent: "",
        showCreate: false,
        showAdd: false,
        addKind: "function",
        addName: "",
        workspaceName: "",
        status: { kind: "idle", text: "" },
        loading: true,
    };

    const onMessage = (event: MessageEvent<ProjectFromHostMessage>) => {
        const message = event.data;
        if (message.type === "projectTree") {
            const hadRoots = state.roots.length > 0;
            const wasLoading = state.loading;
            state.roots = message.roots;
            state.workspaceName = message.workspaceName ?? "";
            state.loading = false;
            if (!state.selectedParent) state.selectedParent = state.roots[0]?.fsPath ?? "";
            if (!hadRoots) seedExpanded(state);
            // Only a full re-render on the first load. Later updates (e.g. the
            // live diagnostics refresh) patch the tree in place so they don't
            // reset scroll or steal focus from the search box.
            if (wasLoading) render();
            else refreshTreeData();
            return;
        }

        if (message.type === "projectResult") {
            state.status = message.ok
                ? { kind: "ok", text: message.message }
                : { kind: "error", text: message.error };
            if (message.ok && message.createdPath) {
                state.selectedParent = message.createdPath;
                state.expanded.add(message.createdPath);
                state.showCreate = false;
                render();
                return;
            }
            renderStatus();
        }
    };

    window.addEventListener("message", onMessage);
    render();
    post(vscode, { type: "requestProjectTree" });
    return () => window.removeEventListener("message", onMessage);

    function render(): void {
        const scroll = document.getElementById("projectTree")?.scrollTop ?? 0;
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
                    <button id="toggleCreate" class="icon-button ${state.showCreate ? "active" : ""}" type="button" title="New module">${SVG.plus}</button>
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
        if (state.showCreate) {
            (document.getElementById("modulePath") as HTMLInputElement | null)?.focus();
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
            post(vscode, { type: "requestProjectTree" });
        });

        document.getElementById("sortProject")?.addEventListener("click", () => {
            const order: SortMode[] = ["default", "name", "type"];
            state.sort = order[(order.indexOf(state.sort) + 1) % order.length];
            render();
        });

        document.getElementById("toggleCreate")?.addEventListener("click", () => {
            state.showCreate = !state.showCreate;
            if (state.showCreate) state.showAdd = false;
            render();
        });

        document.getElementById("toggleAdd")?.addEventListener("click", () => {
            state.showAdd = !state.showAdd;
            if (state.showAdd) state.showCreate = false;
            render();
        });

        document.getElementById("addKind")?.addEventListener("change", (event) => {
            state.addKind = (event.target as HTMLSelectElement).value as ImportableKind;
            if (state.addKind === "event" && !EVENT_NAMES.includes(state.addName)) {
                state.addName = EVENT_NAMES[0] ?? "";
            }
            render();
        });

        const addName = document.getElementById("addName") as HTMLInputElement | HTMLSelectElement | null;
        addName?.addEventListener("input", () => { state.addName = addName.value; });
        addName?.addEventListener("change", () => { state.addName = addName.value; });

        const addParent = document.getElementById("addParent") as HTMLSelectElement | null;
        addParent?.addEventListener("change", () => updateSelectedParent(addParent.value));

        document.getElementById("addImportableForm")?.addEventListener("submit", (event) => {
            event.preventDefault();
            if (state.addKind === "item") {
                state.showAdd = false;
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
            render();
        });

        document.getElementById("cancelAdd")?.addEventListener("click", () => {
            state.showAdd = false;
            render();
        });

        const query = document.getElementById("projectQuery") as HTMLInputElement | null;
        query?.addEventListener("input", () => {
            state.query = query.value;
            renderTreeOnly();
        });

        const parent = document.getElementById("parentImportJson") as HTMLSelectElement | null;
        parent?.addEventListener("change", () => {
            updateSelectedParent(parent.value);
        });

        document.getElementById("createModuleForm")?.addEventListener("submit", (event) => {
            event.preventDefault();
            const input = document.getElementById("modulePath") as HTMLInputElement | null;
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
            render();
        });

        bindTree();
    }

    function bindTree(): void {
        for (const button of document.querySelectorAll<HTMLButtonElement>("[data-toggle-node]")) {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                // A file node's fsPath or an importable's sub-list id — both are
                // just opaque keys into state.expanded.
                const key = button.dataset.toggleNode;
                if (!key) return;
                toggleExpanded(state, key);
                renderTreeOnly();
            });
        }

        for (const row of document.querySelectorAll<HTMLElement>("[data-open-path]")) {
            row.addEventListener("click", (event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("button")) return;
                const fsPath = row.dataset.openPath;
                if (!fsPath) return;
                // The caret + file-icon strip toggles an expandable node, giving
                // a bigger hit target than the caret alone; the label still opens.
                const togglePath = expandableTogglePath(row);
                if (togglePath && target?.closest(".row-icon")) {
                    toggleExpanded(state, togglePath);
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
                const fsPath = row.dataset.openPath;
                if (!fsPath) return;
                post(vscode, { type: "openProjectFile", fsPath, preview: false });
            });
        }
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
    }

    function updateSelectedParent(fsPath: string): void {
        state.selectedParent = fsPath;
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
        <form id="createModuleForm" class="create-panel">
            <div class="create-title">New module</div>
            <p class="create-hint">Creates an empty <code>import.json</code> and adds it to the selected file's <code>include</code> list.</p>
            <label class="create-field">
                <span>Include from</span>
                <select id="parentImportJson">${parentOptions(state).join("")}</select>
            </label>
            <label class="create-field">
                <span>Folder</span>
                <input id="modulePath" placeholder="functions/clocks" autocomplete="off">
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

function renderTree(state: State): string {
    if (state.loading) return emptyState("Loading import.json tree…");
    if (state.roots.length === 0) return emptyState("No import.json files found in this workspace.");
    const query = state.query.trim().toLowerCase();
    try {
        const rows = sortNodes(state.roots, state.sort)
            .filter((root) => nodeMatches(root, query))
            .map((root) => renderNode(root, state, 0, true, query))
            .join("");
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
            data-parent-path="${escapeAttr(node.fsPath)}">
            ${indentGuides(depth)}
            <button class="twisty ${hasChildren ? "" : "empty"} ${expanded ? "open" : ""}" type="button"
                data-toggle-node="${escapeAttr(node.fsPath)}" ${hasChildren ? "" : "disabled"}>${SVG.chevron}</button>
            <span class="row-icon json">${SVG.braces}</span>
            <span class="row-label ${diagClass(node.errors, node.warnings)}">${escapeHtml(node.label)}</span>
            ${diagBadge(node.errors, node.warnings)}
            <span class="row-count ${problem ? "problem" : ""}">${escapeHtml(badge)}</span>
        </div>
    `;
    if (!expanded) return row;
    return row +
        visibleChildren.map((child) => renderNode(child, state, depth + 1, false, query)).join("") +
        visibleImportables.map((entry) => renderImportable(entry, depth + 1, state, query)).join("");
}

function renderImportable(
    entry: ProjectImportableSummary,
    depth: number,
    state: State,
    query: string,
): string {
    const subs = entry.subEntries ?? [];
    const hasSubs = subs.length > 0;
    const expanded = hasSubs && (query.length > 0 || state.expanded.has(entry.id));
    const row = `
        <div class="row imp ${entry.type}" data-open-path="${escapeAttr(entry.openPath ?? "")}">
            ${indentGuides(depth)}
            <button class="twisty ${hasSubs ? "" : "empty"} ${expanded ? "open" : ""}" type="button"
                data-toggle-node="${escapeAttr(entry.id)}" ${hasSubs ? "" : "disabled"}>${SVG.chevron}</button>
            ${importableIcon(entry)}
            <span class="row-label ${diagClass(entry.errors, entry.warnings)}">${escapeHtml(entry.label)}</span>
            ${diagBadge(entry.errors, entry.warnings)}
            <span class="row-type">${escapeHtml(entry.typeLabel)}</span>
        </div>
    `;
    if (!expanded) return row;
    return row + subs.map((sub) => renderSubEntry(sub, depth + 1)).join("");
}

function renderSubEntry(sub: ProjectImportableSub, depth: number): string {
    return `
        <div class="row sub" data-open-path="${escapeAttr(sub.fsPath)}">
            ${indentGuides(depth)}
            <span class="twisty empty"></span>
            <span class="row-icon sub ${sub.kind}">${SUB_GLYPH[sub.kind]}</span>
            <span class="row-label ${diagClass(sub.errors, sub.warnings)}">${escapeHtml(sub.label)}</span>
            ${diagBadge(sub.errors, sub.warnings)}
            <span class="row-type">${escapeHtml(baseName(sub.fsPath))}</span>
        </div>
    `;
}

function baseName(fsPath: string): string {
    const parts = fsPath.split(/[\\/]/);
    return parts[parts.length - 1] ?? fsPath;
}

function importableIcon(entry: ProjectImportableSummary): string {
    const uri = iconDataUri(entry.iconItem, entry.iconMeta);
    if (uri) {
        return `<span class="row-icon mc"><img src="${uri}" alt="" draggable="false"></span>`;
    }
    return `<span class="row-icon glyph ${entry.type}">${TYPE_GLYPH[entry.type]}</span>`;
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
    const visit = (node: ProjectImportJsonNode): void => {
        if (!node.missing && !node.cycle) out.push(node);
        node.children.forEach(visit);
    };
    nodes.forEach(visit);
    return out;
}

function seedExpanded(state: State): void {
    for (const root of state.roots) {
        state.expanded.add(root.fsPath);
        for (const child of root.children) state.expanded.add(child.fsPath);
    }
}

function toggleExpanded(state: State, fsPath: string): void {
    if (state.expanded.has(fsPath)) {
        state.expanded.delete(fsPath);
    } else {
        state.expanded.add(fsPath);
    }
}

function subtreeCount(node: ProjectImportJsonNode): number {
    return node.importableCount + node.children.reduce((total, child) => total + subtreeCount(child), 0);
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
    return `${entry.label} ${entry.typeLabel} ${entry.type} ${subs}`.toLowerCase().includes(query);
}

type MinecraftItem = { id: number; name: string };
const ITEM_ID_BY_NAME = new Map<string, number>();
for (const item of htsw.types.MINECRAFT_ITEMS as readonly MinecraftItem[]) {
    ITEM_ID_BY_NAME.set(item.name, item.id);
}

function iconDataUri(iconItem: string | undefined, meta: number | undefined): string | null {
    if (!iconItem) return null;
    const bare = iconItem.replace(/^minecraft:/, "").toLowerCase();
    const id = ITEM_ID_BY_NAME.get(bare);
    if (id === undefined) return null;
    const png = itemIcons.get(`${id}:${meta ?? 0}`)?.icon ?? itemIcons.get(`${id}:0`)?.icon;
    return png ? `data:image/png;base64,${png}` : null;
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
    npc: `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="5.4" r="2.4"/><path d="M3.6 13c0-2.5 2-4.1 4.4-4.1s4.4 1.6 4.4 4.1"/></svg>`,
};
