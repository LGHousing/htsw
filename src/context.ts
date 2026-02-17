import type { Diagnostic } from "./diagnostic";
import type { SourceMap } from "./sourceMap";
import type { IrImportable } from "./ir";

export class GlobalCtxt {
    path: string;
    
    sourceMap: SourceMap;
    importables: IrImportable[];
    diagnostics: Diagnostic[];

    constructor(
        sourceMap: SourceMap,
        path: string,
    ) {
        this.sourceMap = sourceMap;
        this.path = path;
        this.importables = [];
        this.diagnostics = [];
    }
    
    addDiagnostic(diag: Diagnostic) {
        this.diagnostics.push(diag);
    }

    isFailed(): boolean {
        return this.diagnostics.find(
            it => it.level === "error" || it.level === "bug"
        ) !== undefined;
    }
    
    resolvePath(path: string): string {
        return this.sourceMap.fileLoader.resolvePath(
            this.sourceMap.fileLoader.getParentPath(this.path),
            path
        );
    }
    
    readFile(path: string): string {
        return this.sourceMap.fileLoader.readFile(this.resolvePath(path));
    }
    
    fileExists(path: string): boolean {
        return this.sourceMap.fileLoader.fileExists(this.resolvePath(path));
    }
    
    subContext(path: string): GlobalCtxt {        
        const gcx = new GlobalCtxt(this.sourceMap, this.resolvePath(path));
        gcx.importables = this.importables;
        gcx.diagnostics = this.diagnostics;
        return gcx;
    }
}