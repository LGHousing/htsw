import { fileExists, readText, writeText } from "./path";
import type { FunctionKnowledge, HouseKnowledge, KnowledgeStatus } from "./types";

function nowIso(): string {
    return new Date().toISOString();
}

export function createDefaultKnowledge(): HouseKnowledge {
    return {
        version: 1,
        updatedAt: nowIso(),
        functions: {
            status: "unsure",
            values: {},
        },
    };
}

function backupKnowledgeFile(path: string, content: string): void {
    const backupPath = `${path}.bak.${Date.now()}.json`;
    writeText(backupPath, content, true);
}

export function loadKnowledge(path: string): HouseKnowledge {
    if (!fileExists(path)) {
        return createDefaultKnowledge();
    }

    const raw = readText(path);
    if (!raw || raw.trim().length === 0) {
        return createDefaultKnowledge();
    }

    try {
        const parsed = JSON.parse(raw) as HouseKnowledge;
        if (parsed.version !== 1 || parsed.functions == null || parsed.functions.values == null) {
            backupKnowledgeFile(path, raw);
            return createDefaultKnowledge();
        }
        return parsed;
    } catch (e) {
        backupKnowledgeFile(path, raw);
        return createDefaultKnowledge();
    }
}

export function saveKnowledge(path: string, knowledge: HouseKnowledge): void {
    knowledge.updatedAt = nowIso();
    writeText(path, `${JSON.stringify(knowledge, null, 4)}\n`, true);
}

export function setFunctionKnowledge(
    knowledge: HouseKnowledge,
    functionName: string,
    patch: Partial<FunctionKnowledge>
): FunctionKnowledge {
    const current: FunctionKnowledge = knowledge.functions.values[functionName] ?? { status: "unsure" };
    const merged: FunctionKnowledge = { ...current, ...patch };
    knowledge.functions.values[functionName] = merged;
    return merged;
}

export function setCollectionStatus(knowledge: HouseKnowledge, status: KnowledgeStatus): void {
    knowledge.functions.status = status;
}

