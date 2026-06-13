import * as path from "node:path";
import * as vscode from "vscode";
import {
    applyEdits,
    findNodeAtLocation,
    getNodePath,
    modify,
    Node as JsonNode,
    parse,
    parseTree,
} from "jsonc-parser";

const IMPORTABLE_SECTIONS = new Set([
    "functions",
    "events",
    "regions",
    "items",
    "menus",
    "npcs",
]);
const FILE_REFERENCE_KEYS = new Set([
    "include",
    "actions",
    "nbt",
    "onEnterActions",
    "onExitActions",
    "leftClickActions",
    "rightClickActions",
    "helmet",
    "chestplate",
    "leggings",
    "boots",
    "hand",
]);

interface Move {
    oldPath: string;
    newPath: string;
    directory: boolean;
}

interface Reference {
    nodePath: (string | number)[];
    targetPath: string;
}

export function registerProjectFileHelpers(): vscode.Disposable[] {
    return [
        vscode.workspace.onWillRenameFiles((event) => {
            event.waitUntil(buildRenameEdit(event.files));
        }),
        vscode.workspace.onWillDeleteFiles((event) => {
            event.waitUntil(buildDeleteEdit(event.files));
        }),
        vscode.commands.registerCommand(
            "htsw.project.createIncludedImportJson",
            (uri?: vscode.Uri) => createIncludedImportJson(uri),
        ),
    ];
}

async function buildRenameEdit(
    files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
): Promise<vscode.WorkspaceEdit> {
    const moves = await Promise.all(files
        .filter((file) => file.oldUri.scheme === "file" && file.newUri.scheme === "file")
        .map(async (file): Promise<Move> => ({
            oldPath: file.oldUri.fsPath,
            newPath: file.newUri.fsPath,
            directory: await isDirectory(file.oldUri),
        })));

    return editImportJsonFiles((manifestPath, source) => {
        const movedManifestPath = movePath(manifestPath, moves) ?? manifestPath;
        if (movedManifestPath !== manifestPath && !isProjectFileReference(movedManifestPath)) {
            return source;
        }

        const movedTarget = (targetPath: string) => movePath(targetPath, moves) ?? targetPath;
        const removals = collectReferences(source, manifestPath)
            .filter((reference) => !isProjectFileReference(movedTarget(reference.targetPath)))
            .map((reference) => removalPath(reference.nodePath))
            .filter((nodePath): nodePath is (string | number)[] => nodePath !== undefined);
        const rewritten = rewriteReferences(source, manifestPath, movedManifestPath, movedTarget);
        return applyRemovals(rewritten, removals);
    });
}

async function buildDeleteEdit(files: readonly vscode.Uri[]): Promise<vscode.WorkspaceEdit> {
    const deleted = await Promise.all(files
        .filter((uri) => uri.scheme === "file")
        .map(async (uri) => ({
            filePath: uri.fsPath,
            directory: await isDirectory(uri),
        })));

    return editImportJsonFiles((manifestPath, source) => {
        if (deleted.some((entry) => pathMatches(manifestPath, entry.filePath, entry.directory))) {
            return source;
        }

        const removals = collectReferences(source, manifestPath)
            .filter((reference) =>
                deleted.some((entry) =>
                    pathMatches(reference.targetPath, entry.filePath, entry.directory)
                )
            )
            .map((reference) => removalPath(reference.nodePath))
            .filter((nodePath): nodePath is (string | number)[] => nodePath !== undefined);

        return applyRemovals(source, removals);
    });
}

async function editImportJsonFiles(
    transform: (manifestPath: string, source: string) => string,
): Promise<vscode.WorkspaceEdit> {
    const edit = new vscode.WorkspaceEdit();
    const manifests = await vscode.workspace.findFiles(
        "**/{import.json,*.import.json}",
        "**/{node_modules,.git}/**",
    );

    for (const uri of manifests) {
        const document = await vscode.workspace.openTextDocument(uri);
        const source = document.getText();
        const next = transform(uri.fsPath, source);
        if (next === source) continue;

        edit.replace(
            uri,
            new vscode.Range(document.positionAt(0), document.positionAt(source.length)),
            next,
        );
    }

    return edit;
}

