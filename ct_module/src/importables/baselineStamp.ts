import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export type PackageBaselineStamp = {
    exportedAt: string;
    houseId: string;
};

export function readPackageBaselineStamp(
    importJsonPath: string
): PackageBaselineStamp | null {
    try {
        const parsed = parse(FileLib.read(importJsonPath)) as {
            baseline?: { exportedAt?: unknown; houseId?: unknown };
        };
        const baseline = parsed.baseline;
        return baseline !== undefined &&
            typeof baseline.exportedAt === "string" &&
            typeof baseline.houseId === "string"
            ? { exportedAt: baseline.exportedAt, houseId: baseline.houseId }
            : null;
    } catch (_error) {
        return null;
    }
}

export function packageBaselineAgeDays(
    stamp: PackageBaselineStamp | null,
    now = Date.now()
): number | undefined {
    if (stamp === null) return undefined;
    const exportedAt = Date.parse(stamp.exportedAt);
    if (!Number.isFinite(exportedAt)) return undefined;
    const elapsed = now - exportedAt;
    return elapsed > 24 * 60 * 60 * 1000
        ? Math.floor(elapsed / (24 * 60 * 60 * 1000))
        : undefined;
}

export function stampPackageBaseline(
    importJsonPath: string,
    houseId: string,
    exportedAt = new Date().toISOString()
): boolean {
    try {
        const source = FileLib.read(importJsonPath);
        const errors: ParseError[] = [];
        parse(source, errors);
        if (errors.length > 0) return false;
        const content = applyEdits(
            source,
            modify(
                source,
                ["baseline"],
                { exportedAt, houseId },
                { formattingOptions: { insertSpaces: true, tabSize: 4, eol: "\n" } }
            )
        );
        FileLib.write(importJsonPath, content, true);
        return FileLib.read(importJsonPath) === content;
    } catch (_error) {
        return false;
    }
}
