export type BulkQueueConfirmation = {
    title: string;
    lines: string[];
    confirmLabel: string;
    danger: boolean;
};

export function bulkQueueConfirmation(
    operation: "read" | "export",
    pluralLabel: string,
    destinationPath: string
): BulkQueueConfirmation {
    const titleVerb = operation === "read" ? "Read" : "Export";
    const actionVerb = operation === "read" ? "read" : "export";
    const lines = [
        `HTSW will refresh current-house names before bulk ${pluralLabel.toLowerCase()} work starts.`,
        `This includes all ${pluralLabel.toLowerCase()}, regardless of search or filters.`,
    ];
    if (operation === "export") {
        lines.push(`Housing versions can replace local versions in ${destinationPath}.`);
    } else {
        lines.push("Read updates Housing knowledge; it does not write project files.");
    }
    return {
        title: `Queue ${titleVerb} All ${pluralLabel}?`,
        lines,
        confirmLabel: `Queue ${actionVerb} all`,
        danger: operation === "export",
    };
}
