import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, modify } from "jsonc-parser";
import ts from "typescript";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helpersPath = path.resolve(extensionDir, "../../language/src/htsl/parse/helpers.ts");
const grammarPath = path.join(extensionDir, "htsl.tmGrammar.json");

const helpersSource = fs.readFileSync(helpersPath, "utf8");
const sourceFile = ts.createSourceFile(
    helpersPath,
    helpersSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
);

const actionKeywords = readStringArray("ACTION_KWS");
const conditionKeywords = readStringArray("CONDITION_KWS");
const shorthands = readStringArray("SHORTHANDS");
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

function readStringArray(name) {
    let declaration;

    function visit(node) {
        if (
            ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.name.text === name
        ) {
            declaration = node;
            return;
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    if (!declaration?.initializer) {
        throw new Error(`Could not find ${name} in ${helpersPath}`);
    }

    let initializer = declaration.initializer;
    while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) {
        initializer = initializer.expression;
    }
    if (!ts.isArrayLiteralExpression(initializer)) {
        throw new Error(`${name} must be an array literal`);
    }

    return initializer.elements.map((element) => {
        if (!ts.isStringLiteralLike(element)) {
            throw new Error(`${name} must contain only string literals`);
        }
        return element.text;
    });
}

function ruleMatches(rule, word) {
    if (typeof rule?.match === "string" && new RegExp(rule.match).test(word)) return true;
    return Array.isArray(rule?.patterns)
        && rule.patterns.some((pattern) => ruleMatches(pattern, word));
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
