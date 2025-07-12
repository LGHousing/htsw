import type { ActionHolder } from "housing-common";
import { generateAction } from "./actions";

const HINT = "/* ? */";

export function generateHolder(holder: ActionHolder): string {
    const res: string[] = [];

    if (holder.type === "FUNCTION") {
        res.push(`goto function "${holder.name ?? HINT}"`);
        res.push("");
    } else if (holder.type === "EVENT") {
        res.push(`goto event "${holder.event ?? HINT}"`);
        res.push("");
    }

    for (const action of holder.actions ?? []) {
        res.push(generateAction(action));
    }

    return res.join("\n");
}