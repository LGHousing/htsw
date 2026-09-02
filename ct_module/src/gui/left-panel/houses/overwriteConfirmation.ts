export type OverwriteConfirmation = {
    title: string;
    lines: string[];
};

export function buildOverwriteConfirmation(
    noun: string,
    existingNames: readonly string[] | null
): OverwriteConfirmation | null {
    if (existingNames !== null && existingNames.length === 0) return null;
    if (existingNames === null) {
        return {
            title: "Overwrite local files?",
            lines: [
                "HTSW couldn't verify which entries already exist in the destination.",
                "Export may replace local versions with the house versions.",
            ],
        };
    }
    const shown = existingNames.slice(0, 5);
    const lines = shown.map((name) => `• ${name}`);
    if (existingNames.length > shown.length) {
        lines.push(`…and ${existingNames.length - shown.length} more`);
    }
    lines.push("Export replaces the local versions with the house versions.");
    return {
        title: `Overwrite existing ${noun} (${existingNames.length})?`,
        lines,
    };
}
