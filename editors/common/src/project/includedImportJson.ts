import {
    joinPath,
    normalizeRelativeProjectPath,
    parentDir,
    type ProjectFs,
} from "./fs";

export type CreateIncludedImportJsonResult = {
    importJsonPath: string;
    parentImportJsonPath: string;
    includePath: string;
};

export function createIncludedImportJsonFiles(
    fs: ProjectFs,
    baseDir: string,
    folderPath: string,
    parentImportJsonPath: string
): CreateIncludedImportJsonResult {
    const relativeFolder = normalizeRelativeProjectPath(folderPath);
    const importJsonPath = joinPath(joinPath(baseDir, relativeFolder), "import.json");
    if (fs.exists(importJsonPath)) {
        throw new Error(`${relativeFolder}/import.json already exists.`);
    }

    fs.ensureDir(parentDir(importJsonPath));
    fs.writeFile(importJsonPath, "{}\n");

    const parentSource = fs.readFile(parentImportJsonPath);
    const includePath = relativePath(parentDir(parentImportJsonPath), importJsonPath);
    const nextParentSource = addIncludeToImportJsonSource(parentSource, includePath);
    fs.writeFile(parentImportJsonPath, nextParentSource);

    return { importJsonPath, parentImportJsonPath, includePath };
}

export function addIncludeToImportJsonSource(source: string, includePath: string): string {
    const encoded = JSON.stringify(includePath);
    const includeValue = findTopLevelPropertyValue(source, "include");
    if (includeValue) {
        const valueStart = skipWhitespaceAndComments(source, includeValue.start);
        if (source.charAt(valueStart) === "[") {
            const close = findMatching(source, valueStart, "[", "]");
            if (close < 0) throw new Error("Could not edit include array.");
            const hasEntries = skipWhitespaceAndComments(source, valueStart + 1) < close;
            const trailingComma = hasEntries && lastMeaningfulIsComma(source, valueStart + 1, close);
            return source.substring(0, close) +
                (hasEntries ? (trailingComma ? ` ${encoded}` : `, ${encoded}`) : encoded) +
                source.substring(close);
        }
        return source.substring(0, includeValue.start) +
            `[${encoded}]` +
            source.substring(includeValue.end);
    }

    const open = skipWhitespaceAndComments(source, 0);
    if (source.charAt(open) !== "{") throw new Error("Parent import.json must be a JSON object.");
    const close = findMatching(source, open, "{", "}");
    if (close < 0) throw new Error("Parent import.json must be a JSON object.");

    const hasProperties = skipWhitespaceAndComments(source, open + 1) < close;
    const prefix = `\n    "include": [${encoded}]${hasProperties ? "," : ""}`;
    const suffix = hasProperties ? "" : "\n";
    return source.substring(0, open + 1) + prefix + suffix + source.substring(open + 1);
}

function findTopLevelPropertyValue(
    source: string,
    property: string
): { start: number; end: number } | null {
    let i = 0;
    let depth = 0;
    while (i < source.length) {
        const skipped = skipWhitespaceAndComments(source, i);
        i = skipped;
        const ch = source.charAt(i);
        if (ch === "{" || ch === "[") {
            depth++;
            i++;
            continue;
        }
        if (ch === "}" || ch === "]") {
            depth--;
            i++;
            continue;
        }
        if (ch === "\"") {
            const end = scanStringEnd(source, i);
            if (depth === 1 && decodeJsonString(source.substring(i, end + 1)) === property) {
                const colon = skipWhitespaceAndComments(source, end + 1);
                if (source.charAt(colon) !== ":") {
                    i = end + 1;
                    continue;
                }
                const valueStart = skipWhitespaceAndComments(source, colon + 1);
                return { start: valueStart, end: findValueEnd(source, valueStart) };
            }
            i = end + 1;
            continue;
        }
        i++;
    }
    return null;
}

function findValueEnd(source: string, start: number): number {
    const ch = source.charAt(start);
    if (ch === "{") return checkedMatching(source, start, "{", "}") + 1;
    if (ch === "[") return checkedMatching(source, start, "[", "]") + 1;
    if (ch === "\"") return scanStringEnd(source, start) + 1;

    let i = start;
    while (i < source.length) {
        const c = source.charAt(i);
        if (c === "," || c === "}" || c === "]" || c === "\n" || c === "\r") break;
        i++;
    }
    return i;
}

function checkedMatching(source: string, start: number, open: string, close: string): number {
    const end = findMatching(source, start, open, close);
    if (end < 0) throw new Error("Could not edit parent import.json.");
    return end;
}

function findMatching(source: string, start: number, open: string, close: string): number {
    let depth = 0;
    let i = start;
    while (i < source.length) {
        i = skipWhitespaceAndComments(source, i);
        const ch = source.charAt(i);
        if (ch === "\"") {
            i = scanStringEnd(source, i) + 1;
            continue;
        }
        if (ch === open) depth++;
        if (ch === close) {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return -1;
}

function lastMeaningfulIsComma(source: string, start: number, end: number): boolean {
    let last = -1;
    let i = start;
    while (i < end) {
        i = skipWhitespaceAndComments(source, i);
        if (i >= end) break;
        last = i;
        i = source.charAt(i) === "\"" ? scanStringEnd(source, i) + 1 : i + 1;
    }
    return last >= 0 && source.charAt(last) === ",";
}

function skipWhitespaceAndComments(source: string, start: number): number {
    let i = start;
    while (i < source.length) {
        const ch = source.charAt(i);
        if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
            i++;
            continue;
        }
        if (ch === "/" && source.charAt(i + 1) === "/") {
            i += 2;
            while (i < source.length && source.charAt(i) !== "\n") i++;
            continue;
        }
        if (ch === "/" && source.charAt(i + 1) === "*") {
            i += 2;
            while (i + 1 < source.length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) i++;
            i += 2;
            continue;
        }
        return i;
    }
    return i;
}

function scanStringEnd(source: string, start: number): number {
    let escaped = false;
    for (let i = start + 1; i < source.length; i++) {
        const ch = source.charAt(i);
        if (escaped) {
            escaped = false;
        } else if (ch === "\\") {
            escaped = true;
        } else if (ch === "\"") {
            return i;
        }
    }
    return source.length - 1;
}

function decodeJsonString(encoded: string): string | null {
    try {
        return JSON.parse(encoded) as string;
    } catch (_err) {
        return null;
    }
}

export function relativePath(fromDirectory: string, targetPath: string): string {
    const from = pathParts(fromDirectory);
    const target = pathParts(targetPath);
    while (from.length > 0 && target.length > 0 && samePathPart(from[0], target[0])) {
        from.shift();
        target.shift();
    }
    const segments = from.map(() => "..").concat(target);
    return segments.length === 0 ? "." : segments.join("/");
}

function pathParts(path: string): string[] {
    return path.split("\\").join("/").split("/").filter((part) => part.length > 0);
}

function samePathPart(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}
