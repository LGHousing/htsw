/**
 * Best-effort `mkdir -p` for the parent directory of `path`. Used before
 * `FileLib.write` because that call doesn't create missing parents on its
 * own — silent write failures in CT otherwise look like "the export just
 * didn't happen." Swallows errors because some FileLib builds DO create
 * dirs, in which case we'd hit a benign already-exists case from the
 * second creator.
 */
export function ensureParentDirs(path: string): void {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        const p = Paths.get(String(path));
        const parent = p.getParent();
        if (parent !== null && !Files.exists(parent)) {
            Files.createDirectories(parent);
        }
    } catch (_e) {
        // best-effort; FileLib.write may also create dirs on some builds.
    }
}

export function encodeFilesystemComponent(
    value: string,
    options: { escapeDots?: boolean } = {}
): string {
    let out = "";
    for (let i = 0; i < value.length; i++) {
        const ch = value.charAt(i);
        const code = value.charCodeAt(i);
        const safe =
            (code >= 0x30 && code <= 0x39) ||
            (code >= 0x41 && code <= 0x5a) ||
            (code >= 0x61 && code <= 0x7a) ||
            ch === "-" ||
            ch === "_" ||
            (ch === "." && options.escapeDots !== true);

        if (safe) {
            out += ch;
        } else {
            // ES5 lib: no String.prototype.padStart in ChatTriggers.
            let hex = code.toString(16);
            while (hex.length < 4) hex = "0" + hex;
            out += "_" + hex;
        }
    }
    return out;
}
