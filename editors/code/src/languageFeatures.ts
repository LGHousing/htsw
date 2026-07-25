import * as vscode from "vscode";
import * as htsw from "htsw";
import * as common from "htsw-editor-common";
import { walkImportJsonTree } from "htsw-editor-common/project";
import * as fs from "node:fs";
import * as path from "node:path";
import { nodeProjectFs } from "./nodeProjectFs";
import {
    type ContextParse,
    bumpWorkspaceGeneration,
    getCachedRootParse,
    workspaceGeneration,
} from "./rootParse";
import { absolutePathKey } from "./pathIdentity";
import { computeBestLayout } from "./loreLineLayout";
import {
    formatSnbtText,
    findEnclosingJsonString,
    decodeJsonStringContent,
    encodeJsonString,
} from "./snbtFormat";
import { isPathInExcludedDiagnosticFolder } from "./diagnosticExclusions";

export { CompletionAdapter, ImportJsonCompletionAdapter, SnbtCompletionAdapter } from "./completions";

class StringFileLoader implements htsw.FileLoader {
    constructor(private readonly src: string) {}

    fileExists(_path: string): boolean {
        return true;
    }

    readFile(_path: string): string {
        return this.src;
    }

    getParentPath(_base: string): string {
        return "";
    }

    resolvePath(_base: string, _other: string): string {
        return "";
    }
}

class HybridFileLoader implements htsw.FileLoader {
    constructor(
        private readonly currentPath: string,
        private readonly currentSource: string
    ) {}

    fileExists(filePath: string): boolean {
        if (absolutePathKey(filePath) === absolutePathKey(this.currentPath)) return true;
        if (this.openDocumentForPath(filePath)) return true;
        return fs.existsSync(filePath);
    }

    readFile(filePath: string): string {
        if (absolutePathKey(filePath) === absolutePathKey(this.currentPath)) {
            return this.currentSource;
        }

        const openDocument = this.openDocumentForPath(filePath);
        if (openDocument) return openDocument.getText();

        return fs.readFileSync(filePath, "utf8");
    }

    getParentPath(base: string): string {
        return path.dirname(base);
    }

    resolvePath(base: string, other: string): string {
        return path.resolve(base, other);
    }

    private openDocumentForPath(filePath: string): vscode.TextDocument | undefined {
        const normalizedPath = absolutePathKey(filePath);
        return vscode.workspace.textDocuments.find((document) =>
            document.uri.scheme === "file" &&
            absolutePathKey(document.uri.fsPath) === normalizedPath
        );
    }
}

export class InlayHintsAdapter implements vscode.InlayHintsProvider {
    private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeInlayHints = this.onDidChangeEmitter.event;
    private readonly configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("htsw.inlayHints")) {
            this.onDidChangeEmitter.fire();
        }
    });

    public provideInlayHints(
        document: vscode.TextDocument
        // range: vscode.Span,
        // token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlayHint[]> {
        const htslHints = common.provideInlayHints(
            document.getText(),
            this.getOptions(document.uri)
        );

        return htslHints.map((hint) => {
            return {
                kind: vscode.InlayHintKind.Parameter,
                position: document.positionAt(hint.span.start),
                label: hint.label + ":",
            };
        });
    }

    public dispose(): void {
        this.configurationListener.dispose();
        this.onDidChangeEmitter.dispose();
    }

    private getOptions(uri: vscode.Uri): common.InlayHintOptions {
        const config = vscode.workspace.getConfiguration("htsw", uri);
        return {
            actionArguments: config.get<boolean>("inlayHints.actionArguments.enabled", true),
            variableArguments: config.get<boolean>("inlayHints.variableArguments.enabled", false),
            conditionArguments: config.get<boolean>("inlayHints.conditionArguments.enabled", true),
        };
    }
}

type DiagnosticGroup = {
    diagnostics: htsw.Diagnostic[];
    sourceMap?: htsw.SourceMap;
    rootPath?: string;
    rootDiagnostics?: htsw.Diagnostic[];
};

export class DiagnosticsAdapter {
    private disposables: vscode.Disposable[] = [];
    private pendingValidations: Map<string, NodeJS.Timeout> = new Map();
    private disposed = false;
    private diagnosticCollection: vscode.DiagnosticCollection =
        vscode.languages.createDiagnosticCollection("htsl");

