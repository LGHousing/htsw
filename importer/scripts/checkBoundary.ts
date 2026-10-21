// Fails when importer/ reaches past its client hooks: a ChatTriggers, Rhino,
// Java or Minecraft name, an SRG name, a Java class string, an import of
// ct_module/, or a tsconfig that brings their types in. The importer talks to
// a client only through src/platform.ts and the client modules it describes.
//
//   npm run check:boundary
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const importerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(importerDir, "..");
const srcDir = path.join(importerDir, "src") + path.sep;
const configPath = path.join(importerDir, "tsconfig.json");

// Code the importer may compile against besides itself.
const allowedRoots = [
    srcDir,
    path.join(repoDir, "language") + path.sep,
    path.join(repoDir, "editors", "common") + path.sep,
];

// Globals a ChatTriggers module sees at runtime (CTAutocomplete's `declare
// global` names plus Rhino's). Under importer/tsconfig.json none of them
// resolve; this list makes the report name the culprit.
const CLIENT_GLOBALS = new Set([
    "Java", "java", "javax", "Packages", "JavaAdapter", "JavaImporter", "importPackage",
    "importClass", "sync", "ChatLib", "Client", "Player", "World", "Server", "Scoreboard",
    "TabList", "FileLib", "Renderer", "Tessellator", "GuiHandler", "Gui", "Display",
    "DisplayLine", "Text", "Image", "Rectangle", "Shape", "Book", "KeyBind", "Keyboard",
    "Item", "Inventory", "Slot", "Block", "BlockPos", "BlockType", "Entity", "PlayerMP",
    "Particle", "Sound", "Message", "TextComponent", "Thread", "Trigger", "TriggerRegister",
    "TriggerType", "register", "cancel", "setTimeout", "print", "Console", "ChatTriggers",
    "Config", "Settings", "Module", "MathLib", "EventLib", "ReflectionHelper", "NBT",
    "NBTTagCompound", "NBTTagList", "Team", "TileEntity", "Chunk", "GL11", "GlStateManager",
]);

// Java packages that name client classes inside a string (Java.type("java.lang.Thread")).
const JAVA_CLASS_STRING = /^(java|javax|net\.minecraft|net\.minecraftforge|org\.lwjgl|com\.chattriggers|gg\.essential)\./;
// MCP/SRG obfuscated member names (field_71462_r, func_152345_ab).
const SRG_NAME = /\b(func|field)_\d+_[A-Za-z]+\b/;

const problems: string[] = [];

function report(file: string, node: ts.Node | null, message: string): void {
    const rel = path.relative(repoDir, file);
    if (node === null) {
        problems.push(`${rel}: ${message}`);
        return;
    }
    const sf = node.getSourceFile();
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    problems.push(`${rel}:${line + 1}:${character + 1}: ${message}`);
}

function isInside(file: string, roots: readonly string[]): boolean {
    const abs = path.resolve(file);
    return roots.some((root) => abs.startsWith(root));
}

function isTypeScriptLib(file: string): boolean {
    return /[\\/]typescript[\\/]lib[\\/]lib\.[^\\/]+\.d\.ts$/.test(file);
}

// ── tsconfig ───────────────────────────────────────────────────────────────
const configText = fs.readFileSync(configPath, "utf8");
const parsedConfig = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, (file) => ts.sys.readFile(file)).config,
    ts.sys,
    importerDir
);
if (/CTAutocomplete|ct_module/.test(configText)) {
    report(configPath, null, "tsconfig.json mentions CTAutocomplete or ct_module");
}
const types = parsedConfig.options.types;
if (types === undefined || types.length > 0) {
    report(configPath, null, 'compilerOptions.types must be [] (no ambient @types)');
}
for (const lib of parsedConfig.options.lib ?? []) {
    if (/dom|webworker|scripthost/i.test(lib)) {
        report(configPath, null, `lib ${lib} declares browser globals; the importer has none`);
    }
}

