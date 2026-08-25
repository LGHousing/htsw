import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/filesystem", () => ({
    atomicWriteText: (path: string, value: string) => {
        try {
            FileLib.write(path, value, true);
            return true;
        } catch (_e) {
            return false;
        }
    },
}));

const CONSENT_FILE = "./htsw/.settings/prune-consent.json";
const manifest = "./projects/demo/import.json";
const otherManifest = "./projects/other/import.json";
const HOUSE = "house-1";
const OTHER_HOUSE = "house-2";

describe("prune consent", () => {
    let files: Map<string, string>;

    function stubFiles(): void {
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files.has(path),
            read: (path: string) => files.get(path) ?? null,
            write: (path: string, value: string) => files.set(path, value),
            delete: (path: string) => files.delete(path),
        });
    }

    function loadConsent() {
        return import("../src/prune/consent");
    }

    beforeEach(() => {
        vi.resetModules();
        files = new Map();
        stubFiles();
    });

    it("withholds consent until it is granted", async () => {
        const { grantPruneConsent, hasPruneConsent } = await loadConsent();

        expect(hasPruneConsent(manifest, HOUSE)).toBe(false);
        expect(grantPruneConsent(manifest, HOUSE)).toBe(true);
        expect(hasPruneConsent(manifest, HOUSE)).toBe(true);
    });

    it("does not carry consent to another house or another project", async () => {
        const { grantPruneConsent, hasPruneConsent } = await loadConsent();
        grantPruneConsent(manifest, HOUSE);

        expect(hasPruneConsent(manifest, OTHER_HOUSE)).toBe(false);
        expect(hasPruneConsent(otherManifest, HOUSE)).toBe(false);
    });

    it("forgets consent when it is revoked", async () => {
        const { grantPruneConsent, hasPruneConsent, revokePruneConsent } =
            await loadConsent();
        grantPruneConsent(manifest, HOUSE);

        expect(revokePruneConsent(manifest, HOUSE)).toBe(true);
        expect(hasPruneConsent(manifest, HOUSE)).toBe(false);
    });

    it("survives a reload", async () => {
        const first = await loadConsent();
        first.grantPruneConsent(manifest, HOUSE);
        expect(files.has(CONSENT_FILE)).toBe(true);

        vi.resetModules();
        const second = await loadConsent();

        expect(second.hasPruneConsent(manifest, HOUSE)).toBe(true);
    });

    // failing closed costs one prompt; failing open deletes a house
    it("refuses consent from an unreadable document", async () => {
        files.set(CONSENT_FILE, "{not json");
        const { grantPruneConsent, hasPruneConsent } = await loadConsent();

        expect(hasPruneConsent(manifest, HOUSE)).toBe(false);
        expect(grantPruneConsent(manifest, HOUSE)).toBe(false);
    });
});
