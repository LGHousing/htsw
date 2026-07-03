import * as vscode from "vscode";
import * as htsw from "htsw";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The one full-project parse both consumers share: diagnostics validate
 * .htsl files in root scope, and the Importables tree renders the parse's
 * fileTree. A full parse is ~hundreds of ms for a big project, so results
 * are cached per root manifest and invalidated by a workspace generation
 * that the diagnostics adapter bumps on any watched file event.
 *
 * The cache reads open editor buffers (not just disk), but a buffer edit
 * alone doesn't bump the generation — unsaved changes to OTHER files show
 * up on save. The file being actively validated gets a fresh parse via
 * the diagnostics adapter's dirty-document path instead.
 */

export type ContextParse = {
    result: htsw.ImportablesParseResult;
    sourceMap: htsw.SourceMap;
};

export function normalizedPathKey(filePath: string): string {
    return path.resolve(filePath).split("\\").join("/").toLowerCase();
}

class OpenDocsFileLoader implements htsw.FileLoader {
    fileExists(filePath: string): boolean {
        return this.openDocumentForPath(filePath) !== undefined || fs.existsSync(filePath);
    }

    readFile(filePath: string): string {
        const open = this.openDocumentForPath(filePath);
        return open ? open.getText() : fs.readFileSync(filePath, "utf8");
    }

    getParentPath(base: string): string {
        return path.dirname(base);
    }

    resolvePath(base: string, other: string): string {
        return path.resolve(base, other);
    }

    private openDocumentForPath(filePath: string): vscode.TextDocument | undefined {
        const key = normalizedPathKey(filePath);
        return vscode.workspace.textDocuments.find(
            (document) =>
                document.uri.scheme === "file" &&
                normalizedPathKey(document.uri.fsPath) === key,
        );
    }
}

let generation = 0;
const cache = new Map<string, ContextParse & { generation: number }>();

export function workspaceGeneration(): number {
    return generation;
}

export function bumpWorkspaceGeneration(): void {
    generation++;
}

export function getCachedRootParse(rootPath: string): ContextParse {
    const key = normalizedPathKey(rootPath);
    const cached = cache.get(key);
    if (cached && cached.generation === generation) return cached;
    const sourceMap = new htsw.SourceMap(new OpenDocsFileLoader());
    const parsed: ContextParse = {
        result: htsw.parseImportablesResult(sourceMap, rootPath),
        sourceMap,
    };
    cache.set(key, { ...parsed, generation });
    return parsed;
}
