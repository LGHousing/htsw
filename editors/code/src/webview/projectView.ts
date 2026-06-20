import * as path from "node:path";
import * as vscode from "vscode";
import * as json from "jsonc-parser";
import * as htsw from "htsw";
import {
    createIncludedImportJsonFiles,
    htslTargetForEventExport,
    htslTargetForFunctionExport,
    upsertImportableEntry,
    type ProjectFs,
    type Section,
} from "htsw-editor-common/project";
import { nodeProjectFs } from "../nodeProjectFs";
import type {
    ProjectFromHostMessage,
    ProjectImportableSub,
    ProjectImportableSummary,
    ProjectImportJsonNode,
    ProjectToHostMessage,
} from "./protocol";

const IMPORTABLE_SECTIONS = ["functions", "events", "regions", "items", "menus", "npcs"] as const;
type ImportableSection = typeof IMPORTABLE_SECTIONS[number];

const SECTION_META: Record<ImportableSection, {
    identityField: "name" | "event";
    type: ProjectImportableSummary["type"];
    typeLabel: string;
    openField?: string;
}> = {
    functions: { identityField: "name", type: "function", typeLabel: "FUNCTION", openField: "actions" },
    events: { identityField: "event", type: "event", typeLabel: "EVENT", openField: "actions" },
    regions: { identityField: "name", type: "region", typeLabel: "REGION" },
    items: { identityField: "name", type: "item", typeLabel: "ITEM", openField: "nbt" },
    menus: { identityField: "name", type: "menu", typeLabel: "MENU" },
    npcs: { identityField: "name", type: "npc", typeLabel: "NPC" },
};

// Nested file references shown as expandable child rows under an importable.
// Each value is a string path (htsl/snbt) per the import schema; menus are
// special-cased because their refs live per-slot.
type SubSpec = { keyPath: (string | number)[]; label: string; kind: "actions" | "item" };
const SUB_SPECS: Partial<Record<ImportableSection, SubSpec[]>> = {
    regions: [
        { keyPath: ["onEnterActions"], label: "On enter", kind: "actions" },
        { keyPath: ["onExitActions"], label: "On exit", kind: "actions" },
    ],
    items: [
        { keyPath: ["leftClickActions"], label: "Left click", kind: "actions" },
        { keyPath: ["rightClickActions"], label: "Right click", kind: "actions" },
    ],
    npcs: [
        { keyPath: ["leftClickActions"], label: "Left click", kind: "actions" },
        { keyPath: ["rightClickActions"], label: "Right click", kind: "actions" },
        { keyPath: ["equipment", "helmet"], label: "Helmet", kind: "item" },
        { keyPath: ["equipment", "chestplate"], label: "Chestplate", kind: "item" },
        { keyPath: ["equipment", "leggings"], label: "Leggings", kind: "item" },
        { keyPath: ["equipment", "boots"], label: "Boots", kind: "item" },
        { keyPath: ["equipment", "hand"], label: "Hand", kind: "item" },
    ],
};

export async function handleProjectMessage(
    webview: vscode.Webview,
    message: ProjectToHostMessage,
): Promise<void> {
    switch (message.type) {
        case "requestProjectTree":
            await postProjectTree(webview);
            return;
        case "openProjectFile":
            await openProjectFile(message.fsPath, message.preview);
            return;
        case "createIncludedImportJson":
            await createIncludedImportJson(webview, message.parentImportJsonPath, message.folderPath);
            return;
        case "addImportable":
            await addImportable(webview, message.importJsonPath, message.kind, message.identity);
            return;
    }
}

const SECTION_BY_KIND: Record<ProjectImportableSummary["type"], ImportableSection> = {
    function: "functions",
    event: "events",
    region: "regions",
    item: "items",
    menu: "menus",
    npc: "npcs",
};

