import { TaskManager } from "../../tasks/manager";
import { exportOpenActionListTo } from "../../runtime/openActionListExport";
import { openFileBrowserWithHtslDestination } from "../popovers/file-browser";

export function startOpenActionListExport(): void {
    if (TaskManager.isBusy()) {
        ChatLib.chat(
            "&c[htsw] An import (or another task) is already running — wait for it to finish first."
        );
        return;
    }
    openFileBrowserWithHtslDestination(undefined, (path, replaceExisting) => {
        void exportOpenActionListTo(path, replaceExisting);
    });
}
