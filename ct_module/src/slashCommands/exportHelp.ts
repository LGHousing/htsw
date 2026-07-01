import { VERSION } from "htsw";

import { chatSeparator } from "../utils/helpers";

export function printExportHelp(): void {
    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &fExporter &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/export function <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel function and writes a .htsl + import.json.");
    ChatLib.chat("&7  [path] may be a directory or a specific import.json.");
    ChatLib.chat("&f/export all function [path]");
    ChatLib.chat("&7  Exports every function not already complete in the target path.");
    ChatLib.chat("&f/export resume function [path]");
    ChatLib.chat("&7  Exports only live functions missing from the target import.json/.htsl files.");
    ChatLib.chat("&f/export all event [path]");
    ChatLib.chat("&7  Exports every event not already complete in the target path.");
    ChatLib.chat("&f/export all menu [path]");
    ChatLib.chat("&7  Exports every menu not already complete in the target path.");
    ChatLib.chat("&f/export all region [path]");
    ChatLib.chat("&7  Exports every region not already complete in the target path.");
    ChatLib.chat("&f/export all command [path]");
    ChatLib.chat("&7  Exports every custom command not already complete in the target path.");
    ChatLib.chat("&f/export all npc [path]");
    ChatLib.chat("&7  Exports every NPC's supported code fields not already complete in the target path.");
    ChatLib.chat("&f/export existing [path]");
    ChatLib.chat("&7  Re-exports every function, event, menu, region, command, and NPC listed in the target import.json.");
    ChatLib.chat("&f/export menu <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel menu and writes deduped item .snbt + per-slot .htsl + import.json.");
    ChatLib.chat("&f/export region <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel region and writes bounds + entry/exit .htsl + import.json.");
    ChatLib.chat("&f/export command <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel command and writes actions .htsl + import.json metadata.");
    ChatLib.chat("&f/export npc <name> <x> <y> <z> [path]");
    ChatLib.chat("&7  Reads an existing NPC by position and writes left/right .htsl + import.json metadata.");
    ChatLib.chat("&f/export stop");
    ChatLib.chat("&7  Cancels any running export (or import) task.");
    ChatLib.chat('&7  Quote multi-word names: /export function "Button Blessing" my/path/');
    ChatLib.chat("&7  Default path: ./htsw/projects/<housingUuid>/");
    ChatLib.chat(`&7${chatSeparator()}`);
}
