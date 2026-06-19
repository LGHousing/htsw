import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Uri } from "vscode";
import {
    downloadObject,
    fetchAssetIndex,
    fetchSoundsJson,
    fetchVersionJson,
    resolveSoundObject,
    verifySha1,
} from "./mojangAssets";
import type { SoundVersionId } from "../webview/protocol";

export type CachedSound = {
    fileUri: Uri;
    variants: string[];
};

export class SoundCache {
    private readonly rootPath: string;

    public constructor(rootUri: Uri) {
        this.rootPath = rootUri.fsPath;
    }

    public cacheRootUri(): Uri {
        return Uri.file(this.rootPath);
    }

    public async ensureSound(version: SoundVersionId, eventName: string): Promise<CachedSound> {
        const versionData = await this.ensureVersionData(version);
        const resolved = resolveSoundObject(versionData.index, versionData.sounds, eventName);
        const objectPath = this.objectPath(resolved.hash);
        if (!(await verifySha1(objectPath, resolved.hash))) {
            await downloadObject(resolved.hash, objectPath);
        }
        return {
            fileUri: Uri.file(objectPath),
            variants: resolved.variants,
        };
    }

    private async ensureVersionData(version: SoundVersionId): Promise<{
        index: Parameters<typeof resolveSoundObject>[0];
        sounds: Parameters<typeof resolveSoundObject>[1];
    }> {
        const dir = path.join(this.rootPath, "versions", version);
        const versionPath = path.join(dir, "version.json");
        const indexPath = path.join(dir, "index.json");
        const soundsPath = path.join(dir, "sounds.json");

        await fs.mkdir(dir, { recursive: true });

        let versionJson = await readJson(versionPath);
        if (!versionJson) {
            versionJson = await fetchVersionJson(version);
            await writeJson(versionPath, versionJson);
        }

        let index = await readJson(indexPath);
        if (!index) {
            index = await fetchAssetIndex(versionJson);
            await writeJson(indexPath, index);
        }

        let sounds = await readJson(soundsPath);
        if (!sounds) {
            sounds = await fetchSoundsJson(index);
            await writeJson(soundsPath, sounds);
        }

        return { index, sounds };
    }

    private objectPath(hash: string): string {
        return path.join(this.rootPath, "objects", `${hash}.ogg`);
    }
}

async function readJson(filePath: string): Promise<any | null> {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
        return null;
    }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}
