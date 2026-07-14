import * as path from "node:path";
import * as vscode from "vscode";
import type { ProjectFs } from "htsw-editor-common/project";
import { nodeProjectFs } from "./nodeProjectFs";

type PendingFile = {
    path: string;
    text: string;
};

export function projectFsWithOpenDocuments(): ProjectFs {
    return {
        ...nodeProjectFs,
        readFile(filePath) {
            const open = openTextDocumentForPath(filePath);
            return open ? open.getText() : nodeProjectFs.readFile(filePath);
        },
    };
}

export async function runProjectMutation<T>(run: (fs: ProjectFs) => T): Promise<T> {
    const mutation = new ProjectMutation();
    const result = run(mutation.fs);
    await mutation.apply();
    return result;
}

export function planProjectMutation<T>(run: (fs: ProjectFs) => T): T {
    return run(new ProjectMutation().fs);
}

class ProjectMutation {
    private readonly base = projectFsWithOpenDocuments();
    private readonly writes = new Map<string, PendingFile>();
    private readonly deletions = new Map<string, string>();
    private readonly directories = new Map<string, string>();

    readonly fs: ProjectFs = {
        ...this.base,
        exists: (filePath) => this.exists(filePath),
        readFile: (filePath) => this.readFile(filePath),
        writeFile: (filePath, text) => this.writeFile(filePath, text),
        ensureDir: (dirPath) => this.ensureDir(dirPath),
        deleteFile: (filePath) => this.deleteFile(filePath),
    };

    private exists(filePath: string): boolean {
        const key = pathKey(filePath);
        if (this.deletions.has(key)) return false;
        return this.writes.has(key) || this.directories.has(key) || this.base.exists(filePath);
    }

    private readFile(filePath: string): string {
        const key = pathKey(filePath);
        if (this.deletions.has(key)) {
            throw vscode.FileSystemError.FileNotFound(vscode.Uri.file(filePath));
        }
        return this.writes.get(key)?.text ?? this.base.readFile(filePath);
    }

    private writeFile(filePath: string, text: string): void {
        const key = pathKey(filePath);
        this.deletions.delete(key);
        this.writes.set(key, { path: filePath, text });
    }

    private ensureDir(dirPath: string): void {
        this.directories.set(pathKey(dirPath), dirPath);
    }

    private deleteFile(filePath: string): void {
        const key = pathKey(filePath);
        if (!this.exists(filePath)) {
            throw vscode.FileSystemError.FileNotFound(vscode.Uri.file(filePath));
        }

        const pending = this.writes.get(key);
        this.writes.delete(key);
        if (pending && !this.base.exists(filePath)) return;
        this.deletions.set(key, filePath);
    }

    async apply(): Promise<void> {
        const createdDirectories = await this.createDirectories();
        try {
            if (this.writes.size === 0 && this.deletions.size === 0) return;

            const edit = new vscode.WorkspaceEdit();
            const documentsToSave: vscode.TextDocument[] = [];

            for (const pending of this.writes.values()) {
                const uri = vscode.Uri.file(pending.path);
                if (this.base.exists(pending.path)) {
                    const document = await vscode.workspace.openTextDocument(uri);
                    edit.replace(
                        uri,
                        new vscode.Range(
                            document.positionAt(0),
                            document.positionAt(document.getText().length),
                        ),
                        pending.text,
                    );
                    documentsToSave.push(document);
                } else {
                    edit.createFile(uri, { contents: Buffer.from(pending.text, "utf8") });
                }
            }

            for (const filePath of this.deletions.values()) {
                edit.deleteFile(vscode.Uri.file(filePath), { ignoreIfNotExists: true });
            }

            if (!await vscode.workspace.applyEdit(edit)) {
                throw new Error("VS Code could not apply the project changes.");
            }
            for (const document of documentsToSave) {
                if (!await document.save()) {
                    throw new Error(`VS Code could not save ${vscode.workspace.asRelativePath(document.uri, false)}.`);
                }
            }
        } catch (err) {
            await removeEmptyDirectories(createdDirectories);
            throw err;
        }
    }

    private async createDirectories(): Promise<string[]> {
        const missing = new Map<string, string>();
        for (const requested of this.directories.values()) {
            let current = requested;
            while (!this.base.exists(current)) {
                missing.set(pathKey(current), current);
                const parent = path.dirname(current);
                if (parent === current) break;
                current = parent;
            }
        }

        const candidates = [...missing.values()].sort((left, right) => left.length - right.length);
        const created: string[] = [];
        try {
            for (const dirPath of candidates) {
                if (this.base.exists(dirPath)) continue;
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
                created.push(dirPath);
            }
            return created;
        } catch (err) {
            await removeEmptyDirectories(created);
            throw err;
        }
    }
}

async function removeEmptyDirectories(directories: readonly string[]): Promise<void> {
    const deepestFirst = [...directories].sort((left, right) => right.length - left.length);
    for (const dirPath of deepestFirst) {
        const uri = vscode.Uri.file(dirPath);
        try {
            if ((await vscode.workspace.fs.readDirectory(uri)).length === 0) {
                await vscode.workspace.fs.delete(uri);
            }
        } catch {
            // Preserve the original failure; cleanup is best-effort.
        }
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
