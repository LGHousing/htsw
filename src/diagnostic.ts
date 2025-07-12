import type { Span } from './span';

export type DiagnosticLevel = 'bug' | 'error' | 'warning' | 'info';

export class Diagnostic extends Error {
    level: DiagnosticLevel;
    span: Span;

    constructor(message: string, level: DiagnosticLevel, span: Span) {
        super(message);

        this.level = level;
        this.span = span;
    }
}

export function error(message: string, span: Span): Diagnostic {
    return new Diagnostic(message, 'error', span);
}

export function warn(message: string, span: Span): Diagnostic {
    return new Diagnostic(message, 'warning', span);
}
