import type { ImportableFunction } from "htsw/types";
import TaskContext from "../tasks/context";
import {
    createDefaultKnowledge,
    loadKnowledge,
    saveKnowledge,
    setCollectionStatus,
    setFunctionKnowledge,
} from "./knowledgeStore";
import { loadImportJson, saveImportJson, upsertFunctionEntries, type FunctionImportJsonEntry } from "./importJson";
import { joinPath, parentPath, resolveModulePath } from "./path";
import { discoverFunctions } from "./scanFunctions";
import type { ExportMode, ExportSummary, HouseKnowledge, ScannedFunction } from "./types";
import { openFunctionEditor } from "./helpers";
import { readFunctionNote } from "./readFunctionNote";
import { scanFunctionDetails } from "./scanFunctionDetails";
import { hashFunctionRepresentation } from "./hash";
import { writeFunctionFiles } from "./writeFiles";
import { writeFunctionWatermarkOnOpenEditor } from "./writeFunctionNote";

type ExportRunResult = {
    summary: ExportSummary;
    warnings: string[];
};

type ExistingFunctionEntry = {
    name: string;
    actions: string;
    repeatTicks?: number;
};

function nowIso(): string {
    return new Date().toISOString();
}

function getKnowledgePath(importJsonPath: string): string {
    return joinPath(parentPath(importJsonPath), "knowledge.json");
}

function getExistingFunctionEntries(importJson: Record<string, any>): Map<string, ExistingFunctionEntry> {
    const map = new Map<string, ExistingFunctionEntry>();
    const functions = Array.isArray(importJson.functions) ? importJson.functions : [];
    for (const fn of functions) {
        if (fn && typeof fn.name === "string" && typeof fn.actions === "string") {
            map.set(fn.name, {
                name: fn.name,
                actions: fn.actions,
                repeatTicks: typeof fn.repeatTicks === "number" ? fn.repeatTicks : undefined,
            });
        }
    }
    return map;
}

function toUpsertEntry(
    name: string,
    actionsPath: string,
    repeatTicks?: number
): FunctionImportJsonEntry {
    return {
        name,
        actions: actionsPath,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
    };
}

function normalizeMode(mode: string | undefined): ExportMode {
    return mode === "incremental" ? "incremental" : "strict";
}