    private rootContextCache: Map<string, { generation: number; rootPath: string }> = new Map();
    private rootDiagnosticMarkers: Map<string, Map<string, vscode.Diagnostic[]>> = new Map();
    private readonly normalizedLocalHistoryDirectory: string;

    constructor(globalStorageUri: vscode.Uri) {
        const localHistoryDirectory = path.join(
            path.dirname(path.dirname(globalStorageUri.fsPath)),
            "History"
        );
        this.normalizedLocalHistoryDirectory = absolutePathKey(localHistoryDirectory);
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument((document) => this.scheduleValidate(document))
        );
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.contentChanges.length > 0 && !e.document.isDirty && this.isSupportedDocument(e.document)) {
                    // VS Code synced an external disk change or undo-to-saved into the buffer.
                    bumpWorkspaceGeneration();
                }
                this.scheduleValidate(e.document);
            })
        );
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((document) => this.scheduleValidate(document))
        );
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                const key = document.uri.toString();
                const timer = this.pendingValidations.get(key);
                if (timer) {
                    clearTimeout(timer);
                    this.pendingValidations.delete(key);
                }
                if (
                    document.uri.scheme === "file" &&
                    this.isSupportedDocument(document) &&
                    this.getContainingWorkspaceFolders(document.uri).length === 0
                ) {
                    this.diagnosticCollection.set(document.uri, []);
                }
            })
        );
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.refreshOpenDiagnostics();
            })
        );
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("htsw.diagnostics.excludeFolders")) return;

                this.diagnosticCollection.clear();
                vscode.workspace.textDocuments.forEach((document) =>
                    this.scheduleValidate(document, 0)
                );
                this.refreshOpenDiagnostics();
            })
        );

        this.addWorkspaceWatcher("**/*.htsl");
        this.addWorkspaceWatcher("**/*.snbt");
        this.addWorkspaceWatcher("**/import.json");
        this.addWorkspaceWatcher("**/*.import.json");

        vscode.workspace.textDocuments.forEach((document) => this.scheduleValidate(document, 0));
        void this.scanWorkspace();
    }

    // Validate every import.json once on startup; each root validation publishes
    // diagnostics for its include tree, so project badges cover the whole project.
    // Runs in the background; already-open files are covered by the open path.
    private async scanWorkspace(): Promise<void> {
        let files: vscode.Uri[];
        try {
            files = await vscode.workspace.findFiles(
                "**/{import.json,*.import.json}",
                "**/{node_modules,.git}/**",
            );
        } catch {
            return;
        }
        const open = new Set(vscode.workspace.textDocuments.map((document) => document.uri.toString()));
        for (const uri of files) {
            if (this.disposed) return;
            if (open.has(uri.toString()) || this.isExcludedUri(uri)) continue;
            await this.validateUriFromDisk(uri);
        }
    }

    public dispose() {
        this.disposed = true;
        for (const timer of this.pendingValidations.values()) {
            clearTimeout(timer);
        }
        this.pendingValidations.clear();
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

    private addWorkspaceWatcher(pattern: string) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const refreshWorkspace = pattern.includes("import.json");

        this.disposables.push(watcher);
        this.disposables.push(
            watcher.onDidCreate((uri) => {
                bumpWorkspaceGeneration();
                void this.validateUriFromDisk(uri);
                if (refreshWorkspace) this.refreshOpenDiagnostics();
            })
        );
        this.disposables.push(
            watcher.onDidChange((uri) => {
                bumpWorkspaceGeneration();
                void this.validateUriFromDisk(uri);
                if (refreshWorkspace) this.refreshOpenDiagnostics();
            })
        );
        this.disposables.push(watcher.onDidDelete((uri) => {
            bumpWorkspaceGeneration();
            this.diagnosticCollection.set(uri, []);
            if (refreshWorkspace) this.refreshOpenDiagnostics();
        }));
    }

    private scheduleValidate(document: vscode.TextDocument, delayMs = 250) {
        if (!this.isSupportedDocument(document)) return;
        if (this.isExcludedUri(document.uri)) {
            this.diagnosticCollection.set(document.uri, []);
            return;
        }

        const key = document.uri.toString();
        const existing = this.pendingValidations.get(key);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.pendingValidations.delete(key);
            this.validate(document);
        }, delayMs);

        this.pendingValidations.set(key, timer);
    }

    private refreshOpenDiagnostics() {
        for (const document of vscode.workspace.textDocuments) {
            this.scheduleValidate(document, 0);
        }
    }

    private async validateUriFromDisk(uri: vscode.Uri) {
        if (this.isExcludedUri(uri)) {
            this.diagnosticCollection.set(uri, []);
            return;
        }

        const uriKey = uri.toString();
        const isOpen = vscode.workspace.textDocuments.some((document) => document.uri.toString() === uriKey);
        const lowerPath = uri.fsPath.toLowerCase();
        if (
            !isOpen &&
            (lowerPath.endsWith(".htsl") || lowerPath.endsWith(".snbt")) &&
            this.findImportJsonContexts(uri.fsPath).length === 0
        ) {
            this.diagnosticCollection.set(uri, []);
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            this.validate(document);
        } catch {
            this.diagnosticCollection.set(uri, []);
        }
    }

    private validate(document: vscode.TextDocument) {
        const groups = this.collectDiagnostics(document);
        const markers = groups.flatMap((group) =>
            group.diagnostics.flatMap((diagnostic) => {
                const diagnosticSpan =
                    diagnostic.spans.find((span) => span.kind === "primary")?.span ||
                    diagnostic.spans[0]?.span;

                if (!diagnosticSpan) return [];

                const range = this.rangeFromSpan(document, diagnosticSpan, group.sourceMap);
                if (!range) return [];

                const relatedInformation = this.buildRelatedInformation(
                    document,
                    diagnostic,
                    group.sourceMap
                );
                return [
                    this.createVscodeDiagnostic(
                        range,
                        diagnostic,
                        relatedInformation
                    ),
                ];
            })
        );

        this.diagnosticCollection.set(document.uri, markers);
        for (const group of groups) {
            if (group.rootPath !== undefined && group.sourceMap !== undefined && group.rootDiagnostics !== undefined) {
                this.publishRootDiagnostics(group.rootPath, group.sourceMap, group.rootDiagnostics);
            }
        }
    }

    private publishRootDiagnostics(
        rootPath: string,
        sourceMap: htsw.SourceMap,
        diagnostics: htsw.Diagnostic[]
    ): void {
        const rootKey = absolutePathKey(rootPath);
        const previousUris = this.rootDiagnosticMarkers.get(rootKey)?.keys() ?? [];

        const byUri = new Map<string, vscode.Diagnostic[]>();
        for (const diagnostic of diagnostics) {
            const primary =
                diagnostic.spans.find((span) => span.kind === "primary")?.span ||
                diagnostic.spans[0]?.span;
            if (!primary) continue;

            let sourceFile: htsw.SourceFile;
            try {
                sourceFile = sourceMap.getFileByPos(primary.start);
            } catch {
                continue;
            }
            if (isPathInExcludedDiagnosticFolder(sourceFile.path)) continue;

            const uriString = vscode.Uri.file(sourceFile.path).toString();
            const range = this.rangeFromSourceFileSpan(sourceFile, primary);
            const list = byUri.get(uriString) ?? [];
            list.push(this.createVscodeDiagnostic(range, diagnostic, []));
            byUri.set(uriString, list);
        }

        this.rootDiagnosticMarkers.set(rootKey, byUri);
        const affectedUris = new Set<string>([...previousUris, ...byUri.keys()]);
        for (const uriString of affectedUris) {
            const markers: vscode.Diagnostic[] = [];
            for (const rootMarkers of this.rootDiagnosticMarkers.values()) {
                const owned = rootMarkers.get(uriString);
                if (owned !== undefined) markers.push(...owned);
            }
            this.diagnosticCollection.set(vscode.Uri.parse(uriString), markers);
        }
    }

    private createVscodeDiagnostic(
        range: vscode.Range,
        diagnostic: htsw.Diagnostic,
        relatedInformation: vscode.DiagnosticRelatedInformation[]
    ): vscode.Diagnostic {
        const marker = new vscode.Diagnostic(
            range,
            this.formatDiagnosticMessage(diagnostic),
            this.htslDiagnosticLevelToMarkerSeverity(diagnostic.level)
        );

        marker.source = "htsw";
        if (relatedInformation.length > 0) {
            marker.relatedInformation = relatedInformation;
        }

        return marker;
    }

    private formatDiagnosticMessage(diagnostic: htsw.Diagnostic): string {
        return diagnostic.message;
    }

    private buildRelatedInformation(
        document: vscode.TextDocument,
        diagnostic: htsw.Diagnostic,
        sourceMap?: htsw.SourceMap
    ): vscode.DiagnosticRelatedInformation[] {
        const related: vscode.DiagnosticRelatedInformation[] = [];

        for (const spanPart of diagnostic.spans) {
            if (spanPart.kind !== "secondary") continue;
            const relatedInfo =
                    this.relatedFromSpan(
                        document,
                        spanPart.span,
                        spanPart.label ?? "Related location",
                        sourceMap
                    );
            if (relatedInfo) related.push(relatedInfo);
        }

        for (const sub of this.flattenSubDiagnostics(diagnostic)) {
            const label = `${sub.level}: ${sub.message}`;
            for (const spanPart of sub.spans) {
                const relatedInfo =
                    this.relatedFromSpan(
                        document,
                        spanPart.span,
                        spanPart.label ? `${label} (${spanPart.label})` : label,
                        sourceMap
                    );
                if (relatedInfo) related.push(relatedInfo);
            }
        }

        return related;
    }

    private relatedFromSpan(
        document: vscode.TextDocument,
        span: htsw.Span,
        message: string,
        sourceMap?: htsw.SourceMap
    ): vscode.DiagnosticRelatedInformation | undefined {
        const range = this.rangeFromSpan(document, span, sourceMap);
        if (!range) return undefined;

        return new vscode.DiagnosticRelatedInformation(
            new vscode.Location(document.uri, range),
            message
        );
    }

    private flattenSubDiagnostics(root: htsw.Diagnostic): htsw.Diagnostic[] {
        const result: htsw.Diagnostic[] = [];
        const stack = [...root.subDiagnostics];

        while (stack.length > 0) {
            const current = stack.shift()!;
            result.push(current);
            if (current.subDiagnostics.length > 0) {
                stack.unshift(...current.subDiagnostics);
            }
        }

        return result;
    }

    private collectDiagnostics(document: vscode.TextDocument): DiagnosticGroup[] {
        if (document.languageId === "htsl") {
            const contextual = this.collectContextualHtslDiagnostics(document);
            if (contextual !== null) return contextual;

            const sourceMap = new htsw.SourceMap(new StringFileLoader(document.getText()));
            return [{
                diagnostics: htsw.parseActionsResult(sourceMap, "file.htsl").diagnostics,
                sourceMap,
            }];
        }

        if (document.languageId === "snbt") {
            const sourceMap = new htsw.SourceMap(new StringFileLoader(document.getText()));
            const gcx = new htsw.GlobalCtxt(sourceMap, "file.snbt");
            htsw.nbt.parseSnbt(gcx, "file.snbt");
            return [{ diagnostics: gcx.diagnostics, sourceMap }];
        }

        if (this.isImportJsonDocument(document)) {
            const docPath = document.uri.fsPath;
            const rootPath = this.findRootContext(docPath);
            const { result, sourceMap } = this.parseRootScope(rootPath, document);
            return [{
                diagnostics: result.diagnostics.filter((diagnostic) =>
                    this.isDiagnosticForFile(diagnostic, sourceMap, docPath)
                ),
                sourceMap,
                rootPath,
                rootDiagnostics: result.diagnostics,
            }];
        }

        return [];
    }

    // An .htsl file is checked in its ROOT scope — the outermost import.json
    // that transitively includes its declaring import.json — so VS Code's
    // errors match what an in-game import of the whole project sees.
    private collectContextualHtslDiagnostics(document: vscode.TextDocument): DiagnosticGroup[] | null {
        if (document.uri.scheme !== "file") return null;

        const docPath = document.uri.fsPath;
        let firstContext: DiagnosticGroup | null = null;
        for (const declaringPath of this.findImportJsonContexts(docPath)) {
            const rootPath = this.findRootContext(declaringPath);
            const rootParse = this.parseRootScope(rootPath, document);
            const rootDiagnostics = rootParse.result.diagnostics.filter((diagnostic) =>
                this.isDiagnosticForFile(diagnostic, rootParse.sourceMap, docPath)
            );
            if (firstContext === null) {
                firstContext = {
                    diagnostics: rootDiagnostics,
                    sourceMap: rootParse.sourceMap,
                    rootPath,
                    rootDiagnostics: rootParse.result.diagnostics,
                };
            }
            if (rootDiagnostics.length > 0) {
                return [{
                    diagnostics: rootDiagnostics,
                    sourceMap: rootParse.sourceMap,
                    rootPath,
                    rootDiagnostics: rootParse.result.diagnostics,
                }];
            }
        }

        return firstContext === null ? null : [firstContext];
    }

    private parseInContext(contextPath: string, document: vscode.TextDocument): ContextParse {
        const sourceMap = new htsw.SourceMap(
            new HybridFileLoader(document.uri.fsPath, document.getText())
        );
        return { result: htsw.parseImportablesResult(sourceMap, contextPath), sourceMap };
    }

    // Dirty documents parse fresh (the shared cache reads open buffers but
    // is only invalidated by on-disk changes); clean documents share the
    // generation-keyed cache with the project tree.
    private parseRootScope(rootPath: string, document: vscode.TextDocument): ContextParse {
        if (document.isDirty) return this.parseInContext(rootPath, document);
        return getCachedRootParse(rootPath);
    }

    // The outermost import.json in the file's ancestor directories that
    // transitively includes the declaring import.json; the declaring import.json
    // itself when nothing above includes it.
    private findRootContext(declaringPath: string): string {
        const cacheKey = absolutePathKey(declaringPath);
        const cached = this.rootContextCache.get(cacheKey);
        if (cached && cached.generation === workspaceGeneration()) return cached.rootPath;

        let rootPath = declaringPath;
        const workspaceRoots = this.getContainingWorkspaceFolders(vscode.Uri.file(declaringPath))
            .map((folder) => absolutePathKey(folder.uri.fsPath));
        const stopAt = workspaceRoots[0] ?? absolutePathKey(path.parse(declaringPath).root);
        let dir = path.dirname(declaringPath);

        while (true) {
            for (const candidate of this.listImportJsonFiles(dir)) {
                if (absolutePathKey(candidate) === cacheKey) continue;
                if (this.importJsonIncludesTransitively(candidate, declaringPath)) {
                    rootPath = candidate;
                }
            }

            const normalizedDir = absolutePathKey(dir);
            const parent = path.dirname(dir);
            if (normalizedDir === stopAt || parent === dir) break;
            dir = parent;
        }

        this.rootContextCache.set(cacheKey, { generation: workspaceGeneration(), rootPath });
        return rootPath;
    }

    private importJsonIncludesTransitively(entryPath: string, targetPath: string): boolean {
        const targetKey = absolutePathKey(targetPath);
        let found = false;
        try {
            walkImportJsonTree(nodeProjectFs, entryPath, (filePath) => {
                if (absolutePathKey(filePath) !== targetKey) return undefined;
                found = true;
                return true;
            });
        } catch {
            return false;
        }
        return found;
    }

    private findImportJsonContexts(filePath: string): string[] {
        const contexts: string[] = [];
        const workspaceRoots = this.getContainingWorkspaceFolders(vscode.Uri.file(filePath))
            .map((folder) => absolutePathKey(folder.uri.fsPath));
        const stopAt = workspaceRoots[0] ?? absolutePathKey(path.parse(filePath).root);
        let dir = path.dirname(filePath);

        while (true) {
            for (const candidate of this.listImportJsonFiles(dir)) {
                if (this.fileTextReferencesPath(candidate, filePath)) {
                    contexts.push(candidate);
                }
            }

            const normalizedDir = absolutePathKey(dir);
            const parent = path.dirname(dir);
            if (normalizedDir === stopAt || parent === dir) break;
            dir = parent;
        }

        // The text-reference walk only sees import.jsons in ancestor
        // directories, but a file can be declared by an import.json in a
        // sibling branch (menus/import.json referencing ../testing/x.htsl).
        // Fall back to asking each ancestor import.json's cached root parse
        // whether it actually loads this file.
        if (contexts.length === 0) {
            const fileKey = absolutePathKey(filePath);
            let searchDir = path.dirname(filePath);
            while (true) {
                for (const candidate of this.listImportJsonFiles(searchDir)) {
                    let parse: ContextParse;
                    try {
                        parse = getCachedRootParse(candidate);
                    } catch {
                        continue;
                    }
                    const loadsFile = parse.sourceMap.sourceFiles.some(
                        (file) => absolutePathKey(file.path) === fileKey
                    );
                    if (loadsFile) contexts.push(candidate);
                }
                if (contexts.length > 0) break;
                const normalizedDir = absolutePathKey(searchDir);
                const parent = path.dirname(searchDir);
                if (normalizedDir === stopAt || parent === searchDir) break;
                searchDir = parent;
            }
        }

        return contexts;
    }

    private listImportJsonFiles(dir: string): string[] {
        try {
            return fs.readdirSync(dir)
                .filter((name) => name === "import.json" || name.endsWith(".import.json"))
                .map((name) => path.join(dir, name));
        } catch {
            return [];
        }
    }

    private fileTextReferencesPath(importJsonPath: string, referencedPath: string): boolean {
        const openDocument = vscode.workspace.textDocuments.find((document) =>
            document.uri.scheme === "file" &&
            absolutePathKey(document.uri.fsPath) === absolutePathKey(importJsonPath)
        );
        const src = openDocument?.getText() ?? this.readFileIfExists(importJsonPath);
        if (src === undefined) return false;

        const normalizedReference = this.normalizePath(
            path.relative(path.dirname(importJsonPath), referencedPath)
        );
        return src.includes(normalizedReference) || src.includes(path.basename(referencedPath));
    }

    private readFileIfExists(filePath: string): string | undefined {
        try {
            return fs.readFileSync(filePath, "utf8");
        } catch {
            return undefined;
        }
    }

    private isDiagnosticForFile(
        diagnostic: htsw.Diagnostic,
        sourceMap: htsw.SourceMap,
        docPath: string
    ): boolean {
        const span =
            diagnostic.spans.find((it) => it.kind === "primary")?.span ||
            diagnostic.spans[0]?.span;

        if (!span) return true;

        try {
            const sourceFile = sourceMap.getFileByPos(span.start);
            return absolutePathKey(sourceFile.path) === absolutePathKey(docPath);
        } catch {
            return true;
        }
    }

    private rangeFromSpan(
        document: vscode.TextDocument,
        span: htsw.Span,
        sourceMap?: htsw.SourceMap
    ): vscode.Range | undefined {
        if (!sourceMap) {
            return new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
        }

        try {
            const sourceFile = sourceMap.getFileByPos(span.start);
            if (
                document.uri.scheme === "file" &&
                absolutePathKey(sourceFile.path) !== absolutePathKey(document.uri.fsPath)
            ) {
                return undefined;
            }

            const start = document.positionAt(span.start - sourceFile.startPos);
            const end = document.positionAt(span.end - sourceFile.startPos);
            return new vscode.Range(start, end);
        } catch {
            return new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
        }
    }

    private rangeFromSourceFileSpan(sourceFile: htsw.SourceFile, span: htsw.Span): vscode.Range {
        const start = sourceFile.getPosition(span.start);
        const end = sourceFile.getPosition(span.end);
        return new vscode.Range(
            new vscode.Position(start.line - 1, start.column - 1),
            new vscode.Position(end.line - 1, end.column - 1)
        );
    }

    private isSupportedDocument(document: vscode.TextDocument): boolean {
        return document.languageId === "htsl" ||
            document.languageId === "snbt" ||
            this.isImportJsonDocument(document);
    }

    private isExcludedUri(uri: vscode.Uri): boolean {
        if (uri.scheme !== "file") return false;
        const normalizedUriPath = absolutePathKey(uri.fsPath);
        return isPathInExcludedDiagnosticFolder(uri.fsPath) ||
            normalizedUriPath.startsWith(`${this.normalizedLocalHistoryDirectory}/`);
    }

    private isImportJsonDocument(document: vscode.TextDocument): boolean {
        if (document.languageId !== "json" && document.languageId !== "jsonc") return false;
        const filePath = document.uri.fsPath.toLowerCase();
        return filePath.endsWith("import.json") || filePath.endsWith(".import.json");
    }

    private getContainingWorkspaceFolders(uri: vscode.Uri): vscode.WorkspaceFolder[] {
        return (vscode.workspace.workspaceFolders ?? [])
            .filter((workspaceFolder) => {
                const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                return relativePath === "" || !relativePath.startsWith("..");
            })
            .sort((left, right) => right.uri.fsPath.length - left.uri.fsPath.length);
    }

    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, "/").toLowerCase();
    }

    private htslDiagnosticLevelToMarkerSeverity(
        severity: htsw.DiagnosticLevel
    ): vscode.DiagnosticSeverity {
        switch (severity) {
            case "bug":
            case "error":
                return vscode.DiagnosticSeverity.Error;
            case "warning":
                return vscode.DiagnosticSeverity.Warning;
            case "note":
                return vscode.DiagnosticSeverity.Information;
            case "help":
                return vscode.DiagnosticSeverity.Hint;
        }
    }
}

