import type { Span } from "./span";

export type Edit = { span: Span, text: string };

export type DiagnosticLevel = "bug" | "error" | "warning" | "info";

export type DiagnosticPart =
    | { kind: "label"; span: Span; text?: string }
    | { kind: "reference"; span: Span; text?: string }
    | { kind: "edit", edits: Edit[] }
    | { kind: "note"; text: string }
    | { kind: "hint"; text: string };

export class Diagnostic {
    message: string;
    level: DiagnosticLevel;

    parts: DiagnosticPart[] = [];

    private constructor(
        message: string, level: DiagnosticLevel
    ) {
        this.message = message;
        this.level = level;
    }

    static error(message: string): Diagnostic {
        return new Diagnostic(message, "error");
    }

    static warning(message: string): Diagnostic {
        return new Diagnostic(message, "warning");
    }

    label(span: Span, text?: string): this {
        this.parts.push({ kind: "label", span, text });
        return this;
    }

    reference(span: Span, text?: string): this {
        this.parts.push({ kind: "reference", span, text });
        return this;
    }

    edit(edits: Edit[]): this {
        this.parts.push({ kind: "edit", edits });
        return this;
    }

    note(text: string): this {
        this.parts.push({ kind: "note", text });
        return this;
    }

    hint(text: string): this {
        this.parts.push({ kind: "hint", text });
        return this;
    }
}
