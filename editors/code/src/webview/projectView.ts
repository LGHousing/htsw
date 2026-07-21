import * as path from "node:path";
import * as vscode from "vscode";
import { addGitDecorations } from "./gitDecorations";
import * as json from "jsonc-parser";
import * as htsw from "htsw";
import {
    createIncludedFolderInTree,
    createIncludedImportJsonFiles,
    collectFileRefs,
    htslTargetForCommandExport,
    htslTargetForEventExport,
    htslTargetForFunctionExport,
    importableEntryMatchesIdentity,
    moveImportableEntry,
    normalizeRelativeProjectPath,
    planDeleteImportableEntry,
    readEntryValue,
    removeIncludeFromImportJson,
    removeImportableEntryForDelete,
    renameImportableEntry,
    resolveImportableFile,
    upsertImportableEntry,
    type ProjectFs,
    type RefSlot,
    type Section,
} from "htsw-editor-common/project";
import { itemFieldsFromTag } from "htsw-editor-common/item/buildItemNbt";
import { nodeProjectFs } from "../nodeProjectFs";
import { absolutePathKey } from "../pathIdentity";
import {
    planProjectMutation,
    projectFsWithOpenDocuments,
    runProjectMutation,
} from "../projectMutation";
import { bumpWorkspaceGeneration, type ContextParse, getCachedRootParse } from "../rootParse";
import { isPathInExcludedDiagnosticFolder } from "../diagnosticExclusions";
import type {
    ItemEditorFromHostMessage,
    ItemPreviewData,
    ProjectFromHostMessage,
    ProjectImportableMetadata,
    ProjectImportableSub,
    ProjectImportableSummary,
    ProjectImportJsonNode,
    ProjectTextSpan,
    ProjectToHostMessage,
} from "./protocol";

type ItemTag = Parameters<typeof itemFieldsFromTag>[0];

const IMPORTABLE_SECTIONS = ["functions", "events", "regions", "items", "menus", "commands", "npcs", "teams", "groups"] as const;
type ImportableSection = typeof IMPORTABLE_SECTIONS[number];

export type ImportableContext = {
    importJsonPath?: unknown;
    importableKind?: unknown;
    importableIdentity?: unknown;
    selectedImportables?: unknown;
};

export type ImportJsonContext = {
    importJsonPath?: unknown;
    parentImportJsonPath?: unknown;
};

type SelectedImportable = {
    importJsonPath: string;
    kind: ProjectImportableSummary["type"];
    identity: string;
};

export async function handleProjectMessage(
    webview: vscode.Webview,
    message: ProjectToHostMessage,
): Promise<void> {
    switch (message.type) {
        case "requestProjectTree":
            if (message.fresh) {
                await postFreshProjectTree(webview);
            } else {
                await postProjectTree(webview);
            }
            return;
        case "openProjectFile":
            await openProjectFile(message.fsPath, message.preview);
            return;
        case "openImportableDeclaration":
            await openImportableDeclaration(message);
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
        case "openItemInEditor":
            await openItemInEditor(webview, message.snbtPath);
            return;
    }
}

