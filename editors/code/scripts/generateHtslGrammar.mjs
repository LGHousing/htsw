import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyEdits, modify } from "jsonc-parser";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helpersPath = path.resolve(extensionDir, "../../language/src/htsl/parse/helpers.ts");
const grammarPath = path.join(extensionDir, "htsl.tmGrammar.json");

const {
    ACTION_KWS: actionKeywords,
    CONDITION_KWS: conditionKeywords,
    SHORTHANDS: shorthands,
} = await import(pathToFileURL(helpersPath).href);
const grammarSource = fs.readFileSync(grammarPath, "utf8");
const grammar = JSON.parse(grammarSource);

const separatelyHighlighted = [
    grammar.repository.keywords,
    grammar.repository["storage-types"],
];
const entityKeywords = [...new Set([
    ...actionKeywords,
    ...conditionKeywords,
    ...shorthands,
])]
    .filter((word) => !separatelyHighlighted.some((rule) => ruleMatches(rule, word)))
    .sort();

const entityPattern = `\\b(${entityKeywords.map(escapeRegex).join("|")})\\b`;
const generated = applyEdits(grammarSource, modify(
    grammarSource,
    ["repository", "entities", "match"],
    entityPattern,
    { formattingOptions: { insertSpaces: true, tabSize: 4 } },
));
if (grammarSource !== generated) {
    fs.writeFileSync(grammarPath, generated);
}

function ruleMatches(rule, word) {
    if (typeof rule?.match === "string" && new RegExp(rule.match).test(word)) return true;
    return Array.isArray(rule?.patterns)
        && rule.patterns.some((pattern) => ruleMatches(pattern, word));
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
