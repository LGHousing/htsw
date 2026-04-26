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