export class SnbtCodeActionAdapter implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.RefactorRewrite,
    ];

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        if (document.languageId !== "snbt") return [];

        const actions: vscode.CodeAction[] = [];
        const text = document.getText();
        const cursorOffset = document.offsetAt(range.start);
        const target = findStringAtOffset(text, cursorOffset);

        if (target) {
            const rawString = text.slice(target.start, target.end);
            const converted = convertAmpersandFormattingCodes(rawString);
            if (converted !== rawString) {
                const action = new vscode.CodeAction(
                    "Convert & formatting codes in string to section signs",
                    vscode.CodeActionKind.RefactorRewrite,
                );
                action.edit = new vscode.WorkspaceEdit();
                action.edit.replace(
                    document.uri,
                    new vscode.Range(
                        document.positionAt(target.start),
                        document.positionAt(target.end),
                    ),
                    converted,
                );
                actions.push(action);
            }
        }

        const fileEdit = buildFormattingCodeFileEdit(document, text);
        if (fileEdit !== undefined) {
            const action = new vscode.CodeAction(
                "Convert all & formatting codes to section signs",
                vscode.CodeActionKind.RefactorRewrite,
            );
            action.edit = fileEdit;
            actions.push(action);
        }

        const prettyAction = buildSnbtPrettyPrintAction(document, text);
        if (prettyAction) actions.push(prettyAction);

        const config = vscode.workspace.getConfiguration("htsw", document.uri);
        if (!config.get<boolean>("snbt.suggestLoreSplitting", false)) return actions;
        const maxWidth = Math.max(8, config.get<number>("snbt.loreLineMaxWidth", 40));

        if (!target) return actions;

        const layout = computeBestLayout(target.value, { maxLength: maxWidth });
        if (!layout.includes("\n")) return actions;

        const lines = layout.split("\n");
        const quoted = lines.map((line) => quoteSnbtString(line, target.quote));

        const editRange = new vscode.Range(
            document.positionAt(target.start),
            document.positionAt(target.end),
        );

        const startLineText = document.lineAt(editRange.start.line).text;
        const endLineText = document.lineAt(editRange.end.line).text;
        const prefixBeforeString = startLineText.slice(0, editRange.start.character);
        const suffixAfterString = endLineText.slice(editRange.end.character);
        const stringIsAlone =
            editRange.start.line === editRange.end.line &&
            /^\s*$/.test(prefixBeforeString) &&
            /^\s*,?\s*$/.test(suffixAfterString);

        const separator = stringIsAlone ? `,\n${prefixBeforeString}` : ", ";
        const replacement = quoted.join(separator);

        const action = new vscode.CodeAction(
            `Split lore line for optimal display (→ ${lines.length} lines)`,
            vscode.CodeActionKind.RefactorRewrite,
        );
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, editRange, replacement);
        actions.push(action);

        return actions;
    }
}

