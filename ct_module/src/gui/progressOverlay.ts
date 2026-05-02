/// <reference types="../../CTAutocomplete" />

import { TaskManager } from "../tasks/manager";
import { Colors } from "./colors";
import type { DashboardRuntime } from "./dashboardRuntime";
import type { ImportProgress } from "../importables/importSession";

/**
 * Renders a small status panel on top of whatever Minecraft screen is open
 * (e.g., the Hypixel housing function editor) while an import or export is
 * in flight. Anchored top-left so it doesn't conflict with the housing info
 * panel on the right side of the screen.
 *
 * Driven by the ChatTriggers `guiRender` event, which fires every frame a
 * GUI screen is rendering. We register on overlay start and tear down on
 * overlay stop.
 */

const PANEL_W = 260;
const PANEL_H = 76;
const PANEL_X = 8;
const PANEL_Y = 8;
const CANCEL_W = 64;
const CANCEL_H = 14;

export function startProgressOverlay(
    runtime: DashboardRuntime,
    label: string
): void {
    runtime.progress = {
        label,
        completed: 0,
        total: 0,
        failed: 0,
        currentLabel: "starting...",
        startedAtMs: Date.now(),
        finishedAtMs: null,
    };

    if (runtime.overlayTrigger !== null) {
        try {
            unregisterAll(runtime.overlayTrigger);
        } catch (_) {
            // ignore
        }
    }

    const renderTrigger = register(
        "guiRender",
        // The renderer is intentionally tolerant of partial state — even if the
        // runtime got torn down, we should fail silently rather than spam chat.
        () => {
            try {
                drawOverlayPanel(runtime);
            } catch (_) {
                // ignore — we'll see render errors in another pathway
            }
        }
    );

    const clickTrigger = register(
        "guiMouseClick",
        (mouseX: number, mouseY: number, mouseButton: number) => {
            if (mouseButton !== 0) return;
            if (runtime.progress === null) return;
            if (runtime.progress.finishedAtMs !== null) return;
            // Cancel button rect.
            const cx = PANEL_X + PANEL_W - CANCEL_W - 6;
            const cy = PANEL_Y + PANEL_H - CANCEL_H - 6;
            if (
                mouseX >= cx &&
                mouseX <= cx + CANCEL_W &&
                mouseY >= cy &&
                mouseY <= cy + CANCEL_H
            ) {
                try {
                    TaskManager.cancelAll();
                    if (runtime.progress) {
                        runtime.progress.currentLabel = "cancelling...";
                    }
                } catch (error) {
                    ChatLib.chat(`&c[gui] cancel failed: ${error}`);
                }
            }
        }
    );

    runtime.overlayTrigger = [renderTrigger, clickTrigger];
}

function unregisterAll(triggers: any): void {
    if (Array.isArray(triggers)) {
        for (let i = 0; i < triggers.length; i++) {
            try {
                triggers[i].unregister();
            } catch (_) {}
        }
    } else if (triggers && typeof triggers.unregister === "function") {
        try {
            triggers.unregister();
        } catch (_) {}
    }
}

export function updateProgress(
    runtime: DashboardRuntime,
    progress: ImportProgress
): void {
    if (runtime.progress === null) return;
    runtime.progress.completed = progress.completed;
    runtime.progress.total = progress.total;
    runtime.progress.failed = progress.failed;
    runtime.progress.currentLabel = progress.currentLabel;
}

export function stopProgressOverlay(
    runtime: DashboardRuntime,
    finalMessage: string
): void {
    if (runtime.progress !== null) {
        runtime.progress.finishedAtMs = Date.now();
        runtime.progress.currentLabel = finalMessage;
    }

    // Keep the panel up for a few seconds so the user sees the final summary,
    // then tear down. We use a setTimeout-style via Java's Thread.
    const Thread = Java.type("java.lang.Thread");
    const Runnable = Java.type("java.lang.Runnable");
    const task = new Runnable({
        run: () => {
            try {
                Thread.sleep(3500);
            } catch (_) {}
            try {
                if (runtime.overlayTrigger !== null) {
                    unregisterAll(runtime.overlayTrigger);
                    runtime.overlayTrigger = null;
                }
            } catch (_) {}
            runtime.progress = null;
        },
    });
    new Thread(task).start();
}

function drawOverlayPanel(runtime: DashboardRuntime): void {
    const progress = runtime.progress;
    if (progress === null) return;

    const x = PANEL_X;
    const y = PANEL_Y;
    Renderer.drawRect(0xee0a0d12, x, y, PANEL_W, PANEL_H);
    Renderer.drawRect(Colors.accent, x, y, PANEL_W, 1);

    Renderer.drawString(`HTSW · ${progress.label}`, x + 8, y + 6);

    const elapsed = Math.max(0, Date.now() - progress.startedAtMs);
    const elapsedSec = Math.floor(elapsed / 1000);
    const ratio = progress.total > 0 ? progress.completed / progress.total : 0;
    const etaSec =
        progress.completed > 0 && progress.total > 0
            ? Math.max(
                  0,
                  Math.floor(
                      (elapsed / progress.completed) *
                          (progress.total - progress.completed) /
                          1000
                  )
              )
            : null;

    const meter = `${progress.completed}/${progress.total}` +
        (progress.failed > 0 ? ` · ${progress.failed} failed` : "");
    Renderer.drawString(meter, x + 8, y + 18);

    // Truncate the current importable label so it fits in the panel.
    const labelMax = 38;
    const label =
        progress.currentLabel.length > labelMax
            ? progress.currentLabel.slice(0, labelMax - 3) + "..."
            : progress.currentLabel;
    Renderer.drawString(label, x + 8, y + 30);

    // Progress bar.
    const barX = x + 8;
    const barY = y + 44;
    const barW = PANEL_W - 16;
    const barH = 6;
    Renderer.drawRect(0xff2d333d, barX, barY, barW, barH);
    Renderer.drawRect(
        progress.failed > 0 ? 0xffe5bc4b : 0xff62d26f,
        barX,
        barY,
        Math.max(0, Math.floor(barW * ratio)),
        barH
    );

    const eta =
        etaSec !== null ? `eta ~${etaSec}s` : progress.finishedAtMs ? "done" : "...";
    Renderer.drawString(`${elapsedSec}s · ${eta}`, x + 8 + barW - 80, y + 18);

    // Cancel button (bottom-right of panel) — only meaningful while task runs.
    const cancelEnabled = progress.finishedAtMs === null;
    const cx = x + PANEL_W - CANCEL_W - 6;
    const cy = y + PANEL_H - CANCEL_H - 6;
    Renderer.drawRect(
        cancelEnabled ? 0xffa0301f : 0x88505050,
        cx,
        cy,
        CANCEL_W,
        CANCEL_H
    );
    Renderer.drawString(
        "Cancel",
        cx + Math.floor((CANCEL_W - 36) / 2),
        cy + 3
    );
}
