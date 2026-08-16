import { asEnum, defineRootDoc } from "../persistence/store";

export type OverwriteWarningMode = "always" | "trusted" | "off";

const mode = defineRootDoc<OverwriteWarningMode>({
    file: "overwrite-warning.json",
    // A regenerable preference, not user data: a corrupt file should fall back
    // to the safe "always" and stay writable, rather than latching the setting
    // where the user can no longer change it.
    onReadError: "defaults",
    fallback: "always",
    parse: asEnum(["always", "trusted", "off"] as const),
});

export function getOverwriteWarningMode(): OverwriteWarningMode {
    return mode.get();
}

export function setOverwriteWarningMode(value: OverwriteWarningMode): boolean {
    if (mode.get() === value) return true;
    return mode.set(value);
}

export function overwriteWarningsEnabled(
    value: OverwriteWarningMode,
    trustedImport: boolean
): boolean {
    return value === "always" || (value === "trusted" && trustedImport);
}
