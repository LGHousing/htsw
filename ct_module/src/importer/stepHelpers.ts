import type { Step } from "./step";

const NO_KEY = "__no_key__";

export function stepClickSlot(slot: number): Step {
    return { type: "CLICK_SLOT", slot };
}

export function stepSelectValue(value: string): Step {
    return { type: "SELECT_VALUE", key: NO_KEY, value };
}

export function stepsClickSlotThenSelect(slot: number, value: string): Step[] {
    return [stepClickSlot(slot), stepSelectValue(value)];
}

export function stepsToggle(slot: number, value: boolean | undefined, defaultValue: boolean): Step[] {
    if (value === undefined || value === defaultValue) return [];
    return [stepClickSlot(slot)];
}

export function stepsString(slot: number, value: string | undefined, defaultValue?: string): Step[] {
    if (value === undefined) return [];
    if (defaultValue !== undefined && value === defaultValue) return [];
    return stepsClickSlotThenSelect(slot, value);
}

export function stepsNumber(slot: number, value: number | string | undefined, defaultValue?: number | string): Step[] {
    if (value === undefined) return [];
    const valueStr = value.toString();
    if (defaultValue !== undefined && valueStr === defaultValue.toString()) return [];
    return stepsClickSlotThenSelect(slot, valueStr);
}