async function addImportable(
    webview: vscode.Webview,
    importJsonPath: string,
    kind: ProjectImportableSummary["type"],
    identity: string,
): Promise<void> {
    try {
        if (!nodeProjectFs.exists(importJsonPath)) {
            throw new Error("Choose an existing import.json.");
        }
        const id = identity.trim();
        if (!id) throw new Error(kind === "event" ? "Choose an event." : "Enter a name.");
        if (kind === "item") throw new Error("Items are created in the Item / SNBT editor.");

        const section = SECTION_BY_KIND[kind];
        const readFs = projectFsWithOpenDocuments();

        // Functions/events get a starter .htsl; the export-target helper resolves
        // the declaring file (the picked file, for a new entry) and a collision-
        // free filename. Regions/npcs/menus are pure JSON entries.
        let targetImportJson = importJsonPath;
        const entry: Record<string, unknown> = {};
        const created: string[] = [];

        if (kind === "function" || kind === "event") {
            const target = kind === "function"
                ? htslTargetForFunctionExport(readFs, importJsonPath, id)
                : htslTargetForEventExport(readFs, importJsonPath, id);
            targetImportJson = target.importJsonPath;
            requireNew(readFs, targetImportJson, section, id, kind);
            if (!nodeProjectFs.exists(target.htslPath)) {
                nodeProjectFs.ensureDir(path.dirname(target.htslPath));
                nodeProjectFs.writeFile(target.htslPath, "\n");
                created.push(target.htslPath);
            }
            entry[kind === "function" ? "name" : "event"] = id;
            entry.actions = target.htslReference;
        } else {
            requireNew(readFs, targetImportJson, section, id, kind);
            entry.name = id;
            if (kind === "npc") entry.pos = { x: 0, y: 0, z: 0 };
            else if (kind === "menu") entry.slots = [];
        }

        await applyImportableUpsert(targetImportJson, section, entry);

        // Land the user on the new starter file if there is one, else the
        // import.json so they can fill in the remaining fields.
        await openProjectFile(created[0] ?? targetImportJson, false);
        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Added ${kind} "${id}".`,
        } satisfies ProjectFromHostMessage);
        await postProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not add importable: ${error}`);
    }
}

function requireNew(
    fs: ProjectFs,
    importJsonPath: string,
    section: Section,
    identity: string,
    kind: string,
): void {
    if (!importableExists(fs, importJsonPath, section, identity)) return;
    throw new Error(
        `A ${kind} named "${identity}" already exists in ` +
            `${vscode.workspace.asRelativePath(importJsonPath, false)}.`,
    );
}

function importableExists(
    fs: ProjectFs,
    importJsonPath: string,
    section: Section,
    identity: string,
): boolean {
    const tree = parseImportJson(fs, importJsonPath);
    const sectionNode = tree ? json.findNodeAtLocation(tree, [section]) : null;
    if (!sectionNode || sectionNode.type !== "array") return false;
    const idField = section === "events" ? "event" : "name";
    for (const item of sectionNode.children ?? []) {
        const idNode = json.findNodeAtLocation(item, [idField]);
        if (idNode?.type === "string" && idNode.value === identity) return true;
    }
    return false;
}

// Write the entry through a doc-aware fs: an import.json that's open (possibly
// with unsaved edits) gets a WorkspaceEdit + save rather than a disk write that
// would clobber the buffer. Mirrors the Item Editor's upsert path.
async function applyImportableUpsert(
    importJsonPath: string,
    section: Section,
    entry: Record<string, unknown>,
): Promise<void> {
    const replacements = new Map<string, string>();
    const fs: ProjectFs = {
        ...nodeProjectFs,
        readFile(filePath) {
            const open = openTextDocumentForPath(filePath);
            return open ? open.getText() : nodeProjectFs.readFile(filePath);
        },
        writeFile(filePath, text) {
            const open = openTextDocumentForPath(filePath);
            if (open) {
                replacements.set(pathKey(filePath), text);
                return;
            }
            nodeProjectFs.writeFile(filePath, text);
        },
    };

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(importJsonPath));
    upsertImportableEntry(fs, importJsonPath, section, entry);

    const replacement = replacements.get(pathKey(importJsonPath));
    if (replacement !== undefined) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
            replacement,
        );
        await vscode.workspace.applyEdit(edit);
        await document.save();
    }
}