// Parse an item .snbt and hand it to the Item Editor tab. Keeps the original
// tag so a later save preserves NBT the editor doesn't model.
async function openItemInEditor(webview: vscode.Webview, snbtPath: string): Promise<void> {
    try {
        if (!nodeProjectFs.exists(snbtPath)) {
            throw new Error(`File not found: ${vscode.workspace.asRelativePath(snbtPath, false)}`);
        }
        const text = projectFsWithOpenDocuments().readFile(snbtPath);
        const tag = htsw.nbt.parseSnbtText(text);
        const item = itemPreviewFromTag(tag);
        if (item === undefined) {
            throw new Error("This .snbt is not a valid item (missing a string id).");
        }
        await webview.postMessage({
            type: "loadItem",
            snbtPath,
            label: vscode.workspace.asRelativePath(snbtPath, false),
            item,
            tag,
        } satisfies ItemEditorFromHostMessage);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not open item: ${error}`);
    }
}

function itemPreviewFromTag(nbt: ItemTag): ItemPreviewData | undefined {
    const fields = itemFieldsFromTag(nbt);
    if (fields === null) return undefined;
    return {
        itemId: fields.itemName,
        metadata: fields.metadata,
        count: fields.count,
        displayName: fields.displayName,
        lore: fields.lore,
        enchants: fields.enchants,
    };
}

// Menu slots carry their parsed item as `slot.nbt`; npc-equipment items are
// only a path, so those are read + parsed on demand.
function itemPreviewForSub(nbt: ItemTag | undefined, fsPath: string): ItemPreviewData | undefined {
    if (nbt !== undefined) return itemPreviewFromTag(nbt);
    try {
        return itemPreviewFromTag(htsw.nbt.parseSnbtText(projectFsWithOpenDocuments().readFile(fsPath)));
    } catch {
        return undefined;
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
        const sourceKey = absolutePathKey(importJsonPath);

        const destinations: Array<vscode.QuickPickItem & { fsPath: string }> = [];
        const treeRootOf = new Map<string, string>();
        const visit = (node: ProjectImportJsonNode, treeRoot: string): void => {
            if (node.missing || node.cycle || node.reference) return;
            treeRootOf.set(absolutePathKey(node.fsPath), treeRoot);
            if (absolutePathKey(node.fsPath) !== sourceKey) {
                destinations.push({
                    label: vscode.workspace.asRelativePath(node.fsPath, false),
                    fsPath: node.fsPath,
                });
            }
            node.children.forEach((child) => visit(child, treeRoot));
        };
        roots.forEach((root) => visit(root, root.fsPath));

        const newFolderItem: vscode.QuickPickItem & { fsPath: null } = {
            label: "$(new-folder) New folder…",
            description: "Create an import.json and move there",
            fsPath: null,
        };
        const pick = await vscode.window.showQuickPick(
            [newFolderItem, ...destinations],
            { placeHolder: `Move ${kind} "${identity}" to…` }
        );
        if (!pick) return;

        // Walk the whole tree from its root so files also referenced by other
        // declarations get copied instead of moved.
        const entryJsonPath = treeRootOf.get(sourceKey) ?? importJsonPath;

        let newFolderPath: string | null = null;
        if (pick.fsPath === null) {
            const folderPath = await vscode.window.showInputBox({
                prompt: "New folder, relative to the project root",
                placeHolder: "functions/combat",
                validateInput: (value) => {
                    try {
                        normalizeRelativeProjectPath(value);
                        return undefined;
                    } catch (err) {
                        return err instanceof Error ? err.message : String(err);
                    }
                },
            });
            if (!folderPath) return;
            newFolderPath = folderPath;
        }

        const selectedDestination = pick.fsPath;
        const destJsonPath = await runProjectMutation((fs) => {
            const destination = selectedDestination ?? createIncludedFolderInTree(
                fs,
                entryJsonPath,
                newFolderPath!,
            ).importJsonPath;
            moveImportableOrThrow(fs, entryJsonPath, section, identity, destination);
            return destination;
        });

        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Moved ${kind} "${identity}" to ${vscode.workspace.asRelativePath(destJsonPath, false)}.`,
        } satisfies ProjectFromHostMessage);
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not move importable: ${error}`);
    }
}

export async function moveImportableFromContext(
    webview: vscode.Webview,
    context: ImportableContext | undefined,
): Promise<void> {
    const selection = parseSelectedImportables(context);
    if (selection.length > 1) {
        await moveImportables(webview, selection);
        return;
    }
    const parsed = parseImportableContext(context);
    if (!parsed) return;
    await moveImportable(webview, parsed.importJsonPath, parsed.kind, parsed.identity);
}

export async function deleteImportableFromContext(
    webview: vscode.Webview,
    context: ImportableContext | undefined,
): Promise<void> {
    const selection = parseSelectedImportables(context);
    if (selection.length > 1) {
        await deleteImportables(webview, selection);
        return;
    }
    const parsed = parseImportableContext(context);
    if (!parsed) return;
    await deleteImportable(webview, parsed.importJsonPath, parsed.kind, parsed.identity);
}

export async function deleteImportJsonFromContext(
    webview: vscode.Webview,
    context: ImportJsonContext | undefined,
): Promise<void> {
    const parsed = parseImportJsonContext(context);
    if (!parsed) return;
    await deleteImportJsonProject(webview, parsed.importJsonPath, parsed.parentImportJsonPath);
}

export async function renameImportableFromContext(
    webview: vscode.Webview,
    context: ImportableContext | undefined,
): Promise<void> {
    const parsed = parseImportableContext(context);
    if (!parsed) return;
    await renameImportable(webview, parsed.importJsonPath, parsed.kind, parsed.identity);
}

export async function revealImportableFromContext(
    webview: vscode.Webview,
    context: ImportableContext | undefined,
): Promise<void> {
    const parsed = parseImportableContext(context);
    if (!parsed) return;
    await revealImportable(webview, parsed.importJsonPath, parsed.kind, parsed.identity);
}

export async function copyImportablePathFromContext(
    webview: vscode.Webview,
    context: ImportableContext | undefined,
): Promise<void> {
    const parsed = parseImportableContext(context);
    if (!parsed) return;
    await copyImportablePath(webview, parsed.importJsonPath, parsed.kind, parsed.identity);
}

async function renameImportable(
    webview: vscode.Webview,
    importJsonPath: string,
    kind: ProjectImportableSummary["type"],
    identity: string,
): Promise<void> {
    try {
        const section = SECTION_BY_KIND[kind];
        const readFs = projectFsWithOpenDocuments();
        const entryJsonPath = await treeRootForImportJson(importJsonPath);
        const declaringJsonPath = resolveImportableFile(readFs, entryJsonPath, section, identity);
        const value = await vscode.window.showInputBox({
            prompt: `Rename ${kind} "${identity}"`,
            value: identity,
            valueSelection: [0, identity.length],
            validateInput: (input) => {
                const next = input.trim();
                if (!next) return "Enter a name.";
                if (next !== identity && importableExists(readFs, declaringJsonPath, section, next)) {
                    return `A ${kind} named "${next}" already exists.`;
                }
                return undefined;
            },
        });
        if (value === undefined) return;
        const nextIdentity = value.trim();

        const renamed = await runProjectMutation((fs) =>
            renameImportableEntry(fs, entryJsonPath, section, identity, nextIdentity)
        );
        if (!renamed) throw new Error(`Couldn't rename '${identity}' in ${declaringJsonPath}`);

        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Renamed ${kind} "${identity}" to "${nextIdentity}".`,
        } satisfies ProjectFromHostMessage);
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not rename importable: ${error}`);
    }
}