function buildSnbtPrettyPrintAction(
    document: vscode.TextDocument,
    text: string,
): vscode.CodeAction | undefined {
    const trimmed = text.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[") return undefined;
    if (text.includes("\n") && document.lineCount > 5) return undefined;

    const result = formatSnbtText(text);
    if (!result.ok) return undefined;
    if (!result.output.includes("\n")) return undefined;

    const action = new vscode.CodeAction(
        "Pretty-print SNBT",
        vscode.CodeActionKind.RefactorRewrite,
    );
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
        result.output,
    );
    return action;
}

export class JsonSnbtCodeActionAdapter implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.RefactorRewrite,
    ];

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        if (document.languageId !== "json" && document.languageId !== "jsonc") return [];

        const text = document.getText();
        const cursorOffset = document.offsetAt(range.start);
        const stringRange = findEnclosingJsonString(text, cursorOffset);
        if (!stringRange) return [];

        const inner = text.slice(stringRange.openQuote + 1, stringRange.closeQuote);
        const decoded = decodeJsonStringContent(inner);
        const looksLikeSnbt = /^\s*[{[]/.test(decoded);
        if (!looksLikeSnbt) return [];

        const result = formatSnbtText(decoded);
        if (!result.ok) return [];
        if (!result.output.includes("\n")) return [];

        const editRange = new vscode.Range(
            document.positionAt(stringRange.openQuote),
            document.positionAt(stringRange.closeQuote + 1),
        );

        const replaceAction = new vscode.CodeAction(
            "Pretty-print SNBT (re-encode inline)",
            vscode.CodeActionKind.RefactorRewrite,
        );
        replaceAction.edit = new vscode.WorkspaceEdit();
        replaceAction.edit.replace(document.uri, editRange, encodeJsonString(result.output));

        const previewAction = new vscode.CodeAction(
            "Open formatted SNBT in new editor",
            vscode.CodeActionKind.RefactorRewrite,
        );
        previewAction.command = {
            command: "htsw.snbt.openFormattedPreview",
            title: "Open formatted SNBT in new editor",
            arguments: [result.output],
        };

        return [previewAction, replaceAction];
    }
}

