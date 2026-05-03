import { FileSystemFileLoader } from "./utils/files";

function readDotEnv(key: string): string | null {
    // .env lives next to this CT module at install time, not at the MC
    // root, so point the loader at the explicit location. (FileSystemFileLoader
    // is now MC-root-rooted.)
    const envPath = "./config/ChatTriggers/modules/HTSW/.env";
    const envContent = new FileSystemFileLoader().readFile(envPath);
    const lines = envContent.split("\n");
    for (const line of lines) {
        const [k, v] = line.split("=");
        if (k.trim() === key) {
            return v.trim();
        }
    }
    return null;
}

const MC_COLORS: { code: string; r: number; g: number; b: number }[] = [
    { code: "&0", r: 0, g: 0, b: 0 },
    { code: "&1", r: 0, g: 0, b: 170 },
    { code: "&2", r: 0, g: 170, b: 0 },
    { code: "&3", r: 0, g: 170, b: 170 },
    { code: "&4", r: 170, g: 0, b: 0 },
    { code: "&5", r: 170, g: 0, b: 170 },
    { code: "&6", r: 255, g: 170, b: 0 },
    { code: "&7", r: 170, g: 170, b: 170 },
    { code: "&8", r: 85, g: 85, b: 85 },
    { code: "&9", r: 85, g: 85, b: 255 },
    { code: "&a", r: 85, g: 255, b: 85 },
    { code: "&b", r: 85, g: 255, b: 255 },
    { code: "&c", r: 255, g: 85, b: 85 },
    { code: "&d", r: 255, g: 85, b: 255 },
    { code: "&e", r: 255, g: 255, b: 85 },
    { code: "&f", r: 255, g: 255, b: 255 },
];

function closestMcColor(r: number, g: number, b: number): string {
    let bestDist = Infinity;
    let bestCode = "&f";
    for (const mc of MC_COLORS) {
        const dr = r - mc.r;
        const dg = g - mc.g;
        const db = b - mc.b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            bestCode = mc.code;
        }
    }
    return bestCode;
}

function ansi256ToRgb(index: number): [number, number, number] {
    // Standard 16 colors
    if (index < 16) {
        const lut: [number, number, number][] = [
            [0, 0, 0],
            [170, 0, 0],
            [0, 170, 0],
            [170, 170, 0],
            [0, 0, 170],
            [170, 0, 170],
            [0, 170, 170],
            [170, 170, 170],
            [85, 85, 85],
            [255, 85, 85],
            [85, 255, 85],
            [255, 255, 85],
            [85, 85, 255],
            [255, 85, 255],
            [85, 255, 255],
            [255, 255, 255],
        ];
        return lut[index];
    }
    // 6×6×6 color cube (indices 16–231)
    if (index < 232) {
        const ci = index - 16;
        const ri = Math.floor(ci / 36);
        const gi = Math.floor((ci % 36) / 6);
        const bi = ci % 6;
        return [
            ri === 0 ? 0 : 55 + ri * 40,
            gi === 0 ? 0 : 55 + gi * 40,
            bi === 0 ? 0 : 55 + bi * 40,
        ];
    }
    // Grayscale ramp (indices 232–255)
    const v = (index - 232) * 10 + 8;
    return [v, v, v];
}

const ANSI_FG_TO_MC: Record<number, string> = {
    30: "&0",
    31: "&4",
    32: "&2",
    33: "&6",
    34: "&1",
    35: "&5",
    36: "&3",
    37: "&7",
    90: "&8",
    91: "&c",
    92: "&a",
    93: "&e",
    94: "&9",
    95: "&d",
    96: "&b",
    97: "&f",
};

/**
 * Replace every ANSI SGR escape sequence with the closest
 * Minecraft `&` formatting code(s).
 *
 * Handles:
 *  - Basic 8 + bright 8 foreground colors  (30-37, 90-97)
 *  - 256-color palette                     (38;5;N)
 *  - 24-bit true-color                     (38;2;R;G;B)
 *  - Bold, italic, underline, strikethrough, reset
 *  - Background codes are silently ignored (MC has no bg)
 *  - Non-SGR ANSI sequences are stripped
 */