// ── sources ────────────────────────────────────────────────────────────────
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();

for (const sf of program.getSourceFiles()) {
    const file = path.resolve(sf.fileName);
    if (isTypeScriptLib(file)) continue;
    if (!isInside(file, allowedRoots)) {
        report(file, null, "compiled into the importer from outside importer/, language/ and editors/common/");
    }
}

function isPropertyName(node: ts.Identifier): boolean {
    const parent = node.parent;
    return (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isMethodSignature(parent) && parent.name === node) ||
        (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
        (ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
        (ts.isEnumMember(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node) ||
        (ts.isImportSpecifier(parent) && parent.propertyName === node) ||
        (ts.isExportSpecifier(parent) && parent.propertyName === node) ||
        ts.isLabeledStatement(parent) ||
        ts.isBreakOrContinueStatement(parent)
    );
}

function checkSpecifier(file: string, literal: ts.Node, specifier: string): void {
    if (/ct_module|CTAutocomplete/.test(specifier)) {
        report(file, literal, `imports "${specifier}"`);
        return;
    }
    const resolved = ts.resolveModuleName(specifier, file, parsedConfig.options, ts.sys)
        .resolvedModule;
    if (resolved !== undefined && !isInside(resolved.resolvedFileName, allowedRoots)) {
        if (!resolved.resolvedFileName.includes(`${path.sep}node_modules${path.sep}`)) {
            report(file, literal, `imports "${specifier}" from outside the importer`);
        }
    }
}

for (const sf of program.getSourceFiles()) {
    const file = path.resolve(sf.fileName);
    if (!file.startsWith(srcDir)) continue;

    for (const ref of [...sf.typeReferenceDirectives, ...sf.referencedFiles]) {
        report(file, null, `/// <reference> to "${ref.fileName}"`);
    }
    if (/@ts-(ignore|nocheck|expect-error)/.test(sf.text)) {
        report(file, null, "suppresses type errors, which could hide a client global");
    }

    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            checkSpecifier(file, node.moduleSpecifier, node.moduleSpecifier.text);
        } else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
            node.arguments.length > 0 &&
            ts.isStringLiteralLike(node.arguments[0])
        ) {
            checkSpecifier(file, node.arguments[0], node.arguments[0].text);
        } else if (ts.isStringLiteralLike(node)) {
            if (JAVA_CLASS_STRING.test(node.text)) {
                report(file, node, `Java class name "${node.text}"`);
            } else if (SRG_NAME.test(node.text)) {
                report(file, node, `SRG name in "${node.text}"`);
            }
        } else if (ts.isIdentifier(node)) {
            if (SRG_NAME.test(node.text)) {
                report(file, node, `SRG name ${node.text}`);
            } else if (node.text === "globalThis") {
                report(file, node, "globalThis, which reaches client globals untyped");
            } else if (!isPropertyName(node)) {
                const symbol = checker.getSymbolAtLocation(node);
                const declarations = symbol?.declarations ?? [];
                const declaredHere = declarations.some((d) =>
                    isInside(d.getSourceFile().fileName, allowedRoots)
                );
                const declaredByLib = declarations.some((d) =>
                    isTypeScriptLib(d.getSourceFile().fileName)
                );
                if (CLIENT_GLOBALS.has(node.text) && !declaredHere) {
                    report(file, node, `client global ${node.text}`);
                } else if (symbol === undefined && !declaredHere && !declaredByLib) {
                    // Only names with no declaration at all; typecheck reports these
                    // too, this keeps the boundary check on its own.
                    if (!ts.isShorthandPropertyAssignment(node.parent)) {
                        report(file, node, `undeclared global ${node.text}`);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}

if (problems.length > 0) {
    console.error(`importer boundary: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
}
const checked = program
    .getSourceFiles()
    .filter((sf) => path.resolve(sf.fileName).startsWith(srcDir)).length;
console.log(`importer boundary: ok (${checked} files in importer/src)`);
