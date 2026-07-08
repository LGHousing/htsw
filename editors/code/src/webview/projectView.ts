import * as path from "node:path";
import * as vscode from "vscode";
import * as json from "jsonc-parser";
import * as htsw from "htsw";
import {
    createIncludedFolderInTree,
    createIncludedImportJsonFiles,
    collectFileRefs,
    htslTargetForCommandExport,
    htslTargetForEventExport,
    htslTargetForFunctionExport,
    moveImportableEntry,
    normalizeRelativeProjectPath,
    planDeleteImportableEntry,
    readEntryValue,
    removeIncludeFromImportJson,
    removeImportableEntryForDelete,
    renameImportableEntry,
    resolveImportableFile,
    updateImportableField,
    upsertImportableEntry,
    type ProjectFs,
    type RefSlot,
    type Section,
} from "htsw-editor-common/project";
import { itemFieldsFromTag } from "htsw-editor-common/item/buildItemNbt";
import { nodeProjectFs } from "../nodeProjectFs";
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
        case "createIncludedImportJson":
            await createIncludedImportJson(webview, message.parentImportJsonPath, message.folderPath);
            return;
        case "addImportable":
            await addImportable(webview, message.importJsonPath, message.kind, message.identity);
            return;
        case "moveImportable":
            await moveImportable(webview, message.importJsonPath, message.kind, message.identity);
            return;
        case "editImportableMetadata":
            await editImportableMetadata(webview, message);
            return;
        case "openItemInEditor":
            await openItemInEditor(webview, message.snbtPath);
            return;
    }
}

async function editImportableMetadata(
    webview: vscode.Webview,
    message: Extract<ProjectToHostMessage, { type: "editImportableMetadata" }>,
): Promise<void> {
    try {
        const section = SECTION_BY_KIND[message.kind];
        const entryJsonPath = await treeRootForImportJson(message.importJsonPath);
        const fs = projectFsWithOpenDocuments();
        const declaringJsonPath = resolveImportableFile(fs, entryJsonPath, section, message.identity);
        const entry = readEntryValue(fs, declaringJsonPath, section, message.identity);
        if (entry === null) throw new Error(`Couldn't find ${message.kind} "${message.identity}".`);

        const edit = await promptMetadataEdit(message.kind, message.key, entry);
        if (edit === null) return;

        await withDocAwareWrites((fs) => {
            const ok = updateImportableField(
                fs,
                entryJsonPath,
                section,
                message.identity,
                edit.field,
                edit.value,
            );
            if (!ok) throw new Error(`Couldn't update ${message.kind} "${message.identity}".`);
        });

        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Updated ${message.kind} "${message.identity}".`,
        } satisfies ProjectFromHostMessage);
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not update metadata: ${error}`);
    }
}

type MetadataEdit = {
    field: string | string[];
    value: unknown;
};

async function promptMetadataEdit(
    kind: ProjectImportableSummary["type"],
    key: string,
    entry: Record<string, unknown>,
): Promise<MetadataEdit | null> {
    if (kind === "function") return promptFunctionMetadataEdit(key, entry);
    if (kind === "command") return promptCommandMetadataEdit(key, entry);
    if (kind === "menu" && key === "size") {
        const value = await numberInput("Menu size", entry.size, 1, 54, "Blank uses the default.");
        return value === false ? null : { field: "size", value: value ?? undefined };
    }
    if (kind === "npc" && key === "leftClickRedirect") {
        const value = await booleanPick("Redirect left click", entry.leftClickRedirect);
        return value === undefined ? null : { field: "leftClickRedirect", value: value ?? undefined };
    }
    throw new Error("This metadata field is read-only in the VS Code sidebar.");
}

async function promptFunctionMetadataEdit(
    key: string,
    entry: Record<string, unknown>,
): Promise<MetadataEdit | null> {
    const icon = objectValue(entry.icon);
    if (key === "repeatTicks") {
        const value = await numberInput("Repeat ticks", entry.repeatTicks, 4, 18000, "Blank disables repeating.");
        return value === false ? null : { field: "repeatTicks", value: value ?? undefined };
    }
    if (key === "icon") {
        const value = await textInput("Function icon item", stringValue(icon?.item), "minecraft:clock", "Blank uses the default icon.");
        if (value === undefined) return null;
        return value.trim() === ""
            ? { field: "icon", value: undefined }
            : { field: ["icon", "item"], value: value.trim() };
    }
    if (key === "iconCount") {
        const value = await numberInput("Function icon count", icon?.count, 1, 64, "Blank uses 1.");
        return value === false ? null : { field: ["icon", "count"], value: value ?? undefined };
    }
    throw new Error("Unknown function metadata field.");
}

