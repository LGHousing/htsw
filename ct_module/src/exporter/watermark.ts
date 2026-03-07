import type { WatermarkPayload } from "./types";

export const WATERMARK_START = "[HTSW-WM:v1]";
export const WATERMARK_END = "[/HTSW-WM]";

export type ParsedFunctionNote = {
    userNote: string;
    payload?: WatermarkPayload;
    malformed: boolean;
};

function parseWatermarkBlock(block: string): WatermarkPayload | undefined {
    const values = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const sep = trimmed.indexOf("=");
        if (sep <= 0) continue;
        const key = trimmed.slice(0, sep).trim();
        const value = trimmed.slice(sep + 1).trim();
        values.set(key, value);
    }

    const hash = values.get("hash");
    const updatedAt = values.get("updatedAt");
    if (!hash || !updatedAt) return undefined;
    return { hash, updatedAt };
}

function stripBlock(note: string): { userNote: string; payload?: WatermarkPayload; malformed: boolean } {
    const startIndex = note.indexOf(WATERMARK_START);
    if (startIndex === -1) {
        return { userNote: note.trim(), malformed: false };
    }

    const endIndex = note.indexOf(WATERMARK_END, startIndex + WATERMARK_START.length);
    if (endIndex === -1) {
        return {
            userNote: note.slice(0, startIndex).trim(),
            malformed: true,
        };
    }

    const before = note.slice(0, startIndex).trim();
    const after = note.slice(endIndex + WATERMARK_END.length).trim();
    const block = note
        .slice(startIndex + WATERMARK_START.length, endIndex)
        .trim();

    const payload = parseWatermarkBlock(block);
    const userNote = [before, after].filter((it) => it.length > 0).join("\n\n").trim();

    return {
        userNote,
        payload,
        malformed: payload === undefined,
    };
}

export function parseFunctionNote(note: string | null | undefined): ParsedFunctionNote {
    if (note == null || note.trim().length === 0) {
        return { userNote: "", malformed: false };
    }
    return stripBlock(note);
}

export function applyFunctionWatermark(
    note: string | null | undefined,
    payload: WatermarkPayload
): string {
    const parsed = parseFunctionNote(note);
    const block = [
        WATERMARK_START,
        `hash=${payload.hash}`,
        `updatedAt=${payload.updatedAt}`,
        WATERMARK_END,
    ].join("\n");

    if (parsed.userNote.length === 0) {
        return block;
    }

    return `${parsed.userNote}\n\n${block}`;
}

