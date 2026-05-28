import "promise-polyfill/src/polyfill";
import "./injectLong";
import "./tasks/manager";

import { registerCommands } from "./commands";
import { registerExportCommands } from "./exporter";
import { initMcpBridge } from "./mcp/bridge";
import { initHtswGui } from "./gui/overlay";
import { registerImportSoundCancel } from "./importer/sideEffects";
import { htsl } from "htsw";
import { getMtimeMs } from "./gui/lib/java";
import { setSlotLookupTracer } from "./tasks/specifics/slots";
import { traceSlotLookup } from "./importer/diagnostics/menuTrace";

htsl.setHtslCacheMtimeProvider(getMtimeMs);
setSlotLookupTracer(traceSlotLookup);

registerCommands();
registerExportCommands();
initMcpBridge();
initHtswGui();
registerImportSoundCancel();
