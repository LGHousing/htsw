import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ActionTypeDef = {
    alias: string;
    type: string;
    displayName: string;
    fields: Array<{ name: string; typeText: string }>;
};

type ExistingLoreField = {
    label: string;
    prop: string;
    kind: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const actionsPath = path.resolve(repoRoot, "../language/src/types/actions.ts");
const constantsPath = path.resolve(repoRoot, "../language/src/types/constants.ts");
const actionMappingsPath = path.resolve(
    repoRoot,
    "src/importer/actionMappings.ts",
);
const outputPath = path.resolve(
    repoRoot,
    "src/importer/actionMappings.generated.ts",
);

const ACTION_TYPE_ORDER = [
    "CONDITIONAL",
    "SET_GROUP",
    "KILL",
    "HEAL",
    "TITLE",
    "ACTION_BAR",
    "RESET_INVENTORY",
    "CHANGE_MAX_HEALTH",
    "PARKOUR_CHECKPOINT",
    "GIVE_ITEM",
    "REMOVE_ITEM",
    "MESSAGE",
    "APPLY_POTION_EFFECT",
    "CLEAR_POTION_EFFECTS",
    "GIVE_EXPERIENCE_LEVELS",
    "SEND_TO_LOBBY",
    "CHANGE_VAR",
    "TELEPORT",
    "FAIL_PARKOUR",
    "PLAY_SOUND",
    "SET_COMPASS_TARGET",
    "SET_GAMEMODE",
    "CHANGE_HEALTH",
    "CHANGE_HUNGER",
    "RANDOM",
    "FUNCTION",
    "APPLY_INVENTORY_LAYOUT",
    "ENCHANT_HELD_ITEM",
    "PAUSE",
    "SET_TEAM",
    "SET_MENU",
    "CLOSE_MENU",
    "DROP_ITEM",
    "SET_VELOCITY",
    "LAUNCH",
    "SET_PLAYER_WEATHER",
    "SET_PLAYER_TIME",
    "TOGGLE_NAMETAG_DISPLAY",
    "USE_HELD_ITEM",
    "EXIT",
    "CANCEL_EVENT",
] as const;

const ACTION_TYPE_ORDER_INDEX = new Map<string, number>(
    ACTION_TYPE_ORDER.map((type, index) => [type, index]),
);

const DEFAULT_ACTION_LORE_FIELD_LABELS: Record<string, Record<string, string>> = {
    DROP_ITEM: {
        itemName: "Item",
        location: "Location",
        dropNaturally: "Drop Naturally",
        disableMerging: "Prevent Item Merging",
        despawnDurationTicks: "Despawn Duration Ticks",
        pickupDelayTicks: "Pickup Delay Ticks",
        prioritizePlayer: "Prioritize Player",
        inventoryFallback: "Fallback To Inventory",
    },
    SET_PLAYER_WEATHER: {
        weather: "Weather",
    },
    SET_PLAYER_TIME: {
        time: "Time",
    },
    TOGGLE_NAMETAG_DISPLAY: {
        displayNametag: "Display Nametag",
    },
};

function guessKind(fieldName: string, typeText: string): string {
    const normalized = typeText.replace(/\s+/g, " ").trim();

    if (
        fieldName === "conditions" ||
        fieldName === "ifActions" ||
        fieldName === "elseActions" ||
        fieldName === "actions" ||
        normalized.includes("Condition[]") ||
        normalized.includes("Action[]")
    ) {
        return "nestedList";
    }

    if (fieldName === "layout") return "select";
    if (fieldName === "weather") return "select";
    if (fieldName === "time") return "cycle";
    if (fieldName === "itemName") return "item";
    if (normalized === "string") return "value";
    if (normalized === "boolean") return "boolean";
    if (normalized === "number") return "value";

    if (
        [
            "Enchantment",
            "Gamemode",
            "InventorySlot",
            "Lobby",
            "Location",
            "Operation",
            "PotionEffect",
            "Sound",
            "VarHolder",
            "VarOperation",
        ].some((name) => normalized.includes(name))
    ) {
        return "select";
    }

    if (normalized.includes("Value") || normalized.includes("VarName")) {
        return "value";
    }

    return "value";
}

function parseActionNames(source: string): Record<string, string> {
    const names: Record<string, string> = {};
    const block = source.match(/export const ACTION_NAMES:[\s\S]*?= \{([\s\S]*?)\n\};/)?.[1];
    if (!block) {
        return names;
    }

    for (const match of block.matchAll(/^\s*([A-Z_]+):\s*"([^"]+)",?$/gm)) {
        const [, type, displayName] = match;
        names[type] = displayName;
    }

    return names;
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = openBraceIndex; i < source.length; i++) {
        const char = source[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }

        if (char === "{") {
            depth++;
        } else if (char === "}") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function parseExistingActionMappingEntries(
    source: string,
): Record<string, string> {
    const entries: Record<string, string> = {};
    const entryRegex = /^\s*([A-Z_]+):\s*\{/gm;

    for (const match of source.matchAll(entryRegex)) {
        const [raw, type] = match;
        const openBraceIndex = (match.index ?? 0) + raw.lastIndexOf("{");
        const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
        if (closeBraceIndex === -1) {
            continue;
        }

        entries[type] = source.slice(openBraceIndex + 1, closeBraceIndex);
    }

    return entries;
}

function parseExistingActionMappingDisplayNames(
    source: string,
): Record<string, string> {
    const names: Record<string, string> = {};
    const entries = parseExistingActionMappingEntries(source);

    for (const type in entries) {
        const displayName = entries[type].match(/displayName:\s*"([^"]+)"/)?.[1];
        if (displayName) {
            names[type] = displayName;
        }
    }

    return names;
}

function parseExistingActionMappingLoreFields(
    source: string,
): Record<string, Record<string, ExistingLoreField>> {
    const mappings: Record<string, Record<string, ExistingLoreField>> = {};
    const entries = parseExistingActionMappingEntries(source);

    for (const type in entries) {
        const body = entries[type];
        const loreFieldsMatch = body.match(/loreFields:\s*\{/);
        if (!loreFieldsMatch || loreFieldsMatch.index === undefined) {
            continue;
        }

        const openBraceIndex =
            loreFieldsMatch.index + loreFieldsMatch[0].lastIndexOf("{");
        const closeBraceIndex = findMatchingBrace(body, openBraceIndex);
        if (closeBraceIndex === -1) {
            continue;
        }

        const loreFieldsBlock = body.slice(openBraceIndex + 1, closeBraceIndex);
        const fields: Record<string, ExistingLoreField> = {};
        const fieldRegex = /^\s*("[^"]+"|[A-Za-z][A-Za-z0-9 ]*):\s*\{/gm;
        for (const fieldMatch of loreFieldsBlock.matchAll(fieldRegex)) {
            const [raw, rawLabel] = fieldMatch;
            const fieldOpenBraceIndex =
                (fieldMatch.index ?? 0) + raw.lastIndexOf("{");
            const fieldCloseBraceIndex = findMatchingBrace(
                loreFieldsBlock,
                fieldOpenBraceIndex,
            );
            if (fieldCloseBraceIndex === -1) {
                continue;
            }

            const fieldBody = loreFieldsBlock.slice(
                fieldOpenBraceIndex + 1,
                fieldCloseBraceIndex,
            );
            const prop = fieldBody.match(/prop:\s*"([^"]+)"/)?.[1];
            const kind = fieldBody.match(/kind:\s*"([^"]+)"/)?.[1];
            if (!prop || !kind) {
                continue;
            }

            const label = rawLabel.startsWith("\"")
                ? rawLabel.slice(1, -1)
                : rawLabel;
            fields[prop] = { label, prop, kind };
        }

        mappings[type] = fields;
    }

    return mappings;
}

