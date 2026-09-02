import * as path from "node:path";
import * as vscode from "vscode";
import * as htsw from "htsw";
import {
    canonicalSlug,
    relativePath,
    sanitizeRelativeReference,
    snbtTargetForItemExport,
    upsertImportableEntry,
    walkImportJsonTree,
    type ProjectFs,
} from "htsw-editor-common/project";
import { nodeProjectFs } from "../nodeProjectFs";
import { absolutePathKey } from "../pathIdentity";
import { promptCreateImportJson } from "../projectMutation";
import type {
    ImportTarget,
    ItemEditorForm,
    ItemEditorFromHostMessage,
    ItemEditorToHostMessage,
    ProjectFromHostMessage,
} from "./protocol";

type CreatedItem = {
    files: string[];
    importJsonPath: string;
    identity: string;
};

export async function handleItemEditorMessage(
    webview: vscode.Webview,
    message: ItemEditorToHostMessage,
): Promise<void> {
    switch (message.type) {
        case "requestImportTargets":
            await webview.postMessage({
                type: "importTargets",
                targets: await discoverImportTargets(),
            } satisfies ItemEditorFromHostMessage);
            return;
        case "createItemImportJson":
            await createItemImportJson(webview, message.rootImportJsonPath);
            return;
        case "submitItem":
            await submitItem(webview, message.form, message.tag);
            return;
        case "saveItem":
            await saveItem(webview, message.snbtPath, message.tag);
            return;
    }
}

async function createItemImportJson(
    webview: vscode.Webview,
    rootImportJsonPath: string,
): Promise<void> {
    try {
        const createdPath = await promptCreateImportJson(rootImportJsonPath);
        if (createdPath !== undefined) {
            await webview.postMessage({
                type: "importTargets",
                targets: await discoverImportTargets(),
            } satisfies ItemEditorFromHostMessage);
        }
        await webview.postMessage({
            type: "itemImportJsonCreated",
            createdPath,
        } satisfies ItemEditorFromHostMessage);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "itemImportJsonCreated" } satisfies ItemEditorFromHostMessage);
        void vscode.window.showWarningMessage(`Could not create import.json: ${error}`);
    }
}

// Write an edited item back to its own .snbt. `tag` is the merged NBT from the
// editor (unmanaged keys preserved), so this just prints and writes it.
async function saveItem(webview: vscode.Webview, snbtPath: string, tag: unknown): Promise<void> {
    try {
        if (!nodeProjectFs.exists(snbtPath)) {
            throw new Error(`File not found: ${snbtPath}`);
        }
        const snbt = `${htsw.nbt.printSnbt(tag as Parameters<typeof htsw.nbt.printSnbt>[0], {
            pretty: true,
            indent: "    ",
        })}\n`;

        const open = openTextDocumentForPath(snbtPath);
        if (open) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                open.uri,
                new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length)),
                snbt,
            );
            await vscode.workspace.applyEdit(edit);
            await open.save();
        } else {
            nodeProjectFs.writeFile(snbtPath, snbt);
        }

        await webview.postMessage({ type: "saveResult", ok: true, snbtPath } satisfies ItemEditorFromHostMessage);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "saveResult", ok: false, error } satisfies ItemEditorFromHostMessage);
        void vscode.window.showWarningMessage(`Could not save item: ${error}`);
    }
}

async function submitItem(webview: vscode.Webview, form: ItemEditorForm, tag: unknown): Promise<void> {
    try {
        const created = await writeItem(form, tag);
        await webview.postMessage({
            type: "submitResult",
            ok: true,
            files: created.files,
        } satisfies ItemEditorFromHostMessage);
        await webview.postMessage({
            type: "revealProjectImportable",
            importJsonPath: created.importJsonPath,
            kind: "item",
            identity: created.identity,
        } satisfies ProjectFromHostMessage);
        await openGeneratedItem(created.files);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await webview.postMessage({ type: "submitResult", ok: false, error } satisfies ItemEditorFromHostMessage);
        void vscode.window.showWarningMessage(`Could not add item: ${error}`);
    }
}

