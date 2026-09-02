/** `all` is null before the first scan: the bulk row lists names at run time. */
export type HouseQueueCounts = {
    all: number | null;
    changed: number;
    unread: number;
    shown: number;
    new: number;
};

export type HouseQueueMenuActionId =
    | "read-all"
    | "read-unread"
    | "read-shown"
    | "export-all"
    | "export-new"
    | "export-changed"
    | "export-shown"
    | "export-house";

export type HouseQueueMenuEntry =
    | { kind: "separator" }
    | {
          kind: "action";
          id: HouseQueueMenuActionId;
          label: string;
          disabled: boolean;
      };

function action(
    id: HouseQueueMenuActionId,
    label: string,
    count: number | null,
    destinationReady: boolean
): HouseQueueMenuEntry {
    return {
        kind: "action",
        id,
        label: `${label} (${count === null ? "?" : count})`,
        disabled: !destinationReady || count === 0,
    };
}

export function buildHouseQueueMenu(
    pluralLabel: string,
    counts: HouseQueueCounts,
    destinationReady: boolean
): HouseQueueMenuEntry[] {
    const noun = pluralLabel.toLowerCase();
    return [
        action("read-all", `Read all ${noun}`, counts.all, destinationReady),
        action("read-unread", "Read unread", counts.unread, destinationReady),
        action("read-shown", "Read shown", counts.shown, destinationReady),
        { kind: "separator" },
        action("export-all", `Export all ${noun}`, counts.all, destinationReady),
        action("export-new", "Export new", counts.new, destinationReady),
        action("export-changed", "Export changed", counts.changed, destinationReady),
        action("export-shown", "Export shown", counts.shown, destinationReady),
        { kind: "separator" },
        {
            kind: "action",
            id: "export-house",
            label: "Export whole house",
            disabled: !destinationReady,
        },
    ];
}

export function queueNamesForRow(
    selectedNames: readonly string[],
    rowName: string
): string[] {
    return selectedNames.length > 0 ? selectedNames.slice() : [rowName];
}

export function declaredOverwriteNames(
    candidateNames: readonly string[],
    declaredNames: ReadonlySet<string> | null
): string[] | null {
    if (declaredNames === null) return null;
    return candidateNames.filter((name) => declaredNames.has(name));
}