function parseActionTypeDefs(
    source: string,
    actionNames: Record<string, string>,
    existingLoreFields: Record<string, Record<string, ExistingLoreField>>,
): ActionTypeDef[] {
    const defs: ActionTypeDef[] = [];
    const typeBlockRegex = /export type (Action\w+) = \{([\s\S]*?)\n\};/g;

    for (const match of source.matchAll(typeBlockRegex)) {
        const [, alias, body] = match;
        const fieldMatches = [...body.matchAll(/^\s*(\w+)\??:\s*([^;]+);$/gm)];
        const typeField = fieldMatches.find((field) => field[1] === "type");
        if (!typeField) continue;

        const typeLiteral = typeField[2].match(/^"([A-Z_]+)"$/)?.[1];
        if (!typeLiteral) continue;

        const fields = fieldMatches
            .filter(([_, name]) => !["type", "note"].includes(name))
            .map(([_, name, typeText]) => ({
                name,
                typeText: typeText.trim(),
            }));

        defs.push({
            alias,
            type: typeLiteral,
            displayName: actionNames[typeLiteral] ?? `TODO ${typeLiteral}`,
            fields: fields.map((field) => ({
                ...field,
                typeText:
                    existingLoreFields[typeLiteral]?.[field.name]?.kind ??
                    field.typeText,
            })),
        });
    }

    return defs;
}

