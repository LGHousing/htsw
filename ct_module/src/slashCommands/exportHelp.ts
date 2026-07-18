import { VERSION } from "htsw";

import { chatSeparator } from "../utils/helpers";
import { HOUSE_EXPORT_TYPES } from "../importables/houseExportTypes";

export function printExportHelp(): void {
    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &fExporter &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    ChatLib.chat("");

    for (let i = 0; i < HOUSE_EXPORT_TYPES.length; i++) {
        const spec = HOUSE_EXPORT_TYPES[i];
        if (spec.help.named === undefined) continue;
        ChatLib.chat(`&f/export ${spec.token} <name> [path]`);
        ChatLib.chat(`&7  ${spec.help.named}`);
    }
    ChatLib.chat("&f/export npc <name> <x> <y> <z> [path]");
    ChatLib.chat("&7  Reads an existing NPC by position and writes left/right .htsl + import.json metadata.");
    ChatLib.chat("&f/htsw export item [path]");
    ChatLib.chat("&7  Exports your held item and its click actions into the target project.");
    ChatLib.chat("&f/htsw export itemactions [path]");
    ChatLib.chat("&7  Backfills click actions for interactable items already declared in the target project.");

    for (let i = 0; i < HOUSE_EXPORT_TYPES.length; i++) {
        const spec = HOUSE_EXPORT_TYPES[i];
        ChatLib.chat(`&f/export all ${spec.token} [path]`);
        ChatLib.chat(`&7  ${spec.help.all}`);
    }
    ChatLib.chat("&f/export all npc [path]");
    ChatLib.chat("&7  Exports every NPC's supported code fields not already complete in the target path.");

    ChatLib.chat("&f/export resume function [path]");
    ChatLib.chat("&7  Exports only live functions missing from the target import.json/.htsl files.");

    const existing = HOUSE_EXPORT_TYPES.map((spec) => spec.label).join(", ");
    ChatLib.chat("&f/export existing [path]");
    ChatLib.chat(`&7  Re-exports every ${existing}, and NPC listed in the target import.json.`);

    ChatLib.chat("&f/export stop");
    ChatLib.chat("&7  Cancels any running export (or import) task.");
    ChatLib.chat('&7  Quote multi-word names: /export function "Button Blessing" my/path/');
    ChatLib.chat("&7  Default path: ./htsw/projects/<housingUuid>/");
    ChatLib.chat(`&7${chatSeparator()}`);
}
