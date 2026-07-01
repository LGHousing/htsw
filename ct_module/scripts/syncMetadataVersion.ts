import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const moduleRoot = resolve(dirname(__filename), "..");
const packagePath = resolve(moduleRoot, "package.json");
const metadataPath = resolve(moduleRoot, "metadata.json");

type JsonObject = {
    version?: unknown;
};

function readJson(path: string): JsonObject {
    const text = readFileSync(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${path} must contain a JSON object`);
    }
    return parsed;
}

function readVersion(label: string, path: string): string {
    const value = readJson(path).version;
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${label} version must be a non-empty string in ${path}`);
    }
    return value;
}

function writeMetadataVersion(version: string): boolean {
    const current = readFileSync(metadataPath, "utf8");
    const metadata = readJson(metadataPath);
    metadata.version = version;

    const versionField = /("version"\s*:\s*)"[^"]*"/;
    const next = versionField.test(current)
        ? current.replace(versionField, (_match, prefix: string) => `${prefix}${JSON.stringify(version)}`)
        : `${JSON.stringify(metadata, null, 4)}\n`;

    if (next === current) return false;
    writeFileSync(metadataPath, next, "utf8");
    return true;
}

const packageVersion = readVersion("package.json", packagePath);
const metadataVersion = readVersion("metadata.json", metadataPath);
const checkOnly = process.argv.includes("--check");

if (checkOnly) {
    if (packageVersion !== metadataVersion) {
        console.error(
            `ct_module metadata version mismatch: package.json is ${packageVersion}, metadata.json is ${metadataVersion}`
        );
        console.error("Run `npm run sync:metadata` from ct_module to update metadata.json.");
        process.exit(1);
    }
    console.log(`metadata.json version matches package.json (${packageVersion})`);
} else {
    const changed = writeMetadataVersion(packageVersion);
    if (changed) {
        console.log(`metadata.json version updated to ${packageVersion}`);
    } else {
        console.log(`metadata.json version already matches package.json (${packageVersion})`);
    }
}
