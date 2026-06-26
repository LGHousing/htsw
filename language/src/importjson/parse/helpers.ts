import * as json from "jsonc-parser";
import { Span } from "../../span";
import { Diagnostic } from "../../diagnostic";
import type { Parser } from "./parser";

export function nodeSpan(node: json.Node, startPos: number): Span {
    return new Span(startPos + node.offset, startPos + node.offset + node.length);
}

export function getFileName(path: string): string {
    const lastSlash = Math.max(
        path.lastIndexOf("/"),
        path.lastIndexOf("\\")
    );
    return path.slice(lastSlash + 1);
}

export function normalizeOption(value: string): string {
    return value.split(" ").join("").split("_").join("").toLowerCase();
}

export function parseOption<T extends string>(
    p: Parser,
    options: readonly T[],
    errorTerms?: { singular: string, plural: string },
): T {
    const value = p.parseString();

    for (const option of options) {
        if (option === value) return option;
    }

    const err = Diagnostic.error(`Unknown ${errorTerms?.singular ?? "option"}: \`${value}\``)
        .addPrimarySpan(p.span());

    const norm = normalizeOption(value);
    for (const option of options) {
        if (normalizeOption(option) === norm) {
            err.addSubDiagnostic(Diagnostic.help(
                `Did you mean \`${option}\`?`
            ));
            p.gcx.addDiagnostic(err);
            return value as T;
        }
    }

    err.addSubDiagnostic(Diagnostic.help(`Valid ${errorTerms?.plural ?? "options"} are:`));
    const count = Math.min(5, options.length);
    for (let i = 0; i < count; i++) {
        err.addSubDiagnostic(Diagnostic.help(`  ${options[i]}`));
    }
    if (options.length > 5) {
        err.addSubDiagnostic(Diagnostic.help(`  ...and ${options.length - 5} others`));
    }

    p.gcx.addDiagnostic(err);
    return value as T;
}

export function warnUnused(p: Parser, known: readonly string[]): void {
    for (const { key } of p.parseFields()) {
        const name = key.parseString();
        if (known.includes(name)) continue;

        p.gcx.addDiagnostic(
            Diagnostic.warning(`Unknown key '${name}'`)
                .addPrimarySpan(key.span())
                .addSubDiagnostic(
                    Diagnostic.help(`Valid keys are: ${known.join(", ")}`)
                )
        );
    }
}
