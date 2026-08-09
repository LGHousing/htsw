import {
    getUploadDiagnosticsPreference,
    setUploadDiagnostics,
} from "../../settings";
import { openConfirmPopover } from "./confirm";

let promptOpen = false;

function choose(upload: boolean): void {
    promptOpen = false;
    setUploadDiagnostics(upload);
}

export function maybeOpenDiagnosticsConsent(): boolean {
    if (getUploadDiagnosticsPreference() !== "unset") return false;
    if (promptOpen) return true;

    promptOpen = true;
    openConfirmPopover({
        title: "Help make HTSW better",
        lines: [
            "Share diagnostic reports when HTSW is slow",
            "or runs into an error?",
            "Reports may include performance data, error details,",
            "project paths, Housing IDs or names, and relevant",
            "menu or item text. Account credentials are not collected.",
            "You can change this anytime in Settings.",
            "Every report helps me find problems and improve HTSW",
            "for everyone. Thank you!",
            "- Callan",
        ],
        confirmLabel: "Share diagnostics",
        cancelLabel: "Not now",
        sticky: true,
        onConfirm: () => choose(true),
        onCancel: () => choose(false),
        onClose: () => {
            promptOpen = false;
        },
    });
    return true;
}
