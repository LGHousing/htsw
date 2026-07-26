import {
    getOverwriteWarningMode,
    setOverwriteWarningMode,
    type OverwriteWarningMode,
} from "../importables/overwriteWarning";

export function parseWarnModeArgument(
    args: readonly string[]
): OverwriteWarningMode | null | undefined {
    if (args.length === 0) return undefined;
    if (args.length !== 1) return null;
    const mode = args[0].toLowerCase();
    if (mode === "always" || mode === "trusted" || mode === "off") {
        return mode;
    }
    return null;
}

export function commandWarnMode(args: string[]): void {
    const mode = parseWarnModeArgument(args);
    if (mode === undefined) {
        ChatLib.chat(`[htsw] Overwrite warning: ${getOverwriteWarningMode()}`);
        return;
    }
    if (mode === null) {
        ChatLib.chat(
            "[htsw] Overwrite warning change failed: expected always, trusted, or off"
        );
        return;
    }
    if (!setOverwriteWarningMode(mode)) {
        ChatLib.chat("[htsw] Overwrite warning change failed: could not save setting");
        return;
    }
    ChatLib.chat(`[htsw] Overwrite warning set to ${mode}`);
}
