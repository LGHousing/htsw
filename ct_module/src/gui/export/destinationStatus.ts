import { projectPathExists } from "../../project/paths";
import { getExportImportJsonPath } from "../state";

export type ExportDestinationStatus =
    | { kind: "none" }
    | { kind: "missing"; path: string }
    | { kind: "ready"; path: string };

export function getExportDestinationStatus(): ExportDestinationStatus {
    const path = getExportImportJsonPath();
    if (path.trim() === "") return { kind: "none" };
    if (!projectPathExists(path)) return { kind: "missing", path };
    return { kind: "ready", path };
}
