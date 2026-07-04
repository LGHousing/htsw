import * as path from "node:path";
import * as vscode from "vscode";

export function isPathInExcludedDiagnosticFolder(fsPath: string): boolean {
    const uri = vscode.Uri.file(fsPath);
    return getContainingWorkspaceFolders(uri).some((workspaceFolder) => {
        const relativePath = normalizePath(
            path.relative(workspaceFolder.uri.fsPath, fsPath)
        );
        if (!relativePath || relativePath.startsWith("../")) return false;

        return getExcludedFolders(workspaceFolder.uri).some(
            (folder) => relativePath === folder || relativePath.startsWith(`${folder}/`)
        );
    });
}

function getExcludedFolders(uri: vscode.Uri): string[] {
    return vscode.workspace
        .getConfiguration("htsw", uri)
        .get<string[]>("diagnostics.excludeFolders", [])
        .map((folder) => normalizePath(folder).replace(/^\/+|\/+$/g, ""))
        .filter(Boolean);
}

function getContainingWorkspaceFolders(uri: vscode.Uri): vscode.WorkspaceFolder[] {
    return (vscode.workspace.workspaceFolders ?? [])
        .filter((workspaceFolder) => {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
            return relativePath === "" || !relativePath.startsWith("..");
        })
        .sort((left, right) => right.uri.fsPath.length - left.uri.fsPath.length);
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").toLowerCase();
}
