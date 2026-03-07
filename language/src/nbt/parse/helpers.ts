import Long from "long";

export function longToPair(value: Long): [number, number] {
    return [value.high, value.low];
}
