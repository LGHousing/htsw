import * as path from "node:path";
import * as vscode from "vscode";
import type { GitDecoration, ProjectImportJsonNode } from "./protocol";

type GitChange = { uri: vscode.Uri; status: number };
type GitRepository = {
    state: {
        workingTreeChanges: GitChange[];
        untrackedChanges?: GitChange[];
        indexChanges: GitChange[];
        mergeChanges: GitChange[];
        onDidChange: vscode.Event<void>;
    };
};
type GitApi = {
    repositories: GitRepository[];
    onDidOpenRepository: vscode.Event<GitRepository>;
    onDidCloseRepository: vscode.Event<GitRepository>;
};

type GitExtension = {
    getAPI(version: 1): GitApi;
};

const STATUS: Record<number, GitDecoration> = {
    0: { badge: "M", color: "modified" },
    1: { badge: "A", color: "added" },
    2: { badge: "D", color: "deleted" },
    3: { badge: "R", color: "renamed" },
    4: { badge: "A", color: "added" },
    5: { badge: "M", color: "modified" },
    6: { badge: "D", color: "deleted" },
    7: { badge: "U", color: "untracked" },
    9: { badge: "A", color: "added" },
    10: { badge: "R", color: "renamed" },
    11: { badge: "M", color: "modified" },
    12: { badge: "!", color: "conflicting" },
    13: { badge: "!", color: "conflicting" },
    14: { badge: "!", color: "conflicting" },
    15: { badge: "!", color: "conflicting" },
    16: { badge: "!", color: "conflicting" },
    17: { badge: "!", color: "conflicting" },
    18: { badge: "!", color: "conflicting" },
};

const STRENGTH: Record<GitDecoration["color"], number> = {
    conflicting: 6,
    deleted: 5,
    modified: 4,
    renamed: 3,
    added: 2,
    untracked: 1,
};

async function gitApi(): Promise<GitApi | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) return undefined;
    try {
        const exports = extension.isActive ? extension.exports : await extension.activate();
        return exports.getAPI(1);
    } catch {
        return undefined;
    }
}

function pathKey(fsPath: string): string {
    const normalized = path.normalize(fsPath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export async function addGitDecorations(roots: ProjectImportJsonNode[]): Promise<void> {
    const decorations = new Map<string, GitDecoration>();
    const api = await gitApi();
    for (const repository of api?.repositories ?? []) {
        const changes = [
            ...repository.state.indexChanges,
            ...repository.state.workingTreeChanges,
            ...(repository.state.untrackedChanges ?? []),
            ...repository.state.mergeChanges,
        ];
        for (const change of changes) {
            const decoration = STATUS[change.status];
            const key = pathKey(change.uri.fsPath);
            const current = decorations.get(key);
            if (decoration && (!current || STRENGTH[decoration.color] > STRENGTH[current.color])) {
                decorations.set(key, decoration);
            }
        }
    }
    const strongest = (paths: string[]): GitDecoration | undefined => {
        let result: GitDecoration | undefined;
        for (const fsPath of paths) {
            const decoration = decorations.get(pathKey(fsPath));
            if (decoration && (!result || STRENGTH[decoration.color] > STRENGTH[result.color])) {
                result = decoration;
            }
        }
        return result;
    };
    const decorateFiles = (node: ProjectImportJsonNode): void => {
        const nodeKey = pathKey(node.fsPath);
        node.git = decorations.get(pathKey(node.fsPath));
        for (const entry of node.importables) {
            const sourcePaths = (entry.subEntries ?? []).map((sub) => sub.fsPath);
            if (entry.sourcePath && pathKey(entry.sourcePath) !== nodeKey) sourcePaths.push(entry.sourcePath);
            entry.git = strongest(sourcePaths);
            for (const sub of entry.subEntries ?? []) {
                sub.git = decorations.get(pathKey(sub.fsPath));
            }
        }
        for (const file of node.rawHtslFiles ?? []) {
            file.git = decorations.get(pathKey(file.fsPath));
        }
        node.children.forEach(decorateFiles);
    };
    roots.forEach(decorateFiles);

    const homes = new Map<string, ProjectImportJsonNode>();
    const collectHomes = (node: ProjectImportJsonNode): void => {
        if (!node.reference) homes.set(pathKey(node.fsPath), node);
        node.children.forEach(collectHomes);
    };
    roots.forEach(collectHomes);

    // Like error/warning badges, reference nodes mirror their home and don't
    // feed ancestor rollups; mirroring runs after every home's rollup is
    // final, since a reference can precede its home in traversal order.
    const applyRollups = (node: ProjectImportJsonNode): boolean => {
        if (node.reference) return false;
        const localFileDecorated = node.importables.some((entry) =>
            entry.git !== undefined || (entry.subEntries ?? []).some((sub) => sub.git !== undefined)
        ) || (node.rawHtslFiles ?? []).some((file) => file.git !== undefined);
        const childFlags = node.children.map(applyRollups);
        const subtreeDecorated = localFileDecorated || childFlags.some(Boolean);
        node.gitRollup = (node.git === undefined && subtreeDecorated) || undefined;
        return node.git !== undefined || subtreeDecorated;
    };
    roots.forEach(applyRollups);
    const mirrorReferences = (node: ProjectImportJsonNode): void => {
        if (node.reference) {
            const home = homes.get(pathKey(node.fsPath));
            node.git = home?.git;
            node.gitRollup = home?.gitRollup;
        }
        node.children.forEach(mirrorReferences);
    };
    roots.forEach(mirrorReferences);
}

export async function onDidChangeGitStatus(listener: () => void): Promise<vscode.Disposable> {
    const api = await gitApi();
    if (!api) return new vscode.Disposable(() => undefined);
    const repositorySubs = new Map<GitRepository, vscode.Disposable>();
    const watch = (repository: GitRepository): void => {
        repositorySubs.set(repository, repository.state.onDidChange(listener));
    };
    api.repositories.forEach(watch);
    const openSub = api.onDidOpenRepository((repository) => {
        watch(repository);
        listener();
    });
    const closeSub = api.onDidCloseRepository((repository) => {
        repositorySubs.get(repository)?.dispose();
        repositorySubs.delete(repository);
        listener();
    });
    return new vscode.Disposable(() => {
        openSub.dispose();
        closeSub.dispose();
        repositorySubs.forEach((sub) => sub.dispose());
    });
}
