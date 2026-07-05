import { Diagnostic, SourceMap, parseImportablesResult, type ImportablesParseResult } from "htsw";

import { FileSystemFileLoader } from "../utils/fileLoaders";
import {
    collectImportablesCoverage,
    coverageMatchesSlice,
    createCoverage,
    type SuiteCoverage,
} from "./coverage";

const MODULE_ENV_PATH = "./config/ChatTriggers/modules/HTSW/.env";

export type ParsedTestFixture = {
    id: string;
    importJsonPath: string;
    parsed: ImportablesParseResult;
    coverage: SuiteCoverage;
    blockingDiagnostics: Diagnostic[];
};

export function loadTestFixtures(slice?: string): ParsedTestFixture[] {
    const root = testFixtureRootPath();
    const paths = listFixtureImportJsonPaths(root);
    const fixtures: ParsedTestFixture[] = [];
    for (let i = 0; i < paths.length; i++) {
        const fixture = parseFixture(paths[i]);
        if (matchesFixtureSlice(fixture, slice)) fixtures.push(fixture);
    }
    return fixtures;
}

function testFixtureRootPath(): string {
    const repoPath = readModuleEnvValue("HTSW_REPOSITORY_PATH");
    if (repoPath === null || repoPath.trim() === "") {
        throw new Error(
            "HTSW_REPOSITORY_PATH is not set in the deployed module .env, so /htsw test cannot locate ct_module/testFixtures"
        );
    }
    return joinPath(repoPath.trim(), "ct_module/testFixtures");
}

function parseFixture(importJsonPath: string): ParsedTestFixture {
    const sm = new SourceMap(new FileSystemFileLoader());
    const parsed = parseImportablesResult(sm, importJsonPath);
    const coverage = createCoverage();
    collectImportablesCoverage(coverage, parsed.value);
    return {
        id: fixtureId(importJsonPath),
        importJsonPath,
        parsed,
        coverage,
        blockingDiagnostics: blockingDiagnostics(parsed.diagnostics),
    };
}

function matchesFixtureSlice(
    fixture: ParsedTestFixture,
    slice: string | undefined
): boolean {
    if (slice === undefined || slice.trim() === "") return true;
    const key = slice.trim().toLowerCase();
    return (
        fixture.id.toLowerCase().indexOf(key) >= 0 ||
        coverageMatchesSlice(fixture.coverage, key)
    );
}

function blockingDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
    const out: Diagnostic[] = [];
    for (let i = 0; i < diagnostics.length; i++) {
        const diag = diagnostics[i];
        if (diag.level === "error" || diag.level === "bug") out.push(diag);
    }
    return out;
}

function fixtureId(importJsonPath: string): string {
    const normalized = importJsonPath.split("\\").join("/");
    const parentEnd = normalized.lastIndexOf("/");
    if (parentEnd <= 0) return normalized;
    const parentStart = normalized.lastIndexOf("/", parentEnd - 1);
    return normalized.substring(parentStart + 1, parentEnd);
}

function readModuleEnvValue(key: string): string | null {
    let raw: string;
    try {
        raw = new FileSystemFileLoader().readFile(MODULE_ENV_PATH);
    } catch (_e) {
        return null;
    }
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        if (line.substring(0, eq).trim() === key) {
            return line.substring(eq + 1).trim();
        }
    }
    return null;
}

function listFixtureImportJsonPaths(root: string): string[] {
    const Files = Java.type("java.nio.file.Files");
    const Paths = Java.type("java.nio.file.Paths");
    const rootPath = Paths.get(String(root));
    if (!Files.isDirectory(rootPath)) return [];

    const out: string[] = [];
    const stream = Files.list(rootPath);
    try {
        const iter = stream.iterator();
        while (iter.hasNext()) {
            const child = iter.next();
            if (!Files.isDirectory(child)) continue;
            const importJson = child.resolve("import.json");
            if (Files.exists(importJson)) {
                out.push(String(importJson.toAbsolutePath().normalize().toString()));
            }
        }
    } finally {
        stream.close();
    }
    return out.sort();
}

function joinPath(left: string, right: string): string {
    const trimmed = left.replace(/[\\/]+$/, "");
    return `${trimmed}/${right}`;
}
