import type { ActionHolder } from "../types";
import { generateHolder } from "./holders";

export function generate(holders: ActionHolder[]): string {
    const res: string[] = [];

    for (const holder of holders) {
        res.push(generateHolder(holder));
    }

    return res.join("\n\n");
}