async function promptCommandMetadataEdit(
    key: string,
    entry: Record<string, unknown>,
): Promise<MetadataEdit | null> {
    if (key === "mode") {
        const pick = await vscode.window.showQuickPick(["Self", "Targeted"] as const, {
            placeHolder: "Command mode",
        });
        return pick === undefined ? null : { field: "mode", value: pick === "Self" ? undefined : pick };
    }
    if (key === "requiredPriority") {
        const value = await numberInput("Required priority", entry.requiredPriority, 0, 20, "Blank uses 0.");
        return value === false ? null : { field: "requiredPriority", value: value ?? undefined };
    }
    if (key === "listed") {
        const value = await booleanPick("Listed", entry.listed);
        return value === undefined ? null : { field: "listed", value: value ?? undefined };
    }
    throw new Error("Unknown command metadata field.");
}

async function textInput(
    prompt: string,
    value: string,
    placeHolder: string,
    description: string,
): Promise<string | undefined> {
    return vscode.window.showInputBox({
        prompt: `${prompt}. ${description}`,
        value,
        placeHolder,
        valueSelection: [0, value.length],
    });
}

async function numberInput(
    prompt: string,
    current: unknown,
    min: number,
    max: number,
    description: string,
): Promise<number | null | false> {
    const value = typeof current === "number" ? String(current) : "";
    const input = await vscode.window.showInputBox({
        prompt: `${prompt}. ${description}`,
        value,
        valueSelection: [0, value.length],
        validateInput: (raw) => {
            const trimmed = raw.trim();
            if (trimmed === "") return undefined;
            const parsed = Number(trimmed);
            if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
                return `Enter a whole number from ${min} to ${max}.`;
            }
            return undefined;
        },
    });
    if (input === undefined) return false;
    const trimmed = input.trim();
    return trimmed === "" ? null : Number(trimmed);
}

async function booleanPick(prompt: string, current: unknown): Promise<boolean | null | undefined> {
    const pick = await vscode.window.showQuickPick([
        { label: "Default", value: null },
        { label: "True", value: true },
        { label: "False", value: false },
    ], {
        placeHolder: `${prompt}${typeof current === "boolean" ? `: ${current}` : ": default"}`,
    });
    return pick?.value;
}

function objectValue(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
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

        let destJsonPath: string;
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
            const created = await withDocAwareWrites((fs) =>
                createIncludedFolderInTree(fs, entryJsonPath, folderPath)
            );
            destJsonPath = created.importJsonPath;
        } else {
            destJsonPath = pick.fsPath;
        }

        await moveImportableWithOpenDocs(entryJsonPath, section, identity, destJsonPath);

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

        const renamed = await withDocAwareWrites((fs) =>
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

        const result = await withDocAwareWrites((fs) =>
            removeImportableEntryForDelete(fs, entryJsonPath, section, identity)
        );
        if (!result.ok) throw new Error(result.message);

        if (choice === deleteFilesLabel) {
            for (const filePath of result.ownedFiles) {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { useTrash: true });
            }
        }

        const suffix = choice === deleteFilesLabel && result.ownedFiles.length > 0
            ? ` and ${result.ownedFiles.length} file${result.ownedFiles.length === 1 ? "" : "s"}`
            : "";
        await webview.postMessage({
            type: "projectResult",
            ok: true,
            message: `Deleted ${target}${suffix}.`,
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
            await withDocAwareWrites((fs) => {
                if (!removeIncludeFromImportJson(fs, parentImportJsonPath, importJsonPath)) {
                    throw new Error(
                        `Could not remove include from ${vscode.workspace.asRelativePath(parentImportJsonPath, false)}.`
                    );
                }
            });
        }

        await vscode.workspace.fs.delete(vscode.Uri.file(dir), { recursive: true, useTrash: true });
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
            treeRootOf.set(pathKey(node.fsPath), treeRoot);
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

        let destJsonPath: string;
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
            const anchorRoot = treeRootOf.get(pathKey(items[0].importJsonPath)) ?? roots[0]?.fsPath;
            if (!anchorRoot) throw new Error("No project root to create a folder in.");
            const created = await withDocAwareWrites((fs) =>
                createIncludedFolderInTree(fs, anchorRoot, folderPath)
            );
            destJsonPath = created.importJsonPath;
        } else {
            destJsonPath = pick.fsPath;
        }

        const destKey = pathKey(destJsonPath);
        let moved = 0;
        const failures: string[] = [];
        for (const item of items) {
            try {
                const section = SECTION_BY_KIND[item.kind];
                const entryJsonPath = treeRootOf.get(pathKey(item.importJsonPath))
                    ?? await treeRootForImportJson(item.importJsonPath);
                const current = resolveImportableFile(projectFsWithOpenDocuments(), entryJsonPath, section, item.identity);
                if (pathKey(current) === destKey) continue;
                await moveImportableWithOpenDocs(entryJsonPath, section, item.identity, destJsonPath);
                moved++;
            } catch (err) {
                failures.push(`${item.kind} "${item.identity}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        const rel = vscode.workspace.asRelativePath(destJsonPath, false);
        await webview.postMessage(
            failures.length === 0
                ? { type: "projectResult", ok: true, message: `Moved ${moved} item${moved === 1 ? "" : "s"} to ${rel}.` }
                : { type: "projectResult", ok: false, error: `Moved ${moved} of ${items.length} items to ${rel} (${failures.length} failed: ${failures.join("; ")}).` }
        );
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not move importables: ${error}`);
    }
}