async function postProjectTree(webview: vscode.Webview): Promise<void> {
    let roots: ProjectImportJsonNode[] = [];
    let error: string | undefined;
    try {
        roots = await discoverProjectTree();
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        console.error("[htsw] import.json tree discovery failed:", err);
    }
    // Always post a tree (even empty) so the webview clears its loading state
    // instead of hanging on "Loading…" when discovery fails.
    await webview.postMessage({
        type: "projectTree",
        roots,
        workspaceName: workspaceLabel(),
    } satisfies ProjectFromHostMessage);
    if (error) {
        await webview.postMessage({
            type: "projectResult",
            ok: false,
            error: `Could not load import.json tree: ${error}`,
        } satisfies ProjectFromHostMessage);
    }
}

function workspaceLabel(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    if (folders.length === 1) return folders[0].name;
    return `${folders.length} workspace folders`;
}

async function discoverProjectTree(): Promise<ProjectImportJsonNode[]> {
    const manifests = await vscode.workspace.findFiles(
        "**/{import.json,*.import.json}",
        "**/{node_modules,.git}/**",
    );
    const manifestKeys = new Set(manifests.map((uri) => pathKey(uri.fsPath)));
    const includedKeys = new Set<string>();
    const fs = projectFsWithOpenDocuments();

    for (const uri of manifests) {
        collectIncludedKeys(fs, uri.fsPath, manifestKeys, includedKeys, new Set<string>());
    }

    const rootUris = manifests.filter((uri) => !includedKeys.has(pathKey(uri.fsPath)));
    const roots = rootUris.length > 0 ? rootUris : manifests;
    const diags = collectDiagnosticCounts();
    return roots
        .map((uri) => buildImportJsonNode(fs, uri.fsPath, null, new Set<string>(), diags))
        .sort((left, right) => left.label.localeCompare(right.label));
}

type SeverityCount = { errors: number; warnings: number };

function collectDiagnosticCounts(): Map<string, SeverityCount> {
    const counts = new Map<string, SeverityCount>();
    for (const [uri, list] of vscode.languages.getDiagnostics()) {
        if (uri.scheme !== "file") continue;
        let errors = 0;
        let warnings = 0;
        for (const diagnostic of list) {
            if (diagnostic.severity === vscode.DiagnosticSeverity.Error) errors++;
            else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) warnings++;
        }
        if (errors > 0 || warnings > 0) counts.set(pathKey(uri.fsPath), { errors, warnings });
    }
    return counts;
}

// A node's display label is its directory relative to the PARENT import.json's
// directory — "clocks", not the full "functions/clocks/import.json" path. Roots
// keep their workspace-relative path so multiple roots stay distinguishable.
function nodeLabel(filePath: string, parentFilePath: string | null): string {
    if (parentFilePath === null) return vscode.workspace.asRelativePath(filePath, false);
    const rel = path.relative(path.dirname(parentFilePath), filePath).split(path.sep).join("/");
    if (rel.endsWith("/import.json")) return rel.slice(0, -"/import.json".length);
    if (rel === "import.json") return path.basename(path.dirname(filePath));
    return rel;
}

function collectIncludedKeys(
    fs: ProjectFs,
    filePath: string,
    knownManifests: Set<string>,
    includedKeys: Set<string>,
    stack: Set<string>,
): void {
    const key = pathKey(filePath);
    if (stack.has(key) || !fs.exists(filePath)) return;
    stack.add(key);
    for (const includePath of readIncludePaths(fs, filePath)) {
        const resolved = fs.resolvePath(fs.parentDir(filePath), includePath);
        const resolvedKey = pathKey(resolved);
        if (knownManifests.has(resolvedKey)) includedKeys.add(resolvedKey);
        collectIncludedKeys(fs, resolved, knownManifests, includedKeys, stack);
    }
    stack.delete(key);
}

