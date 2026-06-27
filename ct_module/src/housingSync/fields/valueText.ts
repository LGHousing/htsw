import {
    DECIMAL_DISPLAY_VALUE_PATTERN,
    INTEGER_DISPLAY_VALUE_PATTERN,
} from "./loreParsing";

const HOUSING_VALUE_SCALE = 1e7;

export function quantizeHousingDecimal(num: number): number {
    if (Math.floor(num) === num) return num;
    return Math.round(num * HOUSING_VALUE_SCALE) / HOUSING_VALUE_SCALE;
}

export function normalizeValueTextForCompare(value: string): string {
    const isIntegerDisplay = INTEGER_DISPLAY_VALUE_PATTERN.test(value);
    const isDecimalDisplay = DECIMAL_DISPLAY_VALUE_PATTERN.test(value);
    if (!isIntegerDisplay && !isDecimalDisplay) return value;

    const withoutCommas = value.replace(/,/g, "");
    const negative = withoutCommas.charAt(0) === "-";
    const unsigned = negative ? withoutCommas.substring(1) : withoutCommas;
    const dot = unsigned.indexOf(".");
    const wholeRaw = dot === -1 ? unsigned : unsigned.substring(0, dot);

    let whole = wholeRaw.replace(/^0+/, "");
    if (whole === "") whole = "0";

    if (isIntegerDisplay) {
        if (whole === "0") return "0";
        return `${negative ? "-" : ""}${whole}`;
    }

    const numericValue = Number(withoutCommas);
    if (!Number.isFinite(numericValue)) return value;

    const normalized = quantizeHousingDecimal(numericValue);
    if (Object.is(normalized, -0) || normalized === 0) return "0.0";

    const formatted = String(normalized);
    return formatted.indexOf(".") === -1 ? `${formatted}.0` : formatted;
}
