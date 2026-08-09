import { isSafeProjectName, joinPath, parentDir, type ProjectFs } from "./fs";

export const STARTER_PROJECT_NAME = "starter";

export const STARTER_FILES: { [name: string]: string } = {
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
    "commands": [
        {
            "name": "starter",
            "actions": "starter_command.htsl"
        }
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
    "starter_command.htsl": `// Runs when a player uses /starter.
chat "You ran the starter command!"
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

export type CreateProjectResult = {
    importJsonPath: string;
    created: boolean;
    writtenFiles: string[];
};

export function createStarterProjectFiles(
    fs: ProjectFs,
    projectsRoot: string
): CreateProjectResult {
    const projectDir = joinPath(projectsRoot, STARTER_PROJECT_NAME);
    const importJsonPath = joinPath(projectDir, "import.json");
    const writtenFiles: string[] = [];

    if (!fs.exists(importJsonPath)) {
        for (const name in STARTER_FILES) {
            const path = joinPath(projectDir, name);
            fs.ensureDir(parentDir(path));
            fs.writeFile(path, STARTER_FILES[name]);
            writtenFiles.push(path);
        }
    }

    return {
        importJsonPath,
        created: writtenFiles.length > 0,
        writtenFiles,
    };
}

export function createEmptyProjectFiles(
    fs: ProjectFs,
    projectsRoot: string,
    name: string
): CreateProjectResult {
    const trimmed = name.trim();
    if (!isSafeProjectName(trimmed)) {
        throw new Error("Invalid project name: no slashes or '..'.");
    }

    const projectDir = joinPath(projectsRoot, trimmed);
    const importJsonPath = joinPath(projectDir, "import.json");
    const writtenFiles: string[] = [];

    fs.ensureDir(projectDir);
    if (!fs.exists(importJsonPath)) {
        fs.writeFile(importJsonPath, "{\n}\n");
        writtenFiles.push(importJsonPath);
    }

    return {
        importJsonPath,
        created: writtenFiles.length > 0,
        writtenFiles,
    };
}
