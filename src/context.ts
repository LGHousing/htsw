import type { Diagnostic } from "./diagnostic";
import type { SourceMap } from "./sourceMap";
import type { IrImportable } from "./ir";

export class ParseContext {
    sourceMap: SourceMap;
    importables: IrImportable[];
    diagnostics: Diagnostic[];

    private constructor(
        sourceMap: SourceMap
    ) {
        this.sourceMap = sourceMap;
        this.importables = [];
        this.diagnostics = [];
    }

    addDiagnostic(diagnostic: Diagnostic) {
        this.diagnostics.push(diagnostic);
    }
}