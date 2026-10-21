import type { ImportableFunction } from "htsw/types";

import { functionIconsEqual } from "./iconComparison";

type FunctionInfrastructureKey = "type" | "name" | "actions" | "sourcePath";

type FunctionSettingKey = Exclude<
    keyof ImportableFunction,
    FunctionInfrastructureKey
>;

export type FunctionSettings = Pick<ImportableFunction, FunctionSettingKey>;

export type ObservedFunctionSettings = {
    [K in FunctionSettingKey]-?: FunctionSettings[K];
};

type FunctionSettingChangeOf<K extends FunctionSettingKey> = {
    key: K;
    current: FunctionSettings[K];
    desired: FunctionSettings[K];
};

export type FunctionSettingChange = {
    [K in FunctionSettingKey]: FunctionSettingChangeOf<K>;
}[FunctionSettingKey];

type FunctionSettingHandler<K extends FunctionSettingKey> = {
    change: (
        current: ObservedFunctionSettings,
        desired: ImportableFunction
    ) => FunctionSettingChangeOf<K> | null;
    writeExportValue(
        observed: ObservedFunctionSettings,
        target: FunctionSettings
    ): void;
};

const FUNCTION_SETTING_HANDLERS: {
    [K in FunctionSettingKey]: FunctionSettingHandler<K>;
} = {
    description: {
        change: (current, desired) => {
            if (
                desired.description === undefined ||
                functionDescriptionsEqual(current.description, desired.description)
            ) {
                return null;
            }
            return {
                key: "description",
                current: current.description,
                desired: desired.description,
            };
        },
        writeExportValue: (observed, target) => {
            if (observed.description !== undefined) {
                target.description = observed.description;
            }
        },
    },
    repeatTicks: {
        change: (current, desired) => {
            const currentValue = current.repeatTicks ?? 0;
            const desiredValue = desired.repeatTicks ?? 0;
            return currentValue === desiredValue
                ? null
                : {
                      key: "repeatTicks",
                      current: currentValue,
                      desired: desiredValue,
                  };
        },
        writeExportValue: (observed, target) => {
            if (observed.repeatTicks !== 0) {
                target.repeatTicks = observed.repeatTicks;
            }
        },
    },
    icon: {
        change: (current, desired) => {
            if (
                desired.icon === undefined ||
                functionIconsEqual(current.icon, desired.icon)
            ) {
                return null;
            }
            return { key: "icon", current: current.icon, desired: desired.icon };
        },
        writeExportValue: (observed, target) => {
            if (observed.icon !== undefined) target.icon = observed.icon;
        },
    },
};

function functionSettingKeys(): FunctionSettingKey[] {
    return Object.keys(FUNCTION_SETTING_HANDLERS) as FunctionSettingKey[];
}

function functionDescriptionsEqual(
    current: string | undefined,
    desired: string
): boolean {
    if (desired === "") return current === undefined;
    if (current === desired) return true;

    const visibleDesired = desired.replace(/&[0-9a-fk-or]/gi, "").trim();
    return !/[,.!?]$/.test(visibleDesired) && current === `${desired}.`;
}

export function planFunctionSettingChanges(
    current: ObservedFunctionSettings,
    desired: ImportableFunction
): FunctionSettingChange[] {
    const changes: FunctionSettingChange[] = [];
    for (const key of functionSettingKeys()) {
        const change = FUNCTION_SETTING_HANDLERS[key].change(current, desired);
        if (change !== null) changes.push(change);
    }
    return changes;
}

export function functionSettingsMatchDesired(
    current: FunctionSettings,
    desired: ImportableFunction
): boolean {
    return planFunctionSettingChanges(observedFunctionSettingsOf(current), desired).length === 0;
}

export function functionSettingsForExport(
    observed: ObservedFunctionSettings
): FunctionSettings {
    const settings: FunctionSettings = {};
    for (const key of functionSettingKeys()) {
        FUNCTION_SETTING_HANDLERS[key].writeExportValue(observed, settings);
    }
    return settings;
}

function observedFunctionSettingsOf(
    settings: FunctionSettings
): ObservedFunctionSettings {
    return {
        description: settings.description,
        repeatTicks: settings.repeatTicks,
        icon: settings.icon,
    };
}