function ansiToMinecraft(text: string): string {
    const converted = text.replace(
        /\x1b\[([0-9;]*)m/g,
        (_match: string, params: string) => {
            if (!params || params === "0") return "&r";

            const codes = params.split(";").map(Number);
            let result = "";
            let i = 0;

            while (i < codes.length) {
                const c = codes[i];

                if (c === 0) {
                    result += "&r";
                } else if (c === 1) {
                    result += "&l"; // Bold
                } else if (c === 3) {
                    result += "&o"; // Italic
                } else if (c === 4) {
                    result += "&n"; // Underline
                } else if (c === 9) {
                    result += "&m"; // Strikethrough
                } else if (c === 22 || c === 23 || c === 24 || c === 29) {
                    // Reset individual attrs – no MC equivalent, ignore
                } else if (c === 39) {
                    result += "&r"; // Default foreground
                } else if (ANSI_FG_TO_MC[c] !== undefined) {
                    result += ANSI_FG_TO_MC[c];
                } else if (c === 38) {
                    // Extended foreground: 38;5;N  or  38;2;R;G;B
                    if (codes[i + 1] === 5 && i + 2 < codes.length) {
                        const [r, g, b] = ansi256ToRgb(codes[i + 2]);
                        result += closestMcColor(r, g, b);
                        i += 2;
                    } else if (codes[i + 1] === 2 && i + 4 < codes.length) {
                        result += closestMcColor(
                            codes[i + 2],
                            codes[i + 3],
                            codes[i + 4]
                        );
                        i += 4;
                    }
                } else if (c === 48) {
                    // Extended background – skip its sub-params
                    if (codes[i + 1] === 5) i += 2;
                    else if (codes[i + 1] === 2) i += 4;
                }
                // 40-47, 100-107: basic backgrounds – silently ignored
                i++;
            }

            return result;
        }
    );

    // Strip any remaining non-SGR ANSI sequences (cursor movement, etc.)
    return converted.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, "");
}

/**
 * Spawn a thread that reads `stream` line-by-line and sends each line
 * to Minecraft chat with ANSI→MC conversion applied.
 *
 * @param stream  Java InputStream (stdout or stderr of a Process)
 * @param prefix  Formatting prefix prepended to every line (e.g. "&c" for stderr)
 * @returns       The Java Thread so the caller can `.join()` it later.
 */
function streamToChat(stream: any, prefix: string): any {
    const BufferedReader = Java.type("java.io.BufferedReader");
    const InputStreamReader = Java.type("java.io.InputStreamReader");
    const Runnable = Java.type("java.lang.Runnable");
    const Thread = Java.type("java.lang.Thread");

    const thread = new Thread(
        new Runnable({
            run: () => {
                try {
                    const br = new BufferedReader(new InputStreamReader(stream));
                    let line: string;
                    while ((line = br.readLine()) !== null) {
                        const formatted = ansiToMinecraft(line);
                        if (formatted.trim().length > 0) {
                            ChatLib.chat(prefix + formatted);
                        }
                    }
                } catch (_) {
                    // stream closed – expected when the process exits
                }
            },
        })
    );

    thread.start();
    return thread;
}

/**
 * Run an OS command, streaming both stdout and stderr to Minecraft chat
 * in real time with ANSI colors converted to Minecraft formatting.
 *
 * @returns The process exit code.
 */
function runOSCommandStreaming(command: string[]): number {
    ChatLib.chat("&aRunning: &7" + command.map(quoteCommandArg).join(" "));

    const ProcessBuilder = Java.type("java.lang.ProcessBuilder");
    const ArrayList = Java.type("java.util.ArrayList");

    const args = new ArrayList();
    for (const arg of command) {
        args.add(arg);
    }

    const pb = new ProcessBuilder(args);
    const process = pb.start();

    // Stream both pipes to chat concurrently
    const stdoutThread = streamToChat(process.getInputStream(), "");
    const stderrThread = streamToChat(process.getErrorStream(), "&c");

    const exitCode = process.waitFor();

    // Wait for reader threads to finish draining
    stdoutThread.join();
    stderrThread.join();

    ChatLib.chat(
        `&${exitCode === 0 ? "a" : "c"}Command finished with exit code &f${exitCode}`
    );

    return exitCode;
}

function quoteCommandArg(arg: string): string {
    return /\s/.test(arg) ? `"${arg}"` : arg;
}

export function recompile() {
    const repoPath = readDotEnv("HTSW_REPOSITORY_PATH");
    if (!repoPath) {
        ChatLib.chat("&cHTSW_REPOSITORY_PATH is not set in .env");
        return;
    }

    const Runnable = Java.type("java.lang.Runnable");
    const Thread = Java.type("java.lang.Thread");

    const task = new Runnable({
        run: function () {
            ChatLib.chat("&aRecompiling...");
            const exitCode = runOSCommandStreaming([
                "python",
                `${repoPath}\\ct_module\\install.py`,
            ]);
            if (exitCode !== 0) {
                ChatLib.chat(`&cRecompilation failed (exit code ${exitCode})`);
                return;
            }
            ChatLib.chat("&aRecompilation successful");
            Thread.sleep(500);
            ChatLib.command("ct reload", true);
        },
    });

    new Thread(task).start();
}