async function deleteImportables(webview: vscode.Webview, items: SelectedImportable[]): Promise<void> {
    try {
        const fs = projectFsWithOpenDocuments();
        const plans: Array<{ item: SelectedImportable; section: Section; entryJsonPath: string }> = [];
        const ownedSet = new Set<string>();
        for (const item of items) {
            const section = SECTION_BY_KIND[item.kind];
            const entryJsonPath = await treeRootForImportJson(item.importJsonPath);
            const plan = planDeleteImportableEntry(fs, entryJsonPath, section, item.identity);
            if (!plan.ok) throw new Error(plan.message);
            for (const filePath of plan.ownedFiles) ownedSet.add(filePath);
            plans.push({ item, section, entryJsonPath });
        }

        const ownedFiles = [...ownedSet];
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

        let removed = 0;
        const failures: string[] = [];
        for (const { item, section, entryJsonPath } of plans) {
            try {
                const result = await withDocAwareWrites((writeFs) =>
                    removeImportableEntryForDelete(writeFs, entryJsonPath, section, item.identity)
                );
                if (!result.ok) {
                    failures.push(`${item.kind} "${item.identity}": ${result.message}`);
                    continue;
                }
                removed++;
            } catch (err) {
                failures.push(`${item.kind} "${item.identity}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        let filesDeleted = 0;
        if (choice === deleteFilesLabel && failures.length === 0) {
            for (const filePath of ownedFiles) {
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { useTrash: true });
                    filesDeleted++;
                } catch {
                    // A file already gone (e.g. removed with a prior entry) is not an error.
                }
            }
        }

        const suffix = filesDeleted > 0 ? ` and ${filesDeleted} file${filesDeleted === 1 ? "" : "s"}` : "";
        await webview.postMessage(
            failures.length === 0
                ? { type: "projectResult", ok: true, message: `Deleted ${removed} importable${removed === 1 ? "" : "s"}${suffix}.` }
                : { type: "projectResult", ok: false, error: `Deleted ${removed} of ${items.length} importables (${failures.length} failed: ${failures.join("; ")}).` }
        );
        await postFreshProjectTree(webview);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "projectResult", ok: false, error } satisfies ProjectFromHostMessage);
        void vscode.window.showWarningMessage(`Could not delete importables: ${error}`);
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
    const sourceKey = pathKey(importJsonPath);
    const roots = await discoverProjectTree();
    let found: string | undefined;
    const visit = (node: ProjectImportJsonNode, treeRoot: string): void => {
        if (found || node.missing || node.cycle || node.reference) return;
        if (pathKey(node.fsPath) === sourceKey) {
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
 * Run a project mutation with doc-aware writes: an open import.json gets a
 * WorkspaceEdit + save instead of a disk write that would clobber unsaved
 * edits. Rethrows whatever `run` throws (before any edits are applied).
 */
async function withDocAwareWrites<T>(run: (fs: ProjectFs) => T): Promise<T> {
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

    const result = run(fs);

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
    return result;
}

/**
 * moveImportableEntry via withDocAwareWrites. Throws on failure. Used by the
 * tree's right-click move and the module-visibility quick fix.
 */
async function moveImportableWithOpenDocs(
    entryJsonPath: string,
    section: Section,
    identity: string,
    destJsonPath: string,
): Promise<void> {
    await withDocAwareWrites((fs) => {
        const result = moveImportableEntry(fs, entryJsonPath, section, identity, destJsonPath);
        if (!result.ok) throw new Error(result.message);
    });
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
    return roots
        .map((uri) => rootNodeFromParse(uri.fsPath))
        .sort((left, right) => left.label.localeCompare(right.label));
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

    const openPath = resolvedImportableSourcePath(imp, declaringPath);
    const own = ownDiagnosticCounts(parse, imp);
    const subEntries = mapSubEntries(imp, declaringPath, parse);
    const metadataEntries = metadataEntriesOf(imp);

    return {
        id: `${declaringPath}|${type}|${identity}`,
        identity,
        label,
        type,
        typeLabel: imp.type,
        openPath,
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
                key: "repeatTicks",
                label: "Repeat",
                value: imp.repeatTicks !== undefined ? `${imp.repeatTicks}t` : "off",
                editable: true,
            },
            {
                key: "icon",
                label: "Icon",
                value: imp.icon !== undefined ? imp.icon.item : "default",
                editable: true,
            },
        ];
        if (imp.icon !== undefined) {
            fields.push({
                key: "iconCount",
                label: "Count",
                value: imp.icon.count !== undefined ? String(imp.icon.count) : "1",
                editable: true,
            });
        }
        return fields;
    }
    if (imp.type === "COMMAND") {
        return [
            { key: "mode", label: "Mode", value: imp.mode ?? "Self", editable: true },
            { key: "requiredPriority", label: "Priority", value: String(imp.requiredPriority ?? 0), editable: true },
            { key: "listed", label: "Listed", value: (imp.listed ?? true) ? "true" : "false", editable: true },
        ];
    }
    if (imp.type === "REGION") {
        if (imp.bounds === undefined) {
            return [{ key: "bounds", label: "Bounds", value: "(not set)" }];
        }
        return [
            { key: "boundsFrom", label: "From", value: formatPos(imp.bounds.from) },
            { key: "boundsTo", label: "To", value: formatPos(imp.bounds.to) },
        ];
    }
    if (imp.type === "MENU") {
        return [{ key: "size", label: "Size", value: imp.size !== undefined ? `${imp.size} lines` : "default", editable: true }];
    }
    if (imp.type === "NPC") {
        return [
            { key: "pos", label: "Pos", value: formatPos(imp.pos) },
            {
                key: "leftClickRedirect",
                label: "Redirect",
                value: imp.leftClickRedirect === undefined ? "default" : imp.leftClickRedirect ? "true" : "false",
                editable: true,
            },
        ];
    }
    if (imp.type === "ITEM") {
        return [{ key: "nbt", label: "NBT", value: "Item data" }];
    }
    return [];
}

function formatPos(pos: { x: number; y: number; z: number }): string {
    return `${pos.x}, ${pos.y}, ${pos.z}`;
}

function resolvedImportableSourcePath(imp: htsw.types.Importable, declaringPath: string): string {
    return htsw.importableSourcePath(imp) ?? declaringPath;
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
    const declaringKey = pathKey(declaringPath);
    // Inline JSON lists resolve to the manifest itself — no sub-row, same
    // as when these rows were read from `...Path: "file.htsl"` refs only.
    const pushActions = (label: string, fsPath: string | undefined): void => {
        if (fsPath === undefined || pathKey(fsPath) === declaringKey) return;
        out.push(subEntryFor(label, fsPath, "actions", parse));
    };

    for (const kind of htsw.IMPORTABLE_CHILD_LIST_NAMES) {
        if (htsw.childListOf(imp, kind) === undefined) continue;
        pushActions(CHILD_LIST_LABELS[kind], htsw.importableChildListPath(imp, kind));
    }

    if (imp.type === "MENU") {
        for (const slot of imp.slots) {
            const tag = `Slot ${slot.slot}`;
            if (slot.nbtPath !== undefined && pathKey(slot.nbtPath) !== declaringKey) {
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
