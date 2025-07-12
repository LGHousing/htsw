import type { ActionHolder } from "housing-common";
import { generateHolder } from "./holders";

export function generate(holders: ActionHolder[]): string {
    const res: string[] = [];

    for (const holder of holders) {
        res.push(generateHolder(holder));
    }

    return res.join("\n\n");
}