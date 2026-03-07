import type { Action } from "htsw/types";

export type KnowledgeStatus = "confident" | "unsure";
export type ExportMode = "strict" | "incremental";

export type FunctionKnowledge = {
    status: KnowledgeStatus;
    hash?: string;
    watermarkUpdatedAt?: string;
    lastScannedAt?: string;
    source?: "scan" | "import";
};

export type HouseKnowledge = {
    version: 1;
    updatedAt: string;
    functions: {
        status: KnowledgeStatus;
        values: Record<string, FunctionKnowledge>;
    };
};

export type DiscoveredFunction = {
    name: string;
    repeatTicks?: number;
};

export type WatermarkPayload = {
    hash: string;
    updatedAt: string;
};

export type ScannedFunction = {
    name: string;
    repeatTicks?: number;
    actions?: Action[];
    watermark?: WatermarkPayload;
    scanError?: string;
};

export type ExportSummary = {
    mode: ExportMode;
    discovered: number;
    scanned: number;
    reused: number;
    mismatches: number;
    unsure: number;
    exported: number;
};

