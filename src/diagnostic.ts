import type { Span } from "./span";

export type DiagnosticEdit = { span: Span, text: string };

export type DiagnosticLevel = "bug" | "error" | "warning" | "note" | "help";

export type DiagnosticSpan = {
    kind: "primary" | "secondary";
    span: Span;
    label?: string;
};

export class Diagnostic {
    message: string;
    level: DiagnosticLevel;

    spans: DiagnosticSpan[];
    edits: DiagnosticEdit[];

    subDiagnostics: Diagnostic[];

    private constructor(
        message: string, level: DiagnosticLevel
    ) {
        this.message = message;
        this.level = level;

        this.spans = [];
        this.edits = [];

        this.subDiagnostics = [];
    }

    static bugFromError(error: Error): Diagnostic {
        const diag = new Diagnostic(`Unexpected error: ${error.message}`, "bug");

        if (error.stack) {
            for (const line of error.stack.split("\n")) {
                diag.addSubDiagnostic(Diagnostic.note(line));
            }
        }

        if (error.cause instanceof Error) {
            diag.addSubDiagnostic(Diagnostic.bugFromError(error.cause));
        }

        return diag;
    }

    static bug(message: string): Diagnostic {
        return new Diagnostic(message, "bug");
    }

    static error(message: string): Diagnostic {
        return new Diagnostic(message, "error");
    }

    static warning(message: string): Diagnostic {
        return new Diagnostic(message, "warning");
    }

    static note(message: string): Diagnostic {
        return new Diagnostic(message, "note");
    }

    static help(message: string): Diagnostic {
        return new Diagnostic(message, "help");
    }

    addPrimarySpan(span: Span, label?: string): this {
        this.spans.push({ kind: "primary", span, label });
        return this;
    }

    addSecondarySpan(span: Span, label?: string): this {
        this.spans.push({ kind: "secondary", span, label });
        return this;
    }

    addEdit(span: Span, text: string): this {
        this.edits.push({ span, text });
        return this;
    }

    addSubDiagnostic(diag: Diagnostic): this {
        this.subDiagnostics.push(diag);
        return this;
    }

}
