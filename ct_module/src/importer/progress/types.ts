import type { Importable } from "htsw/types";

export type ProgressPhase = "reading" | "hydrating" | "applying";

export type PhaseUnits = {
    reading: number;
    hydrating: number;
    applying: number;
};

export type ImportRunRowStatus =
    | "queued"
    | "current"
    | "imported"
    | "skipped"
    | "failed";

export type ActionListProgressFields = {
    phase: ProgressPhase;
    phaseLabel: string;
    unitCompleted: number;
    unitTotal: number;
    parentUnitCompleted?: number;
    parentUnitTotal?: number;
    parentPhaseLabel?: string;
    completedUnits: number;
    totalUnits: number;
    phaseUnits: PhaseUnits;
};

export type ImportProgressRow = {
    key: string;
    status: ImportRunRowStatus;
    units: number;
};

export type ImportProgressCurrent = {
    key: string;
    type: Importable["type"];
    identity: string;
    status: Exclude<ImportRunRowStatus, "queued">;
    phase: ProgressPhase | "done";
    label: string;
    phaseLabel: string;
    completedUnits: number;
    totalUnits: number;
    phaseUnits: PhaseUnits;
    unitCompleted?: number;
    unitTotal?: number;
    parentUnitCompleted?: number;
    parentUnitTotal?: number;
    parentPhaseLabel?: string;
};

export type ImportProgress = {
    completedImportables: number;
    totalImportables: number;
    completedUnits: number;
    totalUnits: number;
    current: ImportProgressCurrent | null;
    rows: readonly ImportProgressRow[];
    failed: number;
};

/** Callback shape that `readActionList` / `applyActionListDiff` invoke. */
export type ActionListProgressHandler = (progress: ActionListProgressFields) => void;
