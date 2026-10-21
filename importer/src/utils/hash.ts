import { cyrb53 } from "./helpers";

export function hashHex(input: string): string {
    return "0x" + cyrb53(input).toString(16);
}