function buildImportJsonNode(
    fs: ProjectFs,
    filePath: string,
    parentFilePath: string | null,
    stack: Set<string>,
    diags: Map<string, SeverityCount>,
): ProjectImportJsonNode {
    const key = pathKey(filePath);
    const label = nodeLabel(filePath, parentFilePath);
    const name = path.basename(path.dirname(filePath)) || path.basename(filePath);

    if (stack.has(key)) {
        return {
            fsPath: filePath,
            label,
            name,
            importableCount: 0,
            importables: [],
            cycle: true,
            children: [],
        };
    }

    if (!fs.exists(filePath)) {
        return {
            fsPath: filePath,
            label,
            name,
            importableCount: 0,
            importables: [],
            missing: true,
            children: [],
        };
    }

    stack.add(key);
    const tree = parseImportJson(fs, filePath);
    const children = readIncludePathsFromTree(tree)
        .map((includePath) => fs.resolvePath(fs.parentDir(filePath), includePath))
        .map((childPath) => buildImportJsonNode(fs, childPath, filePath, stack, diags));
    stack.delete(key);

    const importables = readImportables(tree, filePath, fs, diags);
    const own = diags.get(key) ?? { errors: 0, warnings: 0 };
    let errors = own.errors;
    let warnings = own.warnings;
    for (const entry of importables) {
        errors += entry.errors ?? 0;
        warnings += entry.warnings ?? 0;
        for (const sub of entry.subEntries ?? []) {
            errors += sub.errors ?? 0;
            warnings += sub.warnings ?? 0;
        }
    }
    for (const child of children) {
        errors += child.errors ?? 0;
        warnings += child.warnings ?? 0;
    }

    return {
        fsPath: filePath,
        label,
        name,
        importableCount: countImportables(tree),
        importables,
        children,
        errors: errors || undefined,
        warnings: warnings || undefined,
    };
}

async function createIncludedImportJson(
    webview: vscode.Webview,
    parentImportJsonPath: string,
    folderPath: string,
): Promise<void> {
    try {
        if (!nodeProjectFs.exists(parentImportJsonPath)) {
            throw new Error("Choose an existing parent import.json.");
        }

        const parentUri = vscode.Uri.file(parentImportJsonPath);
        const document = await vscode.workspace.openTextDocument(parentUri);
        let parentReplacement: string | undefined;
        const fs: ProjectFs = {
            ...nodeProjectFs,
            readFile(filePath) {
                if (pathKey(filePath) === pathKey(parentImportJsonPath)) return document.getText();
                const open = openTextDocumentForPath(filePath);
                return open ? open.getText() : nodeProjectFs.readFile(filePath);
            },
            writeFile(filePath, text) {
                if (pathKey(filePath) === pathKey(parentImportJsonPath)) {
                    parentReplacement = text;
                    return;
                }
                nodeProjectFs.writeFile(filePath, text);
            },
        };

        const result = createIncludedImportJsonFiles(
            fs,
            path.dirname(parentImportJsonPath),
            folderPath,
            parentImportJsonPath,
        );

        if (parentReplacement !== undefined) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                parentUri,
                new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
                parentReplacement,
            );
            await vscode.workspace.applyEdit(edit);
            await document.save();
        }

        await openProjectFile(result.importJsonPath, false);
        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Created ${vscode.workspace.asRelativePath(result.importJsonPath, false)}.`,
            createdPath: result.importJsonPath,
        } satisfies ProjectFromHostMessage);
        await postProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({
            type: "projectResult",
            ok: false,
            error,
        } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not create included import.json: ${error}`);
    }
}

async function openProjectFile(fsPath: string, preview: boolean): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
    await vscode.window.showTextDocument(doc, { preview });
}

function projectFsWithOpenDocuments(): ProjectFs {
    return {
        ...nodeProjectFs,
        readFile(filePath) {
            const open = openTextDocumentForPath(filePath);
            return open ? open.getText() : nodeProjectFs.readFile(filePath);
        },
    };
}

