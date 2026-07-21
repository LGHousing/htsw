import type { Action, Condition } from "htsw/types";

export type CanonicalizeItemName = (name: string) => string;

export type ResolveItemField = (
    owner: Action | Condition,
    itemName: string,
    kind: "action" | "condition"
) => Promise<Item>;