async function revealImportable(
    webview: vscode.Webview,
    importJsonPath: string,
    kind: ProjectImportableSummary["type"],
    identity: string,
): Promise<void> {
    try {
        const targetPath = await importablePrimaryPath(importJsonPath, SECTION_BY_KIND[kind], identity);
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(targetPath));
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not reveal importable: ${error}`);
    }
}

async function copyImportablePath(
    webview: vscode.Webview,
    importJsonPath: string,
    kind: ProjectImportableSummary["type"],
    identity: string,
): Promise<void> {
    try {
        const targetPath = await importablePrimaryPath(importJsonPath, SECTION_BY_KIND[kind], identity);
        await vscode.env.clipboard.writeText(targetPath);
        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: "Copied path",
        } satisfies ProjectFromHostMessage);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not copy importable path: ${error}`);
    }
}

async function deleteImportable(
    webview: vscode.Webview,
    importJsonPath: string,
    kind: ProjectImportableSummary["type"],
    identity: string,
): Promise<void> {
    try {
        const section = SECTION_BY_KIND[kind];
        const entryJsonPath = await treeRootForImportJson(importJsonPath);
        const plan = planDeleteImportableEntry(projectFsWithOpenDocuments(), entryJsonPath, section, identity);
        if (!plan.ok) throw new Error(plan.message);

        const deleteFilesLabel = "Delete entry and files";
        const removeEntryLabel = "Remove entry only";
        const ownedRelative = plan.ownedFiles.map((filePath) => vscode.workspace.asRelativePath(filePath, false));
        const target = `${kind} "${identity}"`;
        const message =
            `Delete ${target}?\n\n` +
            `This will remove the entry from ${vscode.workspace.asRelativePath(plan.importJsonPath, false)}.` +
            (ownedRelative.length > 0
                ? `\n\nFiles to delete:\n${ownedRelative.map((filePath) => `- ${filePath}`).join("\n")}`
                : "\n\nNo files will be deleted.");
        const buttons = ownedRelative.length > 0 ? [deleteFilesLabel, removeEntryLabel] : [removeEntryLabel];
        const choice = await vscode.window.showWarningMessage(message, { modal: true }, ...buttons);
        if (!choice) return;

        const result = await runProjectMutation((fs) =>
            removeImportableEntryForDelete(fs, entryJsonPath, section, identity)
        );
        if (!result.ok) throw new Error(result.message);
        const approvedOwnedFiles = new Set(plan.ownedFiles.map(absolutePathKey));
        const filesToDelete = result.ownedFiles.filter((filePath) => approvedOwnedFiles.has(absolutePathKey(filePath)));

        let filesDeleted = 0;
        const fileFailures: string[] = [];
        if (choice === deleteFilesLabel) {
            for (const filePath of filesToDelete) {
                try {
                    if (await deletePathToTrashIfPresent(filePath)) filesDeleted++;
                } catch (err) {
                    fileFailures.push(
                        `${vscode.workspace.asRelativePath(filePath, false)}: ` +
                        (err instanceof Error ? err.message : String(err)),
                    );
                }
            }
        }

        const suffix = filesDeleted > 0
            ? ` and ${filesDeleted} file${filesDeleted === 1 ? "" : "s"}`
            : "";
        await webview.postMessage(fileFailures.length === 0
            ? {
                type: "projectResult",
                ok: true,
                message: `Deleted ${target}${suffix}.`,
            }
            : {
                type: "projectResult",
                ok: false,
                error: `Removed ${target}, but could not delete ${fileFailures.length} file${fileFailures.length === 1 ? "" : "s"}: ${fileFailures.join("; ")}`,
            } satisfies ProjectFromHostMessage);
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not delete importable: ${error}`);
    }
}

async function deleteImportJsonProject(
    webview: vscode.Webview,
    importJsonPath: string,
    parentImportJsonPath: string | null,
): Promise<void> {
    try {
        const dir = path.dirname(importJsonPath);
        const relativeDir = vscode.workspace.asRelativePath(dir, false);
        const parentLine = parentImportJsonPath === null
            ? ""
            : `\n\nThis will also remove it from ${vscode.workspace.asRelativePath(parentImportJsonPath, false)}.`;
        const choice = await vscode.window.showWarningMessage(
            `Delete ${relativeDir}?\n\nThis moves the whole folder to the trash.${parentLine}`,
            { modal: true },
            "Delete Folder",
        );
        if (choice !== "Delete Folder") return;

        if (parentImportJsonPath !== null) {
            await runProjectMutation((fs) => {
                if (!removeIncludeFromImportJson(fs, parentImportJsonPath, importJsonPath)) {
                    throw new Error(
                        `Could not remove include from ${vscode.workspace.asRelativePath(parentImportJsonPath, false)}.`
                    );
                }
            });
        }

        await deletePathToTrashIfPresent(dir, true);
        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Deleted ${relativeDir}.`,
        } satisfies ProjectFromHostMessage);
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not delete import.json project: ${error}`);
    }
}

async function moveImportables(webview: vscode.Webview, items: SelectedImportable[]): Promise<void> {
    try {
        const roots = await discoverProjectTree();
        const destinations: Array<vscode.QuickPickItem & { fsPath: string }> = [];
        const treeRootOf = new Map<string, string>();
        const visit = (node: ProjectImportJsonNode, treeRoot: string): void => {
            if (node.missing || node.cycle || node.reference) return;
            treeRootOf.set(absolutePathKey(node.fsPath), treeRoot);
            destinations.push({
                label: vscode.workspace.asRelativePath(node.fsPath, false),
                fsPath: node.fsPath,
            });
            node.children.forEach((child) => visit(child, treeRoot));
        };
        roots.forEach((root) => visit(root, root.fsPath));

        const newFolderItem: vscode.QuickPickItem & { fsPath: null } = {
            label: "$(new-folder) New folder…",
            description: "Create an import.json and move there",
            fsPath: null,
        };
        const pick = await vscode.window.showQuickPick(
            [newFolderItem, ...destinations],
            { placeHolder: `Move ${items.length} items to…` }
        );
        if (!pick) return;

        let newFolderPath: string | null = null;
        if (pick.fsPath === null) {
            const folderPath = await vscode.window.showInputBox({
                prompt: "New folder, relative to the project root",
                placeHolder: "functions/combat",
                validateInput: (value) => {
                    try {
                        normalizeRelativeProjectPath(value);
                        return undefined;
                    } catch (err) {
                        return err instanceof Error ? err.message : String(err);
                    }
                },
            });
            if (!folderPath) return;
            newFolderPath = folderPath;
        }

        const prepared: Array<{ item: SelectedImportable; section: Section; entryJsonPath: string }> = [];
        for (const item of items) {
            prepared.push({
                item,
                section: SECTION_BY_KIND[item.kind],
                entryJsonPath: treeRootOf.get(absolutePathKey(item.importJsonPath))
                    ?? await treeRootForImportJson(item.importJsonPath),
            });
        }

        const selectedDestination = pick.fsPath;
        const anchorRoot = treeRootOf.get(absolutePathKey(items[0].importJsonPath)) ?? roots[0]?.fsPath;
        if (selectedDestination === null && !anchorRoot) {
            throw new Error("No project root to create a folder in.");
        }
        const result = await runProjectMutation((fs) => {
            const destJsonPath = selectedDestination ?? createIncludedFolderInTree(
                fs,
                anchorRoot!,
                newFolderPath!,
            ).importJsonPath;
            const destKey = absolutePathKey(destJsonPath);
            let moved = 0;
            for (const { item, section, entryJsonPath } of prepared) {
                const current = resolveImportableFile(fs, entryJsonPath, section, item.identity);
                if (absolutePathKey(current) === destKey) continue;
                try {
                    moveImportableOrThrow(fs, entryJsonPath, section, item.identity, destJsonPath);
                    moved++;
                } catch (err) {
                    throw new Error(
                        `${item.kind} "${item.identity}": ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            }
            return { destJsonPath, moved };
        });

        const { destJsonPath, moved } = result;
        const rel = vscode.workspace.asRelativePath(destJsonPath, false);
        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Moved ${moved} item${moved === 1 ? "" : "s"} to ${rel}.`,
        } satisfies ProjectFromHostMessage);
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not move importables: ${error}`);
    }
}

