import * as path from "node:path";
import * as fs from "node:fs";
import type { ProjectFs } from "htsw-editor-common/project";

export const nodeProjectFs: ProjectFs = {
    exists(filePath: string): boolean {
        return fs.existsSync(filePath);
    },

    readFile(filePath: string): string {
        return fs.readFileSync(filePath, "utf8");
    },

    writeFile(filePath: string, text: string): void {
        fs.writeFileSync(filePath, text, "utf8");
    },

    ensureDir(dirPath: string): void {
        fs.mkdirSync(dirPath, { recursive: true });
    },

    parentDir(filePath: string): string {
        return path.dirname(filePath);
    },

    resolvePath(baseDir: string, ref: string): string {
        return path.resolve(baseDir, ref);
    },

    pathKey(filePath: string): string {
        const normalized = path.resolve(filePath).split("\\").join("/");
        return process.platform === "win32" ? normalized.toLowerCase() : normalized;
    },

    deleteFile(filePath: string): void {
        fs.unlinkSync(filePath);
    },
};
