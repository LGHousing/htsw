import * as path from "node:path";
import * as vscode from "vscode";
import * as json from "jsonc-parser";
import * as htsw from "htsw";
import {
    createIncludedImportJsonFiles,
    htslTargetForCommandExport,
    htslTargetForEventExport,
    htslTargetForFunctionExport,
    moveImportableEntry,
    resolveImportableFile,
    upsertImportableEntry,
    type ProjectFs,
    type Section,
} from "htsw-editor-common/project";
import { nodeProjectFs } from "../nodeProjectFs";
import { bumpWorkspaceGeneration, type ContextParse, getCachedRootParse } from "../rootParse";
import type {
    ProjectFromHostMessage,
    ProjectImportableSub,
    ProjectImportableSummary,
    ProjectImportJsonNode,
    ProjectToHostMessage,
} from "./protocol";

const IMPORTABLE_SECTIONS = ["functions", "events", "regions", "items", "menus", "commands", "npcs"] as const;
type ImportableSection = typeof IMPORTABLE_SECTIONS[number];

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
        case "moveImportable":
            await moveImportable(webview, message.importJsonPath, message.kind, message.identity);
            return;
    }
}

async function moveImportable(
    webview: vscode.Webview,
    importJsonPath: string,
    kind: ProjectImportableSummary["type"],
    identity: string,
): Promise<void> {
    try {
        const section = SECTION_BY_KIND[kind];
        const roots = await discoverProjectTree();
        const sourceKey = pathKey(importJsonPath);

        const destinations: Array<vscode.QuickPickItem & { fsPath: string }> = [];
        const treeRootOf = new Map<string, string>();
        const visit = (node: ProjectImportJsonNode, treeRoot: string): void => {
            if (node.missing || node.cycle || node.reference) return;
            treeRootOf.set(pathKey(node.fsPath), treeRoot);
            if (pathKey(node.fsPath) !== sourceKey) {
                destinations.push({
                    label: vscode.workspace.asRelativePath(node.fsPath, false),
                    fsPath: node.fsPath,
                });
            }
            node.children.forEach((child) => visit(child, treeRoot));
        };
        roots.forEach((root) => visit(root, root.fsPath));

        if (destinations.length === 0) {
            throw new Error("No other import.json to move to.");
        }
        const pick = await vscode.window.showQuickPick(destinations, {
            placeHolder: `Move ${kind} "${identity}" to…`,
        });
        if (!pick) return;

        // Walk the whole tree from its root so files also referenced by other
        // declarations get copied instead of moved.
        const entryJsonPath = treeRootOf.get(sourceKey) ?? importJsonPath;
        await moveImportableWithOpenDocs(entryJsonPath, section, identity, pick.fsPath);

        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Moved ${kind} "${identity}" to ${pick.label}.`,
        } satisfies ProjectFromHostMessage);
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not move importable: ${error}`);
    }
}

