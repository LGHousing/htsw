import * as vscode from "vscode";

let output: vscode.OutputChannel | undefined;

function ensureChannel(): vscode.OutputChannel {
    if (output === undefined) {
        output = vscode.window.createOutputChannel("HTSW Performance");
    }
    return output;
}

export function initPerfChannel(): void {
    const channel = ensureChannel();
    const enabled = isPerfTracingEnabled();
    channel.appendLine(
        `${new Date().toISOString()} HTSW++ extension activated (trace.performance=${enabled})`
    );
    if (!enabled) {
        channel.appendLine(
            "Tracing is OFF. Set \"htsw.trace.performance\": true in settings to record timings."
        );
    }
}

export function isPerfTracingEnabled(uri?: vscode.Uri): boolean {
    return vscode.workspace
        .getConfiguration("htsw", uri)
        .get<boolean>("trace.performance", false);
}

export function tracePerformance(
    uri: vscode.Uri | undefined,
    label: string,
    startedAt: number,
    details = ""
): void {
    if (!isPerfTracingEnabled(uri)) return;
    const channel = ensureChannel();

    const elapsedMs = Math.round(performance.now() - startedAt);
    const suffix = details.length > 0 ? ` ${details}` : "";
    channel.appendLine(`${new Date().toISOString()} ${label}: ${elapsedMs}ms${suffix}`);
}

export function traceEvent(
    uri: vscode.Uri | undefined,
    label: string,
    details = ""
): void {
    if (!isPerfTracingEnabled(uri)) return;
    const channel = ensureChannel();
    const suffix = details.length > 0 ? ` ${details}` : "";
    channel.appendLine(`${new Date().toISOString()} ${label}${suffix}`);
}
