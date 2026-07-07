import type { Importable } from "htsw/types";

import type { ReadFn } from "./read";
import { readFunctions } from "./functions/readHouseFunctions";
import { readEvents } from "./events/readHouseEvents";
import { readCommands } from "./commands/readHouseCommands";
import { readMenus } from "./menus/readHouseMenus";
import { readRegions } from "./regions/readHouseRegions";
import { readTeams } from "./teams/readHouseTeams";
import { readGroups } from "./groups/readHouseGroups";
import { readNpcs } from "./npcs/readHouseNpcs";

// Single source of truth for which importable types can be read back out of a
// live house through the shared name-keyed reader path (export + deep-read).
// Total over Importable["type"] via `satisfies`, so adding a new importable type
// is a compile error here until it declares a reader or opts out with `null`.
// The Houses tabs, the deep-read test, and the coverage report all derive from
// this instead of keeping their own parallel lists that can silently drop a type.
//
// ITEM opts out (null): it has no house presence of its own — an item exists
// only where an action or menu references it, so there's nothing to enumerate or
// read back. NPC's reader is position-keyed (readNpcs adapts positions onto the
// NPC export flow) but still fits this path. Order is the Houses tab order.
export const HOUSE_READERS = {
    FUNCTION: readFunctions,
    MENU: readMenus,
    REGION: readRegions,
    COMMAND: readCommands,
    EVENT: readEvents,
    TEAM: readTeams,
    GROUP: readGroups,
    NPC: readNpcs,
    ITEM: null,
} satisfies Record<Importable["type"], ReadFn | null>;

// The importable types with a name-keyed house reader (the non-null entries
// above), derived so it can't drift from HOUSE_READERS.
export type HouseReadableType = {
    [K in keyof typeof HOUSE_READERS]: (typeof HOUSE_READERS)[K] extends null ? never : K;
}[keyof typeof HOUSE_READERS];

// Every importable type, enumerated from the total reader map — used as the
// coverage-report denominator (every importable type is importable).
export const ALL_IMPORTABLE_TYPES = Object.keys(HOUSE_READERS) as Importable["type"][];

// The house-readable subset in tab/display order — the deep-read test's walk.
export const HOUSE_READABLE_TYPES = ALL_IMPORTABLE_TYPES.filter(
    (type) => HOUSE_READERS[type] !== null
) as HouseReadableType[];