function buildFormattingCodeFileEdit(
    document: vscode.TextDocument,
    text: string,
): vscode.WorkspaceEdit | undefined {
    const edit = new vscode.WorkspaceEdit();
    let changed = false;
    const lexer = new htsw.nbt.Lexer(text);

    while (true) {
        const tok = lexer.advanceToken();
        if (tok.kind === "eof") break;
        if (tok.kind === "unknown") break;
        if (tok.kind !== "str") continue;

        const rawString = text.slice(tok.span.start, tok.span.end);
        const converted = convertAmpersandFormattingCodes(rawString);
        if (converted === rawString) continue;

        edit.replace(
            document.uri,
            new vscode.Range(
                document.positionAt(tok.span.start),
                document.positionAt(tok.span.end),
            ),
            converted,
        );
        changed = true;
    }

    return changed ? edit : undefined;
}

function convertAmpersandFormattingCodes(text: string): string {
    let out = "";

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (
            ch === "&" &&
            next !== undefined &&
            /[0-9a-fk-or]/.test(next) &&
            !isEscaped(text, i)
        ) {
            out += "§" + next;
            i++;
            continue;
        }

        out += ch;
    }

    return out;
}

function isEscaped(text: string, index: number): boolean {
    let backslashes = 0;
    for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
        backslashes++;
    }
    return backslashes % 2 === 1;
}

function findStringAtOffset(
    text: string,
    offset: number,
): { start: number; end: number; value: string; quote: '"' | "'" } | undefined {
    const lexer = new htsw.nbt.Lexer(text);
    while (true) {
        const tok = lexer.advanceToken();
        if (tok.kind === "eof" || tok.kind === "unknown") return undefined;
        if (tok.kind === "str" && offset >= tok.span.start && offset <= tok.span.end) {
            const quote: '"' | "'" = text[tok.span.start] === "'" ? "'" : '"';
            return { start: tok.span.start, end: tok.span.end, value: tok.value, quote };
        }
    }
}

function quoteSnbtString(text: string, quote: '"' | "'"): string {
    let escaped = "";
    for (const ch of text) {
        if (ch === "\\") escaped += "\\\\";
        else if (ch === quote) escaped += "\\" + quote;
        else if (ch === "\n") escaped += "\\n";
        else if (ch === "\r") escaped += "\\r";
        else if (ch === "\t") escaped += "\\t";
        else escaped += ch;
    }
    return quote + escaped + quote;
}
