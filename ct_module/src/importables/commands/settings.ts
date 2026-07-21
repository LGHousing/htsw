import type { CommandMode, ImportableCommand } from "htsw/types";

export type CommandSettings = {
    mode: CommandMode;
    requiredPriority: number;
    listed: boolean | null;
};

export function desiredCommandSettings(importable: ImportableCommand): {
    mode: CommandMode;
    requiredPriority: number;
    listed: boolean;
} {
    return {
        mode: importable.mode ?? "Self",
        requiredPriority: importable.requiredPriority ?? 0,
        listed: importable.listed ?? true,
    };
}

export function commandSettingsMatch(
    actual: CommandSettings,
    desired: ReturnType<typeof desiredCommandSettings>
): boolean {
    return (
        actual.mode === desired.mode &&
        actual.requiredPriority === desired.requiredPriority &&
        actual.listed === desired.listed
    );
}

export function commandCompareShape(command: ImportableCommand): ImportableCommand {
    const normalized = { ...command };
    if (normalized.mode === "Self") delete normalized.mode;
    if (normalized.requiredPriority === 0) delete normalized.requiredPriority;
    if (normalized.listed === true) delete normalized.listed;
    return normalized;
}
