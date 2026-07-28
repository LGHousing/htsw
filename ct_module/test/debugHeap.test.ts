import { afterEach, describe, expect, test, vi } from "vitest";

import { commandHeap } from "../src/slashCommands/debugHeap";

const chat = vi.fn();

afterEach(() => {
    vi.unstubAllGlobals();
    chat.mockReset();
});

function stubChat(): void {
    vi.stubGlobal("ChatLib", { chat });
}

describe("commandHeap", () => {
    test("reads Rhino's GC bean array by length and index", () => {
        stubChat();
        vi.stubGlobal("Java", {
            type: (name: string) => {
                if (name === "java.lang.Runtime") {
                    return {
                        getRuntime: () => ({
                            totalMemory: () => 300 * 1024 * 1024,
                            freeMemory: () => 100 * 1024 * 1024,
                            maxMemory: () => 400 * 1024 * 1024,
                        }),
                    };
                }
                if (name === "java.lang.management.ManagementFactory") {
                    return {
                        getMemoryMXBean: () => ({
                            getNonHeapMemoryUsage: () => ({
                                getUsed: () => 50 * 1024 * 1024,
                                getCommitted: () => 80 * 1024 * 1024,
                            }),
                        }),
                        getGarbageCollectorMXBeans: () => [
                            {
                                getName: () => "Copy",
                                getCollectionCount: () => 12,
                                getCollectionTime: () => 34,
                            },
                        ],
                    };
                }
                throw new Error(`Unexpected Java type: ${name}`);
            },
        });

        commandHeap([]);

        expect(chat).toHaveBeenCalledWith(
            "&7[heap] Java heap used &f200.0 MB&7 / committed &f300.0 MB&7 / limit &f400.0 MB"
        );
        expect(chat).toHaveBeenCalledWith(
            "&7[heap] GC &fCopy&7: &f12&7 collections, &f34 ms&7 total"
        );
        expect(chat).not.toHaveBeenCalledWith(expect.stringContaining("InternalError"));
    });

    test.each([
        { mode: "live", expectedLive: true },
        { mode: "all", expectedLive: false },
    ])("dumps $mode objects without Java.to", ({ mode, expectedLive }) => {
        stubChat();
        const dumpHeap = vi.fn();
        const hotSpotDiagnosticClass = {};

        class FakeFile {
            constructor(readonly path: string) {}

            getAbsolutePath(): string {
                return `/absolute/${this.path}`;
            }

            getParentFile(): { mkdirs(): boolean } {
                return { mkdirs: () => true };
            }

            length(): number {
                return 25 * 1024 * 1024;
            }
        }

        vi.stubGlobal("Java", {
            type: (name: string) => {
                if (name === "java.io.File") return FakeFile;
                if (name === "com.sun.management.HotSpotDiagnosticMXBean") {
                    return hotSpotDiagnosticClass;
                }
                if (name === "java.lang.management.ManagementFactory") {
                    return {
                        getPlatformMXBean: (beanClass: unknown) => {
                            expect(beanClass).toBe(hotSpotDiagnosticClass);
                            return { dumpHeap };
                        },
                    };
                }
                throw new Error(`Unexpected Java type: ${name}`);
            },
        });

        commandHeap(["dump", mode]);

        expect(dumpHeap).toHaveBeenCalledOnce();
        expect(dumpHeap.mock.calls[0][0]).toMatch(
            /^\/absolute\/\.\/htsw\/htsw-heap-\d+\.hprof$/
        );
        expect(dumpHeap.mock.calls[0][1]).toBe(expectedLive);
        expect(chat).toHaveBeenLastCalledWith(
            expect.stringMatching(/^&a\[heap\] wrote .*&7\(25\.0 MB\)$/)
        );
    });
});
