import type { Importable } from "htsw/types";

import type { ReadFn } from "./reader";
import { readFunctions } from "../functions/readHouseFunctions";
import { readEvents } from "../events/readHouseEvents";
import { readCommands } from "../commands/readHouseCommands";
import { readMenus } from "../menus/readHouseMenus";
import { readRegions } from "../regions/readHouseRegions";
import { readTeams } from "../teams/readHouseTeams";
import { readGroups } from "../groups/readHouseGroups";
import { readNpcs } from "../npcs/readHouseNpcs";
import { readItems } from "../items/readHouseItems";

// Single source of truth for which importable types can be read back out of a
// live house through the shared name-keyed reader path (export + deep-read).
// Total over Importable["type"] via `satisfies`, so adding a new importable type
// is a compile error here until it declares a reader.
// The Houses tabs, the deep-read test, and the coverage report all derive from
// this instead of keeping their own parallel lists that can silently drop a type.
//
// ITEM matches declared project NBT to live inventory stacks; Housing has no
// name-keyed item list. Missing or ambiguous copies fail the read.
// NPC's reader is position-keyed (readNpcs adapts positions onto the
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
    ITEM: readItems,
} satisfies Record<Importable["type"], ReadFn>;

export type HouseReadableType = keyof typeof HOUSE_READERS;

// Every importable type, enumerated from the total reader map — used as the
// coverage-report denominator (every importable type is importable).
export const ALL_IMPORTABLE_TYPES = Object.keys(HOUSE_READERS) as Importable["type"][];

// All types now have a reader. ITEM reads known project names from inventory
// rather than enumerating a Housing list.
export const HOUSE_READABLE_TYPES = ALL_IMPORTABLE_TYPES.slice();
