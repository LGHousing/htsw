import { PROJECTS_ROOT, resolveModuleRelativePath } from "../project/paths";
import { parseCommandArgs } from "../utils/commandArgs";
import { javaType } from "../utils/java";
import { showInExplorer, revealInFilesLabel } from "../utils/osShell";
import { chatLine } from "../utils/chat";

const IMPLIED_EXTENSIONS = [".snbt", ".json", ".htsl"];

function javaPath(path: string): HtswJavaPath {
    return javaType("java.nio.file.Paths").get(path);
}

function pathExists(path: string): boolean {
    try {
        return javaType("java.nio.file.Files").exists(javaPath(path));
    } catch (_e) {
        return false;
    }
}

function absolutePath(path: string): string {
    return String(javaPath(path).toAbsolutePath().normalize().toString());
}

function projectsRootAbsolute(): string {
    return absolutePath(PROJECTS_ROOT);
}

function firstExistingPath(path: string): string | null {
    if (pathExists(path)) return path;
    if (/\.[A-Za-z0-9]+$/.test(path)) return null;
    for (let i = 0; i < IMPLIED_EXTENSIONS.length; i++) {
        const candidate = `${path}${IMPLIED_EXTENSIONS[i]}`;
        if (pathExists(candidate)) return candidate;
    }
    return null;
}

export function commandOpen(args: string[]): void {
    const parsed = parseCommandArgs(args);
    if (!parsed.ok) {
        chatLine(`&c[htsw] ${parsed.error}`);
        return;
    }
    if (parsed.args.length > 1) {
        chatLine("&cUsage: /htsw open [path]");
        chatLine("&7  Quote paths that contain spaces.");
        return;
    }

    const rawPath = (parsed.args[0] ?? ".").trim();
    const resolved = resolveModuleRelativePath(rawPath.length === 0 ? "." : rawPath)
        .split("\\")
        .join("/");
    if (resolved === PROJECTS_ROOT) {
        openProjectsRoot();
        return;
    }

    const found = firstExistingPath(resolved);
    if (found === null) {
        chatLine(`&c[htsw] File or folder not found: ${absolutePath(resolved)}`);
        return;
    }

    const abs = absolutePath(found);
    try {
        showInExplorer(abs);
        chatLine(`&a[htsw] ${revealInFilesLabel()}: &f${abs}`);
    } catch (err) {
        chatLine(`&c[htsw] Couldn't open ${abs}: ${String(err)}`);
    }
}

function openProjectsRoot(): void {
    const abs = projectsRootAbsolute();
    try {
        javaType("java.nio.file.Files").createDirectories(javaPath(abs));
    } catch (_e) {
        // best-effort; showInExplorer surfaces a real failure below
    }
    try {
        showInExplorer(abs);
        chatLine("&a[htsw] Opened projects folder");
        chatLine(`&7  ${abs}`);
    } catch (err) {
        chatLine(`&c[htsw] Couldn't open projects folder: ${String(err)}`);
        chatLine(`&7  ${abs}`);
    }
}