export async function runExporter(
    ctx: TaskContext,
    importJsonPath: string,
    modeRaw?: string
): Promise<ExportRunResult> {
    const mode = normalizeMode(modeRaw);
    const resolvedImportJsonPath = resolveModulePath(importJsonPath);
    const houseRoot = parentPath(resolvedImportJsonPath);
    const knowledgePath = getKnowledgePath(resolvedImportJsonPath);

    const importJson = loadImportJson(resolvedImportJsonPath);
    const existingEntries = getExistingFunctionEntries(importJson);
    const knowledge = loadKnowledge(knowledgePath);

    const discovered = await discoverFunctions(ctx);
    const warnings: string[] = [];

    let scanned = 0;
    let reused = 0;
    let mismatches = 0;
    let unsure = 0;
    let exported = 0;

    const pendingWrites: ScannedFunction[] = [];
    const actionsPathByName = new Map<string, string>();
    const repeatTicksByName = new Map<string, number | undefined>();

    for (const fn of discovered) {
        repeatTicksByName.set(fn.name, fn.repeatTicks);

        const known = knowledge.functions.values[fn.name];
        const existing = existingEntries.get(fn.name);

        if (
            mode === "incremental"
            && known?.status === "confident"
            && known.hash
            && existing
        ) {
            const note = await readFunctionNote(ctx, fn.name);
            if (note.malformedWatermark) {
                warnings.push(`${fn.name}: malformed function note watermark block`);
            }
            if (note.exists && note.watermarkHash === known.hash) {
                reused++;
                actionsPathByName.set(fn.name, existing.actions);
                continue;
            }

            mismatches++;
            setFunctionKnowledge(knowledge, fn.name, {
                status: "unsure",
                lastScannedAt: nowIso(),
            });
        }

        scanned++;
        const scannedFn = await scanFunctionDetails(ctx, fn.name, fn.repeatTicks);

        if (scannedFn.actions) {
            pendingWrites.push(scannedFn);
            const hash = hashFunctionRepresentation(fn.name, scannedFn.actions, fn.repeatTicks);
            setFunctionKnowledge(knowledge, fn.name, {
                status: "confident",
                hash,
                watermarkUpdatedAt: scannedFn.watermark?.updatedAt,
                lastScannedAt: nowIso(),
                source: "scan",
            });
        } else {
            unsure++;
            setFunctionKnowledge(knowledge, fn.name, {
                status: "unsure",
                watermarkUpdatedAt: scannedFn.watermark?.updatedAt,
                lastScannedAt: nowIso(),
                source: "scan",
            });

            if (scannedFn.scanError) {
                warnings.push(`${fn.name}: ${scannedFn.scanError}`);
            }

            if (existing) {
                actionsPathByName.set(fn.name, existing.actions);
            } else {
                pendingWrites.push(scannedFn);
            }
        }
    }

    const writeResults = writeFunctionFiles(
        houseRoot,
        pendingWrites.map((it) => ({
            name: it.name,
            actions: it.actions,
            repeatTicks: it.repeatTicks,
        }))
    );

    for (const item of writeResults) {
        actionsPathByName.set(item.name, item.relativePath);
        exported++;
        if (item.wroteStub) {
            unsure++;
            const current = knowledge.functions.values[item.name] ?? { status: "unsure" };
            current.status = "unsure";
            current.lastScannedAt = nowIso();
            knowledge.functions.values[item.name] = current;
        }
    }

    const upsertEntries: FunctionImportJsonEntry[] = [];
    for (const fn of discovered) {
        const actionsPath = actionsPathByName.get(fn.name);
        if (!actionsPath) continue;
        upsertEntries.push(
            toUpsertEntry(fn.name, actionsPath, repeatTicksByName.get(fn.name))
        );
    }

    const nextImportJson = upsertFunctionEntries(importJson, upsertEntries);
    saveImportJson(resolvedImportJsonPath, nextImportJson);

    const allConfident = discovered.every((it) => knowledge.functions.values[it.name]?.status === "confident");
    setCollectionStatus(knowledge, allConfident ? "confident" : "unsure");
    saveKnowledge(knowledgePath, knowledge);

    return {
        summary: {
            mode,
            discovered: discovered.length,
            scanned,
            reused,
            mismatches,
            unsure,
            exported,
        },
        warnings,
    };
}

export async function onFunctionImported(
    ctx: TaskContext,
    importJsonPath: string,
    imported: ImportableFunction
): Promise<string[]> {
    const warnings: string[] = [];
    const resolvedImportJsonPath = resolveModulePath(importJsonPath);
    const knowledgePath = getKnowledgePath(resolvedImportJsonPath);
    const knowledge: HouseKnowledge = loadKnowledge(knowledgePath) ?? createDefaultKnowledge();

    const updatedAt = nowIso();
    const hash = hashFunctionRepresentation(
        imported.name,
        imported.actions,
        imported.repeatTicks
    );

    let writeResult: { ok: boolean; reason?: string };
    try {
        const opened = await openFunctionEditor(ctx, imported.name);
        if (!opened) {
            writeResult = { ok: false, reason: "Function editor could not be opened" };
        } else {
            writeResult = await writeFunctionWatermarkOnOpenEditor(ctx, {
                hash,
                updatedAt,
            });
        }
    } catch (e) {
        writeResult = { ok: false, reason: `${e}` };
    }

    if (!writeResult.ok) {
        warnings.push(`Failed to write function watermark for "${imported.name}": ${writeResult.reason}`);
        setFunctionKnowledge(knowledge, imported.name, {
            status: "unsure",
            hash,
            lastScannedAt: updatedAt,
            source: "import",
        });
    } else {
        setFunctionKnowledge(knowledge, imported.name, {
            status: "confident",
            hash,
            watermarkUpdatedAt: updatedAt,
            lastScannedAt: updatedAt,
            source: "import",
        });
    }

    setCollectionStatus(
        knowledge,
        Object.values(knowledge.functions.values).every((it) => it.status === "confident")
            ? "confident"
            : "unsure"
    );
    saveKnowledge(knowledgePath, knowledge);

    return warnings;
}