function parseImportJson(fs: ProjectFs, filePath: string): json.Node | null {
    try {
        const text = fs.readFile(filePath);
        if (text.trim() === "") return null;
        return json.parseTree(text) ?? null;
    } catch (_err) {
        return null;
    }
}

function readIncludePaths(fs: ProjectFs, filePath: string): string[] {
    return readIncludePathsFromTree(parseImportJson(fs, filePath));
}

function readIncludePathsFromTree(tree: json.Node | null): string[] {
    if (!tree) return [];
    const includeNode = json.findNodeAtLocation(tree, ["include"]);
    if (!includeNode || includeNode.type !== "array") return [];
    return (includeNode.children ?? [])
        .filter((node) => node.type === "string" && typeof node.value === "string")
        .map((node) => String(node.value));
}

function countImportables(tree: json.Node | null): number {
    if (!tree) return 0;
    let count = 0;
    for (const section of IMPORTABLE_SECTIONS) {
        const node = json.findNodeAtLocation(tree, [section]);
        if (node?.type === "array") count += node.children?.length ?? 0;
    }
    return count;
}

function readImportables(
    tree: json.Node | null,
    importJsonPath: string,
    fs: ProjectFs,
    diags: Map<string, SeverityCount>,
): ProjectImportableSummary[] {
    if (!tree) return [];
    const importables: ProjectImportableSummary[] = [];
    for (const section of IMPORTABLE_SECTIONS) {
        const sectionNode = json.findNodeAtLocation(tree, [section]);
        if (!sectionNode || sectionNode.type !== "array") continue;
        const meta = SECTION_META[section];
        const items = sectionNode.children ?? [];
        for (const item of items) {
            const idNode = json.findNodeAtLocation(item, [meta.identityField]);
            if (!idNode || idNode.type !== "string" || typeof idNode.value !== "string") continue;
            const refNode = meta.openField
                ? json.findNodeAtLocation(item, [meta.openField])
                : null;
            const ref = refNode?.type === "string" && typeof refNode.value === "string"
                ? String(refNode.value)
                : null;
            const refPath = ref ? fs.resolvePath(fs.parentDir(importJsonPath), ref) : null;
            const openPath = refPath && fs.exists(refPath) ? refPath : importJsonPath;
            // Only attribute diagnostics when the importable has its own source
            // file — otherwise every importable would inherit the import.json's.
            const ownDiag = openPath !== importJsonPath ? diags.get(pathKey(openPath)) : undefined;
            const subEntries = readSubEntries(item, section, importJsonPath, fs, diags);
            importables.push({
                id: `${importJsonPath}|${meta.type}|${idNode.value}`,
                label: idNode.value,
                type: meta.type,
                typeLabel: meta.typeLabel,
                openPath,
                ...readImportableIcon(item, section, idNode.value, refPath, fs),
                errors: ownDiag?.errors || undefined,
                warnings: ownDiag?.warnings || undefined,
                subEntries: subEntries.length > 0 ? subEntries : undefined,
            });
        }
    }
    return importables;
}

function readSubEntries(
    item: json.Node,
    section: ImportableSection,
    importJsonPath: string,
    fs: ProjectFs,
    diags: Map<string, SeverityCount>,
): ProjectImportableSub[] {
    if (section === "menus") return readMenuSubEntries(item, importJsonPath, fs, diags);
    const specs = SUB_SPECS[section];
    if (!specs) return [];
    const out: ProjectImportableSub[] = [];
    for (const spec of specs) {
        const fsPath = resolveStringRef(item, spec.keyPath, importJsonPath, fs);
        if (fsPath) out.push(subEntry(spec.label, fsPath, spec.kind, diags));
    }
    return out;
}