async function deleteImportables(webview: vscode.Webview, items: SelectedImportable[]): Promise<void> {
    try {
        const plans: Array<{ item: SelectedImportable; section: Section; entryJsonPath: string }> = [];
        for (const item of items) {
            const section = SECTION_BY_KIND[item.kind];
            const entryJsonPath = await treeRootForImportJson(item.importJsonPath);
            plans.push({ item, section, entryJsonPath });
        }

        const ownedFiles = planProjectMutation((fs) => removeSelectedImportables(fs, plans));
        const ownedRelative = ownedFiles.map((filePath) => vscode.workspace.asRelativePath(filePath, false));
        const deleteFilesLabel = `Delete ${items.length} entries and files`;
        const removeEntryLabel = `Remove ${items.length} entries only`;
        const entryList = items.map((item) => `- ${item.kind} "${item.identity}"`).join("\n");
        const message =
            `Delete ${items.length} importables?\n\n${entryList}` +
            (ownedRelative.length > 0
                ? `\n\nFiles to delete:\n${ownedRelative.map((filePath) => `- ${filePath}`).join("\n")}`
                : "\n\nNo files will be deleted.");
        const buttons = ownedRelative.length > 0 ? [deleteFilesLabel, removeEntryLabel] : [removeEntryLabel];
        const choice = await vscode.window.showWarningMessage(message, { modal: true }, ...buttons);
        if (!choice) return;

        const committedOwnedFiles = await runProjectMutation((fs) => removeSelectedImportables(fs, plans));
        const approvedOwnedFiles = new Set(ownedFiles.map(absolutePathKey));
        const filesToDelete = committedOwnedFiles.filter(
            (filePath) => approvedOwnedFiles.has(absolutePathKey(filePath)),
        );

        let filesDeleted = 0;
        const fileFailures: string[] = [];
        if (choice === deleteFilesLabel) {
            for (const filePath of filesToDelete) {
                try {
                    if (await deletePathToTrashIfPresent(filePath)) filesDeleted++;
                } catch (err) {
                    fileFailures.push(
                        `${vscode.workspace.asRelativePath(filePath, false)}: ` +
                        (err instanceof Error ? err.message : String(err)),
                    );
                }
            }
        }

        const suffix = filesDeleted > 0 ? ` and ${filesDeleted} file${filesDeleted === 1 ? "" : "s"}` : "";
        await webview.postMessage(fileFailures.length === 0
            ? {
                type: "projectResult",
                ok: true,
                message: `Deleted ${plans.length} importable${plans.length === 1 ? "" : "s"}${suffix}.`,
            }
            : {
                type: "projectResult",
                ok: false,
                error: `Removed ${plans.length} importable${plans.length === 1 ? "" : "s"}, but could not delete ${fileFailures.length} file${fileFailures.length === 1 ? "" : "s"}: ${fileFailures.join("; ")}`,
            } satisfies ProjectFromHostMessage);
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not delete importables: ${error}`);
    }
}

function removeSelectedImportables(
    fs: ProjectFs,
    plans: ReadonlyArray<{ item: SelectedImportable; section: Section; entryJsonPath: string }>,
): string[] {
    const owned = new Map<string, string>();
    for (const { item, section, entryJsonPath } of plans) {
        const result = removeImportableEntryForDelete(fs, entryJsonPath, section, item.identity);
        if (!result.ok) throw new Error(`${item.kind} "${item.identity}": ${result.message}`);
        for (const filePath of result.ownedFiles) owned.set(absolutePathKey(filePath), filePath);
    }
    return [...owned.values()];
}

async function deletePathToTrashIfPresent(filePath: string, recursive = false): Promise<boolean> {
    try {
        await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { recursive, useTrash: true });
        return true;
    } catch (err) {
        if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") return false;
        throw err;
    }
}

function parseImportableContext(context: ImportableContext | undefined): {
    importJsonPath: string;
    kind: ProjectImportableSummary["type"];
    identity: string;
} | null {
    if (!context) return null;
    if (typeof context.importJsonPath !== "string") return null;
    if (typeof context.importableKind !== "string") return null;
    if (typeof context.importableIdentity !== "string") return null;
    if (!isImportableKind(context.importableKind)) return null;
    return {
        importJsonPath: context.importJsonPath,
        kind: context.importableKind,
        identity: context.importableIdentity,
    };
}

function parseImportJsonContext(context: ImportJsonContext | undefined): {
    importJsonPath: string;
    parentImportJsonPath: string | null;
} | null {
    if (!context) return null;
    if (typeof context.importJsonPath !== "string") return null;
    return {
        importJsonPath: context.importJsonPath,
        parentImportJsonPath: typeof context.parentImportJsonPath === "string"
            ? context.parentImportJsonPath
            : null,
    };
}

function isImportableKind(value: string): value is ProjectImportableSummary["type"] {
    return Object.prototype.hasOwnProperty.call(SECTION_BY_KIND, value);
}

function parseSelectedImportables(context: ImportableContext | undefined): SelectedImportable[] {
    const raw = context?.selectedImportables;
    if (!Array.isArray(raw)) return [];
    const out: SelectedImportable[] = [];
    for (const element of raw) {
        if (!element || typeof element !== "object") continue;
        const item = element as Record<string, unknown>;
        if (typeof item.importJsonPath !== "string") continue;
        if (typeof item.importableKind !== "string" || !isImportableKind(item.importableKind)) continue;
        if (typeof item.importableIdentity !== "string") continue;
        out.push({
            importJsonPath: item.importJsonPath,
            kind: item.importableKind,
            identity: item.importableIdentity,
        });
    }
    return out;
}

async function treeRootForImportJson(importJsonPath: string): Promise<string> {
    const sourceKey = absolutePathKey(importJsonPath);
    const roots = await discoverProjectTree();
    let found: string | undefined;
    const visit = (node: ProjectImportJsonNode, treeRoot: string): void => {
        if (found || node.missing || node.cycle || node.reference) return;
        if (absolutePathKey(node.fsPath) === sourceKey) {
            found = treeRoot;
            return;
        }
        node.children.forEach((child) => visit(child, treeRoot));
    };
    roots.forEach((root) => visit(root, root.fsPath));
    return found ?? importJsonPath;
}

const SECTION_BY_KIND: Record<ProjectImportableSummary["type"], ImportableSection> = {
    function: "functions",
    event: "events",
    region: "regions",
    item: "items",
    menu: "menus",
    command: "commands",
    npc: "npcs",
    team: "teams",
    group: "groups",
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
        const result = await runProjectMutation((fs) => {
            let targetImportJson = importJsonPath;
            const entry: Record<string, unknown> = {};
            const created: string[] = [];

            if (kind === "function" || kind === "event" || kind === "command") {
                const target = kind === "function"
                    ? htslTargetForFunctionExport(fs, importJsonPath, id)
                    : kind === "event"
                        ? htslTargetForEventExport(fs, importJsonPath, id)
                        : htslTargetForCommandExport(fs, importJsonPath, id);
                targetImportJson = target.importJsonPath;
                requireNew(fs, targetImportJson, section, id, kind);
                if (!fs.exists(target.htslPath)) {
                    fs.ensureDir(path.dirname(target.htslPath));
                    fs.writeFile(target.htslPath, "\n");
                    created.push(target.htslPath);
                }
                entry[kind === "event" ? "event" : "name"] = id;
                entry.actions = target.htslReference;
            } else {
                targetImportJson = resolveImportableFile(fs, importJsonPath, section, id);
                requireNew(fs, targetImportJson, section, id, kind);
                entry.name = id;
                if (kind === "menu") entry.slots = [];
            }

            upsertImportableEntry(fs, targetImportJson, section, entry);
            return { targetImportJson, created };
        });

        await openProjectFile(result.created[0] ?? result.targetImportJson, false);
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

function moveImportableOrThrow(
    fs: ProjectFs,
    entryJsonPath: string,
    section: Section,
    identity: string,
    destJsonPath: string,
): void {
    const result = moveImportableEntry(fs, entryJsonPath, section, identity, destJsonPath);
    if (!result.ok) throw new Error(result.message);
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

async function importablePrimaryPath(
    importJsonPath: string,
    section: Section,
    identity: string,
): Promise<string> {
    const fs = projectFsWithOpenDocuments();
    const entryJsonPath = await treeRootForImportJson(importJsonPath);
    const declaringJsonPath = resolveImportableFile(fs, entryJsonPath, section, identity);
    const entry = readEntryValue(fs, declaringJsonPath, section, identity);
    if (entry === null) throw new Error(`Couldn't find '${identity}' in ${declaringJsonPath}`);

    const refs: RefSlot[] = [];
    collectFileRefs(entry, refs);
    for (const ref of refs) {
        const sourcePath = fs.resolvePath(fs.parentDir(declaringJsonPath), ref.ref);
        if (fs.exists(sourcePath)) return sourcePath;
    }
    return declaringJsonPath;
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
    const importJsons = await vscode.workspace.findFiles(
        "**/{import.json,*.import.json}",
        "**/{node_modules,.git}/**",
    );
    const importJsonKeys = new Set(importJsons.map((uri) => absolutePathKey(uri.fsPath)));
    const includedKeys = new Set<string>();
    const fs = projectFsWithOpenDocuments();

    for (const uri of importJsons) {
        collectIncludedKeys(fs, uri.fsPath, importJsonKeys, includedKeys, new Set<string>());
    }

    const rootUris = importJsons.filter((uri) => !includedKeys.has(absolutePathKey(uri.fsPath)));
    const roots = rootUris.length > 0 ? rootUris : importJsons;
    const projectRoots = roots
        .map((uri) => rootNodeFromParse(uri.fsPath))
        .sort((left, right) => left.label.localeCompare(right.label));
    await addGitDecorations(projectRoots);
    return projectRoots;
}

// The tree is a projection of the LANGUAGE parse — the same fileTree (homes,
// jump-link references, missing includes) the in-game Importables tree
// renders, served from the generation-keyed cache the diagnostics adapter
// shares — so the two UIs can't drift and refreshes don't re-read the world.
function rootNodeFromParse(rootPath: string): ProjectImportJsonNode {
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
    const node = mapFileNode(tree, null, rootDir, parse).node;
    patchReferenceNodes(node);
    return node;
}

type MappedFileNode = { node: ProjectImportJsonNode; filePaths: Set<string> };

function mapFileNode(
    fileNode: htsw.ImportJsonFileNode,
    parentPath: string | null,
    rootDir: string,
    parse: ContextParse,
): MappedFileNode {
    const label = nodeLabel(fileNode.path, parentPath, rootDir);
    const name = path.basename(path.dirname(fileNode.path)) || path.basename(fileNode.path);
    if (fileNode.missing === true || fileNode.reference === true) {
        return {
            node: {
                fsPath: fileNode.path,
                parentFsPath: parentPath ?? undefined,
                label,
                name,
                importableCount: 0,
                importables: [],
                children: [],
                missing: fileNode.missing === true || undefined,
                reference: fileNode.reference === true || undefined,
            },
            filePaths: new Set([fileNode.path]),
        };
    }

    const mappedChildren = fileNode.includes.map((child) =>
        mapFileNode(child, fileNode.path, rootDir, parse)
    );
    const children = mappedChildren.map((child) => child.node);
    const importables = fileNode.importables
        .map((imp) => mapImportable(imp, fileNode.path, parse))
        .filter((summary): summary is ProjectImportableSummary => summary !== null);

    const filePaths = new Set<string>([fileNode.path]);
    for (const imp of fileNode.importables) {
        for (const filePath of htsw.importableFilePaths(imp)) filePaths.add(filePath);
    }
    for (const child of mappedChildren) {
        if (child.node.reference) continue;
        child.filePaths.forEach((filePath) => filePaths.add(filePath));
    }

    const total = sumFileCounts(parse, filePaths);

    return {
        node: {
            fsPath: fileNode.path,
            parentFsPath: parentPath ?? undefined,
            label,
            name,
            importableCount: importables.length,
            importables,
            children,
            errors: total.errors || undefined,
            warnings: total.warnings || undefined,
        },
        filePaths,
    };
}

// Reference leaves mirror their home's badge so the jump link shows what it
// leads to; ancestors don't re-sum them (mapFileNode skips reference children).
function patchReferenceNodes(root: ProjectImportJsonNode): void {
    const homes = new Map<string, ProjectImportJsonNode>();
    const collect = (node: ProjectImportJsonNode): void => {
        if (!node.reference && !node.missing) homes.set(absolutePathKey(node.fsPath), node);
        node.children.forEach(collect);
    };
    collect(root);
    const patch = (node: ProjectImportJsonNode): void => {
        if (node.reference) {
            const home = homes.get(absolutePathKey(node.fsPath));
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

// Total on Importable["type"] (not Partial) so a new importable type is a
// compile error here until it's mapped, rather than silently dropped from the
// panel. A `null` entry opts a type out of the panel explicitly.
const SUMMARY_TYPE: Record<htsw.types.Importable["type"], ProjectImportableSummary["type"] | null> = {
    FUNCTION: "function",
    EVENT: "event",
    REGION: "region",
    ITEM: "item",
    MENU: "menu",
    COMMAND: "command",
    NPC: "npc",
    TEAM: "team",
    GROUP: "group",
};

const CHILD_LIST_LABELS: Record<htsw.ImportableChildListName, string> = {
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
): ProjectImportableSummary | null {
    const type = SUMMARY_TYPE[imp.type];
    if (type === null) return null;
    const identity = imp.type === "EVENT"
        ? imp.event
        : imp.type === "NPC"
            ? `${imp.pos.x},${imp.pos.y},${imp.pos.z}`
            : (imp as { name: string }).name;
    const label = imp.type === "NPC" ? `${imp.name} @ ${identity}` : identity;

    const sourcePath = externalImportableSourcePath(imp, declaringPath);
    const own = ownDiagnosticCounts(parse, imp);
    const subEntries = mapSubEntries(imp, declaringPath, parse);
    const metadataEntries = metadataEntriesOf(imp);

    return {
        id: `${declaringPath}|${type}|${identity}`,
        identity,
        label,
        type,
        typeLabel: imp.type,
        sourcePath,
        declarationSpan: localImportableSpan(imp, declaringPath, parse),
        ...mapImportableIcon(imp),
        repeatTicks: imp.type === "FUNCTION" ? imp.repeatTicks : undefined,
        item: imp.type === "ITEM" ? itemPreviewFromTag(imp.nbt) : undefined,
        errors: own.errors || undefined,
        warnings: own.warnings || undefined,
        subEntries: subEntries.length > 0 ? subEntries : undefined,
        metadataEntries: metadataEntries.length > 0 ? metadataEntries : undefined,
    };
}

function metadataEntriesOf(imp: htsw.types.Importable): ProjectImportableMetadata[] {
    if (imp.type === "FUNCTION") {
        const fields: ProjectImportableMetadata[] = [
            {
                label: "Repeat",
                value: imp.repeatTicks !== undefined ? `${imp.repeatTicks}t` : "off",
                jsonPath: ["repeatTicks"],
            },
            {
                label: "Icon",
                value: imp.icon !== undefined ? imp.icon.item : "default",
                jsonPath: ["icon"],
            },
        ];
        if (imp.icon !== undefined) {
            fields.push({
                label: "Count",
                value: imp.icon.count !== undefined ? String(imp.icon.count) : "1",
                jsonPath: ["icon", "count"],
            });
        }
        return fields;
    }
    if (imp.type === "COMMAND") {
        return [
            { label: "Mode", value: imp.mode ?? "Self", jsonPath: ["mode"] },
            { label: "Priority", value: String(imp.requiredPriority ?? 0), jsonPath: ["requiredPriority"] },
            { label: "Listed", value: (imp.listed ?? true) ? "true" : "false", jsonPath: ["listed"] },
        ];
    }
    if (imp.type === "REGION") {
        if (imp.bounds === undefined) {
            return [{ label: "Bounds", value: "(not set)", jsonPath: ["bounds"] }];
        }
        return [
            { label: "From", value: formatPos(imp.bounds.from), jsonPath: ["bounds", "from"] },
            { label: "To", value: formatPos(imp.bounds.to), jsonPath: ["bounds", "to"] },
        ];
    }
    if (imp.type === "MENU") {
        return [{ label: "Size", value: imp.size !== undefined ? `${imp.size} lines` : "default", jsonPath: ["size"] }];
    }
    if (imp.type === "NPC") {
        return [
            { label: "Pos", value: formatPos(imp.pos), jsonPath: ["pos"] },
            {
                label: "Redirect",
                value: imp.leftClickRedirect === undefined ? "default" : imp.leftClickRedirect ? "true" : "false",
                jsonPath: ["leftClickRedirect"],
            },
        ];
    }
    if (imp.type === "ITEM") {
        return [{ label: "NBT", value: "Item data", jsonPath: ["nbt"] }];
    }
    return [];
}

function formatPos(pos: { x: number; y: number; z: number }): string {
    return `${pos.x}, ${pos.y}, ${pos.z}`;
}

function externalImportableSourcePath(
    imp: htsw.types.Importable,
    declaringPath: string,
): string | undefined {
    const sourcePath = htsw.importableSourcePath(imp);
    return sourcePath !== undefined && absolutePathKey(sourcePath) !== absolutePathKey(declaringPath)
        ? sourcePath
        : undefined;
}

function localImportableSpan(
    imp: htsw.types.Importable,
    declaringPath: string,
    parse: ContextParse,
): ProjectTextSpan | undefined {
    try {
        const span = parse.result.spans.get(imp);
        const sourceFile = parse.sourceMap.getFile(declaringPath);
        const start = span.start - sourceFile.startPos;
        const end = span.end - sourceFile.startPos;
        if (start < 0 || end < start || end > sourceFile.src.length) return undefined;
        return { start, end };
    } catch (_error) {
        return undefined;
    }
}

function mapImportableIcon(
    imp: htsw.types.Importable,
): { iconItem?: string; iconMeta?: number; iconCount?: number } {
    if (imp.type === "FUNCTION" && imp.icon !== undefined) {
        return {
            iconItem: imp.icon.item,
            iconCount: imp.icon.count,
        };
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
): ProjectImportableSub[] {
    const out: ProjectImportableSub[] = [];
    const declaringKey = absolutePathKey(declaringPath);
    // Inline JSON lists resolve to the import.json itself — no sub-row, same
    // as when these rows were read from `...Path: "file.htsl"` refs only.
    const pushActions = (label: string, fsPath: string | undefined): void => {
        if (fsPath === undefined || absolutePathKey(fsPath) === declaringKey) return;
        out.push(subEntryFor(label, fsPath, "actions", parse));
    };

    for (const kind of htsw.IMPORTABLE_CHILD_LIST_NAMES) {
        if (htsw.childListOf(imp, kind) === undefined) continue;
        pushActions(CHILD_LIST_LABELS[kind], htsw.importableChildListPath(imp, kind));
    }

    if (imp.type === "MENU") {
        for (const slot of imp.slots) {
            const tag = `Slot ${slot.slot}`;
            if (slot.nbtPath !== undefined && absolutePathKey(slot.nbtPath) !== declaringKey) {
                out.push(subEntryFor(`${tag} item`, slot.nbtPath, "item", parse, slot.nbt));
            }
            if (slot.actions !== undefined) {
                pushActions(`${tag} actions`, slot.actionsPath);
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
            if (nodeProjectFs.exists(resolved)) out.push(subEntryFor(label, resolved, "item", parse));
        }
    }

    return out;
}

function subEntryFor(
    label: string,
    fsPath: string,
    kind: "actions" | "item",
    parse: ContextParse,
    nbt?: ItemTag,
): ProjectImportableSub {
    const diag = countsForFile(parse, fsPath);
    return {
        label,
        fsPath,
        kind,
        item: kind === "item" ? itemPreviewForSub(nbt, fsPath) : undefined,
        errors: diag?.errors || undefined,
        warnings: diag?.warnings || undefined,
    };
}

type SeverityCount = htsw.SeverityCounts;

function countsForFile(parse: ContextParse, rawPath: string): SeverityCount {
    if (isPathInExcludedDiagnosticFolder(rawPath)) return { errors: 0, warnings: 0 };
    return htsw.diagnosticCountsForFile(parse.result, rawPath);
}

function sumFileCounts(parse: ContextParse, rawPaths: Set<string>): SeverityCount {
    let errors = 0;
    let warnings = 0;
    rawPaths.forEach((rawPath) => {
        const count = countsForFile(parse, rawPath);
        errors += count.errors;
        warnings += count.warnings;
    });
    return { errors, warnings };
}

// A single importable's own diagnostics, span-attributed so importables that
// share one import.json (inline teams/groups) don't each show the file's total.
// Still honors htsw.diagnostics.excludeFolders, per the diagnostic's own file.
function ownDiagnosticCounts(parse: ContextParse, imp: htsw.types.Importable): SeverityCount {
    const ds = htsw.attributeDiagnostics(parse.result).byImportable.get(imp);
    if (ds === undefined) return { errors: 0, warnings: 0 };
    const sm = parse.result.gcx.sourceMap;
    let errors = 0;
    let warnings = 0;
    for (const d of ds) {
        const primary = d.spans.find((s) => s.kind === "primary") ?? d.spans[0];
        let filePath: string | undefined;
        if (primary !== undefined) {
            try {
                filePath = sm.getFileByPos(primary.span.start).path;
            } catch (_e) {
                filePath = undefined;
            }
        }
        if (filePath !== undefined && isPathInExcludedDiagnosticFolder(filePath)) continue;
        if (d.level === "error" || d.level === "bug") errors++;
        else if (d.level === "warning") warnings++;
    }
    return { errors, warnings };
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
    knownImportJsons: Set<string>,
    includedKeys: Set<string>,
    stack: Set<string>,
): void {
    const key = absolutePathKey(filePath);
    if (stack.has(key) || !fs.exists(filePath)) return;
    stack.add(key);
    for (const includePath of readIncludePaths(fs, filePath)) {
        const resolved = fs.resolvePath(fs.parentDir(filePath), includePath);
        const resolvedKey = absolutePathKey(resolved);
        if (knownImportJsons.has(resolvedKey)) includedKeys.add(resolvedKey);
        collectIncludedKeys(fs, resolved, knownImportJsons, includedKeys, stack);
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

        const result = await runProjectMutation((fs) => createIncludedImportJsonFiles(
            fs,
            path.dirname(parentImportJsonPath),
            folderPath,
            parentImportJsonPath,
        ));

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

async function openImportableDeclaration(
    message: Extract<ProjectToHostMessage, { type: "openImportableDeclaration" }>,
): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(message.importJsonPath));
    const selection = importableDeclarationRange(document, message);
    const options: vscode.TextDocumentShowOptions = { preview: message.preview };
    if (selection !== undefined) options.selection = selection;
    const editor = await vscode.window.showTextDocument(document, options);
    if (selection !== undefined) {
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
}

function importableDeclarationRange(
    document: vscode.TextDocument,
    message: Extract<ProjectToHostMessage, { type: "openImportableDeclaration" }>,
): vscode.Range | undefined {
    const tree = json.parseTree(document.getText());
    if (tree === undefined) return undefined;
    const section = SECTION_BY_KIND[message.kind];
    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (sectionNode?.type !== "array") return undefined;

    const candidates = (sectionNode.children ?? []).filter((node) =>
        importableEntryMatchesIdentity(section, node, message.identity)
    );
    if (candidates.length === 0) return undefined;

    const hint = validProjectTextSpan(message.declarationSpan, document.getText().length)
        ? message.declarationSpan
        : undefined;
    const entry = hint === undefined
        ? candidates[0]
        : candidates.find((node) => node.offset === hint.start && node.offset + node.length === hint.end)
            ?? candidates.reduce((nearest, node) =>
                Math.abs(node.offset - hint.start) < Math.abs(nearest.offset - hint.start) ? node : nearest
            );

    const fieldPath = Array.isArray(message.fieldPath)
        ? message.fieldPath.filter((part): part is string => typeof part === "string")
        : [];
    let target = entry;
    for (let depth = 1; depth <= fieldPath.length; depth++) {
        const field = json.findNodeAtLocation(entry, fieldPath.slice(0, depth));
        if (field === undefined) break;
        target = field;
    }

    return new vscode.Range(
        document.positionAt(target.offset),
        document.positionAt(target.offset + target.length),
    );
}

function validProjectTextSpan(
    span: ProjectTextSpan | undefined,
    textLength: number,
): span is ProjectTextSpan {
    return span !== undefined
        && Number.isInteger(span.start)
        && Number.isInteger(span.end)
        && span.start >= 0
        && span.end >= span.start
        && span.end <= textLength;
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