async function discoverImportTargets(): Promise<ImportTarget[]> {
    const importJsons = await vscode.workspace.findFiles(
        "**/{import.json,*.import.json}",
        "**/{node_modules,.git}/**",
    );
    const included = new Set<string>();
    for (const uri of importJsons) {
        const rootKey = absolutePathKey(uri.fsPath);
        walkImportJsonTree(nodeProjectFs, uri.fsPath, (filePath) => {
            const key = absolutePathKey(filePath);
            if (key !== rootKey) included.add(key);
            return undefined;
        });
    }

    const roots = importJsons.filter((uri) => !included.has(absolutePathKey(uri.fsPath)));
    const entryPoints = roots.length > 0 ? roots : importJsons;
    const found = new Map<string, ImportTarget>();
    for (const uri of entryPoints) {
        walkImportJsonTree(nodeProjectFs, uri.fsPath, (filePath) => {
            const key = absolutePathKey(filePath);
            if (!found.has(key)) {
                found.set(key, {
                    fsPath: filePath,
                    label: vscode.workspace.asRelativePath(filePath, false),
                    rootImportJsonPath: uri.fsPath,
                });
            }
            return undefined;
        });
    }

    return [...found.values()].sort((left, right) => left.label.localeCompare(right.label));
}

async function writeItem(form: ItemEditorForm, tag: unknown): Promise<CreatedItem> {
    const importJsonPath = form.importJsonPath;
    if (!importJsonPath) throw new Error("Choose a target import.json.");
    if (!nodeProjectFs.exists(importJsonPath)) {
        throw new Error(`Target import.json does not exist: ${importJsonPath}`);
    }

    const entryName = form.entryName.trim();
    if (!entryName) throw new Error("Entry name is required.");

    const rootDir = path.dirname(importJsonPath);
    const target = snbtTargetForItemExport(nodeProjectFs, importJsonPath, rootDir, entryName);
    const snbt = `${htsw.nbt.printSnbt(tag as Parameters<typeof htsw.nbt.printSnbt>[0], {
        pretty: true,
        indent: "    ",
    })}\n`;

    nodeProjectFs.ensureDir(path.dirname(target.snbtPath));
    nodeProjectFs.writeFile(target.snbtPath, snbt);

    const entry: Record<string, unknown> = {
        name: entryName,
        nbt: target.snbtReference,
    };
    const actionFiles: string[] = [];
    const importDir = path.dirname(target.importJsonPath);
    const slug = canonicalSlug(entryName);

    if (form.createLeftClickActions) {
        const left = writeActionFile(importDir, slug, "left");
        entry.leftClickActions = left.reference;
        actionFiles.push(left.filePath);
    }

    if (form.createRightClickActions) {
        const right = writeActionFile(importDir, slug, "right");
        entry.rightClickActions = right.reference;
        actionFiles.push(right.filePath);
    }

    await upsertItemEntry(target.importJsonPath, entry);
    return {
        files: [target.snbtPath, ...actionFiles, target.importJsonPath],
        importJsonPath: target.importJsonPath,
        identity: entryName,
    };
}

function writeActionFile(
    importDir: string,
    slug: string,
    kind: "left" | "right",
): { filePath: string; reference: string } {
    const filePath = pickUnusedFile(importDir, `${slug}_${kind}`, ".htsl");
    nodeProjectFs.writeFile(filePath, "\n");
    const reference = sanitizeRelativeReference(relativePath(importDir, filePath));
    if (reference === null) throw new Error(`Could not create a safe ${kind}-click HTSL reference.`);
    return { filePath, reference };
}

function pickUnusedFile(dir: string, baseName: string, extension: string): string {
    const first = path.join(dir, `${baseName}${extension}`);
    if (!nodeProjectFs.exists(first)) return first;

    for (let i = 2; i < 1000; i++) {
        const candidate = path.join(dir, `${baseName}_${i}${extension}`);
        if (!nodeProjectFs.exists(candidate)) return candidate;
    }

    throw new Error(`Could not find an unused filename for ${baseName}${extension}.`);
}

async function upsertItemEntry(importJsonPath: string, entry: Record<string, unknown>): Promise<void> {
    const replacements = new Map<string, string>();
    const fs: ProjectFs = {
        ...nodeProjectFs,
        readFile(filePath) {
            const open = openTextDocumentForPath(filePath);
            if (open) return open.getText();
            return nodeProjectFs.readFile(filePath);
        },
        writeFile(filePath, text) {
            const open = openTextDocumentForPath(filePath);
            if (open) {
                replacements.set(absolutePathKey(filePath), text);
                return;
            }
            nodeProjectFs.writeFile(filePath, text);
        },
    };

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(importJsonPath));
    upsertImportableEntry(fs, importJsonPath, "items", entry);

    const replacement = replacements.get(absolutePathKey(importJsonPath));
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

function openTextDocumentForPath(filePath: string): vscode.TextDocument | undefined {
    const key = absolutePathKey(filePath);
    return vscode.workspace.textDocuments.find(
        (document) => document.uri.scheme === "file" && absolutePathKey(document.uri.fsPath) === key,
    );
}

async function openGeneratedItem(files: string[]): Promise<void> {
    const first = files[0];
    if (first) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(first));
        await vscode.window.showTextDocument(doc, { preview: false });
    }
}
