import { printDiagnostics } from "../tui/diagnostics";
import { TaskManager } from "../tasks/manager";
import { loadTestFixtures } from "./fixtures";
import { coverageForFixtures, emitCoverageReport } from "./report";
import { runLiveTestSuite } from "./runner";

export function commandTest(args: string[]): void {
    const first = (args[0] ?? "").toLowerCase();
    if (first === "coverage") {
        runCoverageCommand(args[1]);
        return;
    }
    if (TaskManager.isBusy()) {
        ChatLib.chat("&c[htsw test] a task is already running.");
        return;
    }
    const slice = args.length > 0 ? args[0] : undefined;
    TaskManager.run(async (ctx) => {
        await runLiveTestSuite(ctx, slice);
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw test] failed: ${String(err)}`);
    });
}

function runCoverageCommand(slice?: string): void {
    let fixtures;
    try {
        fixtures = loadTestFixtures(slice);
    } catch (e) {
        ChatLib.chat(`&c[htsw test] coverage failed: ${String(e)}`);
        return;
    }
    if (fixtures.length === 0) {
        ChatLib.chat("&c[htsw test] no fixtures matched.");
        return;
    }
    for (let i = 0; i < fixtures.length; i++) {
        const fixture = fixtures[i];
        if (fixture.blockingDiagnostics.length > 0) {
            ChatLib.chat(
                `&c[htsw test] ${fixture.id}: ${fixture.blockingDiagnostics.length} parse error(s)`
            );
            printDiagnostics(
                fixture.parsed.gcx.sourceMap,
                fixture.blockingDiagnostics
            );
        }
    }
    emitCoverageReport(
        (message) => ChatLib.chat(message),
        coverageForFixtures(fixtures),
        fixtures.length
    );
}