function sortActionTypeDefs(defs: ActionTypeDef[]): ActionTypeDef[] {
    return defs.sort((a, b) => {
        const aIndex = ACTION_TYPE_ORDER_INDEX.get(a.type) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = ACTION_TYPE_ORDER_INDEX.get(b.type) ?? Number.MAX_SAFE_INTEGER;

        if (aIndex !== bIndex) {
            return aIndex - bIndex;
        }

        return a.type.localeCompare(b.type);
    });
}

function renderMappingEntry(
    def: ActionTypeDef,
    existingLoreFields: Record<string, Record<string, ExistingLoreField>>,
): string {
    const fieldLines = def.fields.map(
        (field) => {
            const existing = existingLoreFields[def.type]?.[field.name];
            const label =
                existing?.label ??
                DEFAULT_ACTION_LORE_FIELD_LABELS[def.type]?.[field.name] ??
                `TODO ${field.name}`;
            const kind = existing?.kind ?? guessKind(field.name, field.typeText);
            return `            "${label}": { prop: "${field.name}", kind: "${kind}" },`;
        },
    );

    return [
        `    ${def.type}: {`,
        `        displayName: "${def.displayName}",`,
        `        loreFields: {`,
        ...(fieldLines.length > 0 ? fieldLines : []),
        `        },`,
        `    },`,
    ].join("\n");
}

async function main(): Promise<void> {
    const [actionsSource, constantsSource, actionMappingsSource] =
        await Promise.all([
        readFile(actionsPath, "utf8"),
        readFile(constantsPath, "utf8"),
        readFile(actionMappingsPath, "utf8"),
    ]);
    const actionNames = {
        ...parseActionNames(constantsSource),
        ...parseExistingActionMappingDisplayNames(actionMappingsSource),
    };
    const existingLoreFields =
        parseExistingActionMappingLoreFields(actionMappingsSource);
    const defs = sortActionTypeDefs(
        parseActionTypeDefs(actionsSource, actionNames, existingLoreFields),
    );

    const renderedEntries = defs
        .map((def) => renderMappingEntry(def, existingLoreFields))
        .join("\n\n");

    const output = `import type { Action } from \"htsw/types\";\n\nimport type { ActionLoreSpec } from \"./types\";\n\n// Generated by scripts/generateActionMappingScaffold.ts\n// Safe to regenerate. Copy verified pieces from here into actionMappings.ts as needed.\nexport const ACTION_LORE_MAPPINGS_SCAFFOLD = {\n${renderedEntries}\n} satisfies {\n    [K in Action[\"type\"]]?: ActionLoreSpec<\n        Extract<Action, { type: K }>\n    >;\n};\n`;

    await writeFile(outputPath, output, "utf8");
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
}

await main();