function rewriteReferences(
    source: string,
    oldManifestPath: string,
    newManifestPath: string,
    targetPath: (targetPath: string) => string,
): string {
    let next = source;
    const references = collectReferences(source, oldManifestPath);

    for (const reference of references) {
        const movedTarget = targetPath(reference.targetPath);
        if (!isProjectFileReference(movedTarget)) continue;
        const newReference = relativePath(path.dirname(newManifestPath), movedTarget);
        const oldReference = relativePath(path.dirname(oldManifestPath), reference.targetPath);
        if (newReference === oldReference) continue;

        next = applyEdits(next, modify(next, reference.nodePath, newReference, {
            formattingOptions: { insertSpaces: true, tabSize: 4 },
        }));
    }

    return next;
}

function collectReferences(source: string, manifestPath: string): Reference[] {
    const root = parseTree(source);
    if (!root) return [];

    const references: Reference[] = [];
    visitStrings(root, (node) => {
        const nodePath = getNodePath(node);
        const key = nodePath[nodePath.length - 1];
        const parentKey = nodePath[nodePath.length - 2];
        const referenceKey = typeof key === "number" ? parentKey : key;
        if (
            typeof node.value !== "string" ||
            typeof referenceKey !== "string" ||
            !FILE_REFERENCE_KEYS.has(referenceKey) ||
            !isProjectFileReference(node.value)
        ) return;

        references.push({
            nodePath,
            targetPath: path.resolve(path.dirname(manifestPath), node.value),
        });
    });
    return references;
}

function visitStrings(node: JsonNode, visitor: (node: JsonNode) => void) {
    if (node.type === "string") visitor(node);
    node.children?.forEach((child) => visitStrings(child, visitor));
}

function isProjectFileReference(value: string): boolean {
    const lower = value.toLowerCase();
    return lower.endsWith(".htsl") ||
        lower.endsWith(".snbt") ||
        lower.endsWith("import.json");
}

function removalPath(nodePath: (string | number)[]): (string | number)[] | undefined {
    if (nodePath[0] === "include" && typeof nodePath[1] === "number") {
        return nodePath.slice(0, 2);
    }

    if (
        typeof nodePath[0] === "string" &&
        IMPORTABLE_SECTIONS.has(nodePath[0]) &&
        typeof nodePath[1] === "number"
    ) {
        return nodePath.slice(0, 2);
    }

    return undefined;
}

function applyRemovals(source: string, removals: (string | number)[][]): string {
    const unique = new Map(removals.map((nodePath) => [JSON.stringify(nodePath), nodePath]));
    const ordered = [...unique.values()].sort((left, right) => {
        if (left[0] !== right[0]) return String(left[0]).localeCompare(String(right[0]));
        return Number(right[1]) - Number(left[1]);
    });

    let next = source;
    for (const nodePath of ordered) {
        const root = parseTree(next);
        if (!root || !findNodeAtLocation(root, nodePath)) continue;
        next = applyEdits(next, modify(next, nodePath, undefined, {
            formattingOptions: { insertSpaces: true, tabSize: 4 },
        }));
    }
    return next;
}

function movePath(filePath: string, moves: readonly Move[]): string | undefined {
    for (const move of moves) {
        if (!pathMatches(filePath, move.oldPath, move.directory)) continue;
        return move.directory
            ? path.join(move.newPath, path.relative(move.oldPath, filePath))
            : move.newPath;
    }
    return undefined;
}

