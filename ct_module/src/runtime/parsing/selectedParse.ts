import type { ImportablesParseResult } from "htsw";

import { getImportJsonPath } from "../state/paths";
import { getParseAt } from "./parses";

export function getSelectedParsedResult(): ImportablesParseResult | null {
    const path = getImportJsonPath();
    if (path === "") return null;
    return getParseAt(path)?.parsed ?? null;
}
