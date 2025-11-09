import type { Diagnostic } from "./diagnostic";
import type { SourceMap } from "./sourceMap";
import type { IrImportable } from "./ir";

export class GlobalCtxt {
    sourceMap: SourceMap;
    importables: IrImportable[];
    diagnostics: Diagnostic[];

    constructor(
        sourceMap: SourceMap
    ) {
        this.sourceMap = sourceMap;
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
}