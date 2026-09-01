import { stripSurroundingQuotes } from "../utils/helpers";
import { houseExportTypeByToken } from "../importables/export/exportTypes";
import type { ExportBatchType, NamedExportType } from "../importables/export/session";

export function tokenizeQuoted(args: readonly string[]): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (
            arg.length >= 2 &&
            arg.charAt(0) === '"' &&
            arg.charAt(arg.length - 1) === '"'
        ) {
            out.push(arg.substring(1, arg.length - 1));
            i++;
            continue;
        }
        if (arg.charAt(0) === '"') {
            const parts: string[] = [arg.substring(1)];
            i++;
            while (i < args.length) {
                const next = args[i];
                if (next.length > 0 && next.charAt(next.length - 1) === '"') {
                    parts.push(next.substring(0, next.length - 1));
                    i++;
                    break;
                }
                parts.push(next);
                i++;
            }
            out.push(parts.join(" "));
            continue;
        }
        out.push(arg);
        i++;
    }
    return out;
}

export function isTypeToken(token: string | undefined, singular: string): boolean {
    return token === singular || token === `${singular}s`;
}

export function parseIntegerToken(token: string | undefined, label: string): number {
    if (token === undefined || !/^-?\d+$/.test(token)) {
        throw new Error(`Expected integer ${label}.`);
    }
    return Number(token);
}

export function pathArgument(
    tokens: readonly string[],
    start: number
): string | undefined {
    const parts = tokens.slice(start);
    const raw = parts.length > 0 ? parts.join(" ") : "";
    return raw.length > 0 ? stripSurroundingQuotes(raw) : undefined;
}

export function exportTypeFromToken(token: string | undefined): ExportBatchType | null {
    const spec = houseExportTypeByToken(token);
    if (spec !== null) return spec.type;
    if (isTypeToken(token, "npc")) return "NPC";
    return null;
}

export function namedExportTypeFromToken(
    token: string | undefined
): NamedExportType | null {
    const spec = houseExportTypeByToken(token);
    if (spec !== null && spec.named) return spec.type as NamedExportType;
    return null;
}
