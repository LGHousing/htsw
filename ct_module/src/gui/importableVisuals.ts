import type {
    Color,
    FunctionIcon,
    Importable,
    ImportableEvent,
} from "htsw/types";

import type { Element, Style } from "./lib/layout";
import { Icon, McItem } from "./lib/components";
import { Icons, type IconName } from "./lib/icons.generated";

const IMPORTABLE_TYPE_VISUALS: {
    [K in Importable["type"]]: { icon: IconName; color: number };
} = {
    FUNCTION: { icon: Icons.squareFunction, color: 0xff67a7e8 | 0 },
    EVENT: { icon: Icons.zap, color: 0xffce7be0 | 0 },
    REGION: { icon: Icons.cuboid, color: 0xff5cb85c | 0 },
    ITEM: { icon: Icons.package, color: 0xffe5bc4b | 0 },
    MENU: { icon: Icons.squareMenu, color: 0xffe87a4b | 0 },
    NPC: { icon: Icons.user, color: 0xff6fd38f | 0 },
    TEAM: { icon: Icons.users, color: 0xff4aa3a8 | 0 },
    GROUP: { icon: Icons.shield, color: 0xffb695e8 | 0 },
    COMMAND: { icon: Icons.command, color: 0xffe8e06a | 0 },
};

const DEFAULT_FUNCTION_ICON_ITEM = "minecraft:map";

export const IMPORTABLE_TYPE_COLORS: { [K in Importable["type"]]: number } = {
    FUNCTION: IMPORTABLE_TYPE_VISUALS.FUNCTION.color,
    EVENT: IMPORTABLE_TYPE_VISUALS.EVENT.color,
    REGION: IMPORTABLE_TYPE_VISUALS.REGION.color,
    ITEM: IMPORTABLE_TYPE_VISUALS.ITEM.color,
    MENU: IMPORTABLE_TYPE_VISUALS.MENU.color,
    NPC: IMPORTABLE_TYPE_VISUALS.NPC.color,
    TEAM: IMPORTABLE_TYPE_VISUALS.TEAM.color,
    GROUP: IMPORTABLE_TYPE_VISUALS.GROUP.color,
    COMMAND: IMPORTABLE_TYPE_VISUALS.COMMAND.color,
};

const EVENT_ICON_ITEMS: { [K in ImportableEvent["event"]]: string } = {
    "Player Join": "minecraft:wooden_door",
    "Player Quit": "minecraft:dark_oak_door",
    "Player Death": "minecraft:bone",
    "Player Kill": "minecraft:diamond_sword",
    "Player Respawn": "minecraft:apple",
    "Group Change": "minecraft:paper",
    "PvP State Change": "minecraft:iron_sword",
    "Fish Caught": "minecraft:fishing_rod",
    "Player Enter Portal": "minecraft:obsidian",
    "Player Damage": "minecraft:lava_bucket",
    "Player Block Break": "minecraft:grass",
    "Start Parkour": "minecraft:light_weighted_pressure_plate",
    "Complete Parkour": "minecraft:light_weighted_pressure_plate",
    "Player Drop Item": "minecraft:dropper",
    "Player Pick Up Item": "minecraft:hopper",
    "Player Change Held Item": "minecraft:book",
    "Player Toggle Sneak": "minecraft:hay_block",
    "Player Toggle Flight": "minecraft:feather",
};
const EVENT_ICON_ITEMS_BY_NAME: { [event: string]: string | undefined } = EVENT_ICON_ITEMS;

const TEAM_GROUP_COLORS: { [K in Color]: number } = {
    "Dark Blue": 0xff0000aa | 0,
    "Dark Green": 0xff00aa00 | 0,
    "Dark Aqua": 0xff00aaaa | 0,
    "Dark Red": 0xffaa0000 | 0,
    "Dark Purple": 0xffaa00aa | 0,
    Gold: 0xffffaa00 | 0,
    Gray: 0xffaaaaaa | 0,
    "Dark Gray": 0xff555555 | 0,
    Blue: 0xff5555ff | 0,
    Green: 0xff55ff55 | 0,
    Aqua: 0xff55ffff | 0,
    Red: 0xffff5555 | 0,
    "Light Purple": 0xffff55ff | 0,
    Yellow: 0xffffff55 | 0,
};

function itemVisual(importable: Importable): { item: string; metadata?: number } | null {
    if (importable.type !== "ITEM" || importable.nbt.type !== "compound") return null;
    const fields = importable.nbt.value as Record<
        string,
        { type: string; value: unknown } | undefined
    >;
    const id = fields.id;
    if (id?.type !== "string" || typeof id.value !== "string") return null;
    const damage = fields.Damage;
    return {
        item: id.value,
        metadata: typeof damage?.value === "number" ? damage.value : undefined,
    };
}

export function ImportableIcon(props: {
    type: Importable["type"];
    name: string;
    importable?: Importable | null;
    functionIcon?: FunctionIcon;
    color?: Color;
    style?: Style;
}): Element | false {
    const functionIcon =
        props.functionIcon ??
        (props.importable?.type === "FUNCTION" ? props.importable.icon : undefined);
    if (props.type === "FUNCTION") {
        return McItem({
            item: functionIcon?.item ?? DEFAULT_FUNCTION_ICON_ITEM,
            count: functionIcon?.count ?? 1,
            style: props.style,
        });
    }

    if (props.type === "ITEM" && props.importable !== undefined && props.importable !== null) {
        const visual = itemVisual(props.importable);
        return visual === null
            ? false
            : McItem({ item: visual.item, metadata: visual.metadata, style: props.style });
    }

    if (props.type === "EVENT") {
        const event =
            props.importable?.type === "EVENT" ? props.importable.event : props.name;
        const item = EVENT_ICON_ITEMS_BY_NAME[event];
        return item === undefined ? false : McItem({ item, style: props.style });
    }

    if (props.type === "TEAM" || props.type === "GROUP") {
        const color =
            props.color ??
            (props.importable?.type === "TEAM" || props.importable?.type === "GROUP"
                ? props.importable.color
                : undefined) ??
            "Gray";
        return Icon({ name: Icons.skull, color: TEAM_GROUP_COLORS[color], style: props.style });
    }

    return false;
}