const SECTION_BY_KIND: Record<ProjectImportableSummary["type"], ImportableSection> = {
    function: "functions",
    event: "events",
    region: "regions",
    item: "items",
    menu: "menus",
    command: "commands",
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
        if (kind === "npc") throw new Error("NPC entries are created by exporting an existing in-game NPC.");

        const section = SECTION_BY_KIND[kind];
        const readFs = projectFsWithOpenDocuments();

        // Action-backed importables get a starter .htsl; the export-target
        // helper resolves the declaring file and a collision-free filename.
        let targetImportJson = importJsonPath;
        const entry: Record<string, unknown> = {};
        const created: string[] = [];

        if (kind === "function" || kind === "event" || kind === "command") {
            const target = kind === "function"
                ? htslTargetForFunctionExport(readFs, importJsonPath, id)
                : kind === "event"
                    ? htslTargetForEventExport(readFs, importJsonPath, id)
                    : htslTargetForCommandExport(readFs, importJsonPath, id);
            targetImportJson = target.importJsonPath;
            requireNew(readFs, targetImportJson, section, id, kind);
            if (!nodeProjectFs.exists(target.htslPath)) {
                nodeProjectFs.ensureDir(path.dirname(target.htslPath));
                nodeProjectFs.writeFile(target.htslPath, "\n");
                created.push(target.htslPath);
            }
            entry[kind === "event" ? "event" : "name"] = id;
            entry.actions = target.htslReference;
        } else {
            // Region/menu entries are pure JSON, but the name may already
            // be declared in an INCLUDED file — resolve that declaring file
            // first (like the function/event path) so the duplicate check sees
            // it and we don't write a second declaration into the parent.
            targetImportJson = resolveImportableFile(readFs, importJsonPath, section, id);
            requireNew(readFs, targetImportJson, section, id, kind);
            entry.name = id;
            if (kind === "menu") entry.slots = [];
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
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not add importable: ${error}`);
    }
}

/**
 * Run moveImportableEntry with doc-aware writes: an open import.json gets a
 * WorkspaceEdit + save instead of a disk write that would clobber unsaved
 * edits. Throws on failure. Used by the tree's right-click move and the
 * module-visibility quick fix.
 */
export async function moveImportableWithOpenDocs(
    entryJsonPath: string,
    section: Section,
    identity: string,
    destJsonPath: string,
): Promise<void> {
    const replacements = new Map<string, string>();
    const fs: ProjectFs = {
        ...nodeProjectFs,
        readFile(filePath) {
            const pending = replacements.get(pathKey(filePath));
            if (pending !== undefined) return pending;
            const open = openTextDocumentForPath(filePath);
            return open ? open.getText() : nodeProjectFs.readFile(filePath);
        },
        writeFile(filePath, text) {
            if (openTextDocumentForPath(filePath)) {
                replacements.set(pathKey(filePath), text);
                return;
            }
            nodeProjectFs.writeFile(filePath, text);
        },
    };

    const result = moveImportableEntry(fs, entryJsonPath, section, identity, destJsonPath);
    if (!result.ok) throw new Error(result.message);

    for (const [key, text] of replacements) {
        const open = openTextDocumentForPath(key);
        if (!open) continue;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            open.uri,
            new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length)),
            text,
        );
        await vscode.workspace.applyEdit(edit);
        await open.save();
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

async function postFreshProjectTree(webview: vscode.Webview): Promise<void> {
    bumpWorkspaceGeneration();
    await postProjectTree(webview);
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
        .map((uri) => rootNodeFromParse(uri.fsPath, diags))
        .sort((left, right) => left.label.localeCompare(right.label));
}

// The tree is a projection of the LANGUAGE parse — the same fileTree (homes,
// jump-link references, missing includes) the in-game Importables tree
// renders, served from the generation-keyed cache the diagnostics adapter
// shares — so the two UIs can't drift and refreshes don't re-read the world.
function rootNodeFromParse(
    rootPath: string,
    diags: Map<string, SeverityCount>,
): ProjectImportJsonNode {
    const rootDir = path.dirname(rootPath);
    let parse: ContextParse | null = null;
    try {
        parse = getCachedRootParse(rootPath);
    } catch {
        parse = null;
    }
    const tree = parse?.result.importJson.fileTree ?? null;
    if (parse === null || tree === null) {
        return {
            fsPath: rootPath,
            label: nodeLabel(rootPath, null, rootDir),
            name: path.basename(path.dirname(rootPath)) || path.basename(rootPath),
            importableCount: 0,
            importables: [],
            children: [],
            missing: nodeProjectFs.exists(rootPath) ? undefined : true,
        };
    }
    const node = mapFileNode(tree, null, rootDir, parse, diags);
    patchReferenceNodes(node);
    return node;
}

function mapFileNode(
    fileNode: htsw.ImportJsonFileNode,
    parentPath: string | null,
    rootDir: string,
    parse: ContextParse,
    diags: Map<string, SeverityCount>,
): ProjectImportJsonNode {
    const label = nodeLabel(fileNode.path, parentPath, rootDir);
    const name = path.basename(path.dirname(fileNode.path)) || path.basename(fileNode.path);
    if (fileNode.missing === true || fileNode.reference === true) {
        return {
            fsPath: fileNode.path,
            label,
            name,
            importableCount: 0,
            importables: [],
            children: [],
            missing: fileNode.missing === true || undefined,
            reference: fileNode.reference === true || undefined,
        };
    }

    const children = fileNode.includes.map((child) =>
        mapFileNode(child, fileNode.path, rootDir, parse, diags)
    );
    const importables = fileNode.importables
        .map((imp) => mapImportable(imp, fileNode.path, parse, diags))
        .filter((summary): summary is ProjectImportableSummary => summary !== null);

    const own = diags.get(pathKey(fileNode.path)) ?? { errors: 0, warnings: 0 };
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
        if (child.reference) continue;
        errors += child.errors ?? 0;
        warnings += child.warnings ?? 0;
    }

    return {
        fsPath: fileNode.path,
        label,
        name,
        importableCount: importables.length,
        importables,
        children,
        errors: errors || undefined,
        warnings: warnings || undefined,
    };
}

// Reference leaves mirror their home's badge so the jump link shows what it
// leads to; ancestors don't re-sum them (mapFileNode skips reference children).
function patchReferenceNodes(root: ProjectImportJsonNode): void {
    const homes = new Map<string, ProjectImportJsonNode>();
    const collect = (node: ProjectImportJsonNode): void => {
        if (!node.reference && !node.missing) homes.set(pathKey(node.fsPath), node);
        node.children.forEach(collect);
    };
    collect(root);
    const patch = (node: ProjectImportJsonNode): void => {
        if (node.reference) {
            const home = homes.get(pathKey(node.fsPath));
            if (home) {
                node.importableCount = subtreeImportableCount(home);
                node.errors = home.errors;
                node.warnings = home.warnings;
            }
        }
        node.children.forEach(patch);
    };
    patch(root);
}

const SUMMARY_TYPE: Partial<Record<htsw.types.Importable["type"], ProjectImportableSummary["type"]>> = {
    FUNCTION: "function",
    EVENT: "event",
    REGION: "region",
    ITEM: "item",
    MENU: "menu",
    COMMAND: "command",
    NPC: "npc",
};

const SUB_LIST_LABELS: Record<htsw.SubListKind, string> = {
    actions: "Actions",
    onEnterActions: "On enter",
    onExitActions: "On exit",
    leftClickActions: "Left click",
    rightClickActions: "Right click",
};

function mapImportable(
    imp: htsw.types.Importable,
    declaringPath: string,
    parse: ContextParse,
    diags: Map<string, SeverityCount>,
): ProjectImportableSummary | null {
    const type = SUMMARY_TYPE[imp.type];
    if (type === undefined) return null;
    const identity = imp.type === "EVENT"
        ? imp.event
        : imp.type === "NPC"
            ? `${imp.pos.x},${imp.pos.y},${imp.pos.z}`
            : (imp as { name: string }).name;
    const label = imp.type === "NPC" ? `${imp.name} @ ${identity}` : identity;

    const sourcePath = htsw.importableSourcePath(imp, parse.result);
    const openPath = sourcePath !== undefined ? sourcePath : declaringPath;
    // Only attribute diagnostics when the importable has its own source
    // file — otherwise every importable would inherit the import.json's.
    const ownDiag = pathKey(openPath) !== pathKey(declaringPath)
        ? diags.get(pathKey(openPath))
        : undefined;
    const subEntries = mapSubEntries(imp, declaringPath, parse, diags);

    return {
        id: `${declaringPath}|${type}|${identity}`,
        identity,
        label,
        type,
        typeLabel: imp.type,
        openPath,
        ...mapImportableIcon(imp),
        errors: ownDiag?.errors || undefined,
        warnings: ownDiag?.warnings || undefined,
        subEntries: subEntries.length > 0 ? subEntries : undefined,
    };
}

function mapImportableIcon(
    imp: htsw.types.Importable,
): { iconItem?: string; iconMeta?: number; iconCount?: number } {
    if (imp.type === "FUNCTION" && imp.icon !== undefined) {
        return { iconItem: imp.icon.item, iconCount: imp.icon.count };
    }
    if (imp.type === "ITEM" && imp.nbt.type === "compound") {
        const fields = imp.nbt.value as Record<string, { type: string; value: unknown } | undefined>;
        const id = fields.id;
        if (id?.type !== "string" || typeof id.value !== "string") return {};
        const damage = fields.Damage;
        const iconMeta = typeof damage?.value === "number" ? damage.value : undefined;
        return { iconItem: id.value, iconMeta };
    }
    return {};
}

function mapSubEntries(
    imp: htsw.types.Importable,
    declaringPath: string,
    parse: ContextParse,
    diags: Map<string, SeverityCount>,
): ProjectImportableSub[] {
    const out: ProjectImportableSub[] = [];
    const declaringKey = pathKey(declaringPath);
    // Inline JSON lists resolve to the manifest itself — no sub-row, same
    // as when these rows were read from `...Path: "file.htsl"` refs only.
    const pushActions = (label: string, fsPath: string | undefined): void => {
        if (fsPath === undefined || pathKey(fsPath) === declaringKey) return;
        out.push(subEntryFor(label, fsPath, "actions", diags));
    };

    for (const kind of htsw.SUB_LIST_KINDS) {
        if (htsw.subListOf(imp, kind) === undefined) continue;
        pushActions(SUB_LIST_LABELS[kind], htsw.importableSubListPath(imp, kind, parse.result));
    }

    if (imp.type === "MENU") {
        for (const slot of imp.slots) {
            const tag = `Slot ${slot.slot}`;
            const nbtPath = htsw.parsedObjectSourcePath(parse.result, slot.nbt);
            if (nbtPath !== undefined && pathKey(nbtPath) !== declaringKey) {
                out.push(subEntryFor(`${tag} item`, nbtPath, "item", diags));
            }
            if (slot.actions !== undefined) {
                pushActions(`${tag} actions`, htsw.actionListSourcePath(parse.result, slot.actions));
            }
        }
    }

    if (imp.type === "NPC" && imp.equipment !== undefined) {
        const pieces: Array<[string, string | undefined]> = [
            ["Helmet", imp.equipment.helmet],
            ["Chestplate", imp.equipment.chestplate],
            ["Leggings", imp.equipment.leggings],
            ["Boots", imp.equipment.boots],
            ["Hand", imp.equipment.hand],
        ];
        for (const [label, ref] of pieces) {
            if (ref === undefined) continue;
            const resolved = path.resolve(path.dirname(declaringPath), ref);
            if (nodeProjectFs.exists(resolved)) out.push(subEntryFor(label, resolved, "item", diags));
        }
    }

    return out;
}

function subEntryFor(
    label: string,
    fsPath: string,
    kind: "actions" | "item",
    diags: Map<string, SeverityCount>,
): ProjectImportableSub {
    const diag = diags.get(pathKey(fsPath));
    return { label, fsPath, kind, errors: diag?.errors || undefined, warnings: diag?.warnings || undefined };
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
// directory — "clocks", not the full "functions/clocks/import.json" path. When
// the include reaches outside the parent's folder, a parent-relative path would
// start with "../.." noise, so fall back to the ROOT import.json's directory
// (then the workspace) — "shared/menus-module", not "../../shared/menus-module".
// Roots keep their workspace-relative path so multiple roots stay distinguishable.
function nodeLabel(filePath: string, parentFilePath: string | null, rootDir: string): string {
    if (parentFilePath === null) return vscode.workspace.asRelativePath(filePath, false);
    let rel = path.relative(path.dirname(parentFilePath), filePath).split(path.sep).join("/");
    if (rel.startsWith("..")) {
        const fromRoot = path.relative(rootDir, filePath).split(path.sep).join("/");
        rel = fromRoot.startsWith("..")
            ? vscode.workspace.asRelativePath(filePath, false)
            : fromRoot;
    }
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

function subtreeImportableCount(node: ProjectImportJsonNode): number {
    return node.importableCount + node.children.reduce(
        (total, child) => total + (child.reference ? 0 : subtreeImportableCount(child)),
        0,
    );
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
        await postFreshProjectTree(webview);
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

// Pull just the item id and Damage out of an item's snbt for the row icon. A
// regex rather than a full parse: a malformed snbt still renders (it falls
// back to a type glyph) and the tree refresh stays a cheap read.
function openTextDocumentForPath(filePath: string): vscode.TextDocument | undefined {
    const key = pathKey(filePath);
    return vscode.workspace.textDocuments.find(
        (document) => document.uri.scheme === "file" && pathKey(document.uri.fsPath) === key,
    );
}

function pathKey(filePath: string): string {
    return path.resolve(filePath).split("\\").join("/").toLowerCase();
}