function pathMatches(filePath: string, targetPath: string, directory: boolean): boolean {
    const relative = path.relative(targetPath, filePath);
    return relative === "" ||
        (directory && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function relativePath(fromDirectory: string, targetPath: string): string {
    return path.relative(fromDirectory, targetPath).replace(/\\/g, "/");
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
    try {
        return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
    } catch {
        return false;
    }
}

async function createIncludedImportJson(uri?: vscode.Uri) {
    const baseUri = await selectedDirectory(uri);
    if (!baseUri) {
        void vscode.window.showWarningMessage("Open a folder before creating an included import.json.");
        return;
    }

    const folderName = await vscode.window.showInputBox({
        title: "Create Included import.json",
        prompt: "Subproject folder path",
        placeHolder: "combat/arenas",
        validateInput: (value) => validateFolderName(baseUri.fsPath, value),
    });
    if (!folderName) return;

    const manifestUri = vscode.Uri.file(path.join(baseUri.fsPath, folderName, "import.json"));
    const parentManifest = isImportJsonUri(uri)
        ? uri
        : await findNearestManifest(baseUri.fsPath);
    if (!parentManifest) {
        void vscode.window.showWarningMessage("No parent import.json was found.");
        return;
    }

    if (await fileExists(manifestUri)) {
        void vscode.window.showWarningMessage(`${folderName}/import.json already exists.`);
        return;
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(manifestUri.fsPath)));
    await vscode.workspace.fs.writeFile(manifestUri, Buffer.from("{}\n"));
    await addInclude(parentManifest, manifestUri.fsPath);
    await vscode.window.showTextDocument(manifestUri);
}

async function selectedDirectory(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
    const selected = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!selected || selected.scheme !== "file") return undefined;
    return await isDirectory(selected) ? selected : vscode.Uri.file(path.dirname(selected.fsPath));
}

function validateFolderName(basePath: string, value: string): string | undefined {
    if (!value.trim()) return "Enter a folder path.";
    const target = path.resolve(basePath, value);
    if (!pathMatches(target, basePath, true) || target === path.resolve(basePath)) {
        return "Choose a new folder inside the selected folder.";
    }
    return undefined;
}

async function findNearestManifest(startDirectory: string): Promise<vscode.Uri | undefined> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(startDirectory));
    const stopAt = workspaceFolder?.uri.fsPath;
    let directory = startDirectory;

    while (true) {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(directory));
        const manifestName = entries
            .filter(([name, type]) =>
                type === vscode.FileType.File && isImportJsonName(name)
            )
            .map(([name]) => name)
            .sort((left, right) =>
                Number(right === "import.json") - Number(left === "import.json") ||
                left.localeCompare(right)
            )[0];
        if (manifestName) {
            return vscode.Uri.file(path.join(directory, manifestName));
        }

        const parent = path.dirname(directory);
        if (parent === directory || directory === stopAt) return undefined;
        directory = parent;
    }
}

function isImportJsonUri(uri?: vscode.Uri): uri is vscode.Uri {
    return uri?.scheme === "file" && isImportJsonName(path.basename(uri.fsPath));
}

function isImportJsonName(name: string): boolean {
    const lower = name.toLowerCase();
    return lower === "import.json" || lower.endsWith(".import.json");
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function addInclude(parentManifest: vscode.Uri, includedManifestPath: string) {
    const document = await vscode.workspace.openTextDocument(parentManifest);
    const source = document.getText();
    const value = parse(source) as { include?: unknown };
    const includePath = relativePath(path.dirname(parentManifest.fsPath), includedManifestPath);
    const nodePath = Array.isArray(value?.include)
        ? ["include", value.include.length]
        : ["include"];
    const next = applyEdits(source, modify(source, nodePath, Array.isArray(value?.include) ? includePath : [includePath], {
        formattingOptions: { insertSpaces: true, tabSize: 4 },
    }));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
        parentManifest,
        new vscode.Range(document.positionAt(0), document.positionAt(source.length)),
        next,
    );
    await vscode.workspace.applyEdit(edit);
    await document.save();
}