function readMenuSubEntries(
    item: json.Node,
    importJsonPath: string,
    fs: ProjectFs,
    diags: Map<string, SeverityCount>,
): ProjectImportableSub[] {
    const slotsNode = json.findNodeAtLocation(item, ["slots"]);
    if (slotsNode?.type !== "array") return [];
    const out: ProjectImportableSub[] = [];
    for (const slot of slotsNode.children ?? []) {
        const slotNumNode = json.findNodeAtLocation(slot, ["slot"]);
        const tag = slotNumNode?.type === "number" ? `Slot ${Number(slotNumNode.value)}` : "Slot";
        const nbt = resolveStringRef(slot, ["nbt"], importJsonPath, fs);
        if (nbt) out.push(subEntry(`${tag} item`, nbt, "item", diags));
        const actions = resolveStringRef(slot, ["actions"], importJsonPath, fs);
        if (actions) out.push(subEntry(`${tag} actions`, actions, "actions", diags));
    }
    return out;
}

function resolveStringRef(
    node: json.Node,
    keyPath: (string | number)[],
    importJsonPath: string,
    fs: ProjectFs,
): string | null {
    const ref = json.findNodeAtLocation(node, keyPath);
    if (ref?.type !== "string" || typeof ref.value !== "string") return null;
    const resolved = fs.resolvePath(fs.parentDir(importJsonPath), ref.value);
    return fs.exists(resolved) ? resolved : null;
}

function subEntry(
    label: string,
    fsPath: string,
    kind: "actions" | "item",
    diags: Map<string, SeverityCount>,
): ProjectImportableSub {
    const diag = diags.get(pathKey(fsPath));
    return { label, fsPath, kind, errors: diag?.errors || undefined, warnings: diag?.warnings || undefined };
}

function readImportableIcon(
    item: json.Node,
    section: ImportableSection,
    identity: string,
    refPath: string | null,
    fs: ProjectFs,
): { iconItem?: string; iconMeta?: number; iconCount?: number } {
    if (section === "functions" || section === "events") {
        const itemNode = json.findNodeAtLocation(item, ["icon", "item"]);
        if (itemNode?.type === "string" && typeof itemNode.value === "string") {
            const countNode = json.findNodeAtLocation(item, ["icon", "count"]);
            const iconCount = countNode?.type === "number" && typeof countNode.value === "number"
                ? Number(countNode.value)
                : undefined;
            return { iconItem: String(itemNode.value), iconCount };
        }
        // Events carry no per-entry icon — fall back to the event's default
        // Housing item so they render an icon like functions do.
        if (section === "events") {
            const eventIcons = htsw.types.EVENT_ICONS as Record<string, string> | undefined;
            const fallback = eventIcons?.[identity];
            if (fallback) return { iconItem: fallback };
        }
        return {};
    }
    if (section === "items" && refPath && fs.exists(refPath)) {
        return readSnbtIcon(refPath, fs);
    }
    return {};
}

// Pull just the item id and Damage out of an item's snbt for the row icon. A
// regex rather than a full parse: a malformed snbt still renders (it falls
// back to a type glyph) and the tree refresh stays a cheap read.
function readSnbtIcon(snbtPath: string, fs: ProjectFs): { iconItem?: string; iconMeta?: number } {
    try {
        const text = fs.readFile(snbtPath);
        const idMatch = text.match(/\bid\s*:\s*"([^"]+)"/);
        if (!idMatch) return {};
        const damageMatch = text.match(/\bDamage\s*:\s*(\d+)/);
        return {
            iconItem: idMatch[1],
            iconMeta: damageMatch ? Number(damageMatch[1]) : undefined,
        };
    } catch (_err) {
        return {};
    }
}

function openTextDocumentForPath(filePath: string): vscode.TextDocument | undefined {
    const key = pathKey(filePath);
    return vscode.workspace.textDocuments.find(
        (document) => document.uri.scheme === "file" && pathKey(document.uri.fsPath) === key,
    );
}

function pathKey(filePath: string): string {
    return path.resolve(filePath).split("\\").join("/").toLowerCase();
}
