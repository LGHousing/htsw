/// <reference types="../../CTAutocomplete" />

import { ensureParentDirs } from "../utils/filesystem";
import { queueSourcePath } from "./left-panel/importables/source";
import { setImportJsonPath } from "./state";
import { addRecent } from "./persistence/recents";
import { scheduleReparse } from "./parsing/reparse";
import { showToast } from "./toast";

/**
 * A tiny but complete import.json project, written on demand from the
 * Importables empty state. One of each importable section with comments, so
 * a new user can read the structure instead of the docs. Existing files are
 * never overwritten — re-clicking just opens the project.
 */

const STARTER_DIR = "./htsw/imports/starter";

const STARTER_FILES: { [name: string]: string } = {
    "import.json": `{
    "functions": [
        {
            "name": "Starter Hello",
            "actions": "hello.htsl",
            "icon": { "item": "minecraft:map" }
        }
    ],
    "events": [
        { "event": "Player Join", "actions": "join.htsl" }
    ],
    "regions": [
        { "name": "Starter Region", "onEnterActions": "region_enter.htsl" }
    ],
    "items": [
        {
            "name": "Starter Wand",
            "nbt": "starter_wand.snbt",
            "rightClickActions": "wand_use.htsl"
        }
    ]
}
`,
    "hello.htsl": `// An .htsl file is a list of actions, run top to bottom.
// This one belongs to the "Starter Hello" function in import.json.
chat "Hello from HTSW!"

// Player variables persist between runs.
var starter/runs += 1
if and (var starter/runs >= 5) {
    chat "You've run this %var.player/starter/runs% times."
}
`,
    "join.htsl": `// Runs when a player joins — see "events" in import.json.
chat "Welcome to the starter house!"
`,
    "region_enter.htsl": `// Runs when a player walks into Starter Region.
// Set the region's bounds in-game after importing.
chat "You entered the starter region."
`,
    "wand_use.htsl": `// Right-clicking the Starter Wand runs this list —
// declared via "rightClickActions" on the item in import.json.
chat "You used the starter wand!"
`,
    "starter_wand.snbt": `{
    id: "minecraft:blaze_rod",
    Count: 1b,
    tag: {
        display: {
            Name: "§6Starter Wand",
            Lore: [
                "§7Item NBT lives in .snbt files.",
                "§7Right-click runs wand_use.htsl"
            ]
        }
    }
}
`,
};

export function createStarterProject(): void {
    const importJsonPath = `${STARTER_DIR}/import.json`;
    if (FileLib.exists(importJsonPath)) {
        showToast("Starter project already exists — opening it", 0xffe5bc4b);
    } else {
        try {
            for (const name in STARTER_FILES) {
                const p = `${STARTER_DIR}/${name}`;
                ensureParentDirs(p);
                FileLib.write(p, STARTER_FILES[name], true);
            }
        } catch (err) {
            showToast(`Couldn't create starter project: ${err}`, 0xffe85c5c, 8000);
            return;
        }
        showToast(`Created starter project in ${STARTER_DIR}`, 0xff5cb85c);
    }
    queueSourcePath(importJsonPath);
    setImportJsonPath(importJsonPath);
    addRecent(importJsonPath);
    scheduleReparse();
}
