import { FileSystemFileLoader } from "./helpers";

function readDotEnv(key: string): string | null {
    // HAHAHA dont care!
    const envContent = new FileSystemFileLoader().readFile(".env");
    const lines = envContent.split("\n");
    for (const line of lines) {
        const [k, v] = line.split("=");
        if (k.trim() === key) {
            return v.trim();
        }
    }
    return null;
}

function readStreamAsync(stream: any): { out: string; thread: any } {
    const BufferedReader = Java.type("java.io.BufferedReader");
    const InputStreamReader = Java.type("java.io.InputStreamReader");
    const StringBuilder = Java.type("java.lang.StringBuilder");
    const Runnable = Java.type("java.lang.Runnable");
    const Thread = Java.type("java.lang.Thread");

    const sb = new StringBuilder();

    const thread = new Thread(
        new Runnable({
            run: () => {
                try {
                    const br = new BufferedReader(new InputStreamReader(stream));
                    let line: string;
                    while ((line = br.readLine()) !== null) {
                        sb.append(line).append("\n");
                    }
                } catch (e) {
                    // ignore read errors when process exits
                }
            },
        })
    );

    thread.start();
    return {
        get out() {
            return sb.toString();
        },
        thread,
    };
}

function runOSCommandBlocking(command: string): string {
    ChatLib.chat("&aRunning OS command");
    const Runtime = Java.type("java.lang.Runtime");

    try {
        const process = Runtime.getRuntime().exec(command);

        // Start draining output immediately (prevents hanging)
        const stdout = readStreamAsync(process.getInputStream());
        const stderr = readStreamAsync(process.getErrorStream());

        // Wait for completion (no busy loop needed)
        const exitCode = process.waitFor();

        // Ensure gobblers finished
        stdout.thread.join();
        stderr.thread.join();

        ChatLib.chat(
            `&${exitCode === 0 ? "a" : "c"}Command finished with exit code &f${exitCode}`
        );

        const out = stdout.out;
        const err = stderr.out;

        if (exitCode !== 0) {
            throw new Error(err + "\n" + out);
        }

        return out;
    } catch (e) {
        throw new Error(`Failed to run command: ${e}`);
    }
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
            try {
                runOSCommandBlocking(`python "${repoPath}\\ct_module\\install.py"`);
            } catch (error) {
                ChatLib.chat(`&cProcess error: ${error}`.replace(/\n/g, "\n&c"));
                return;
            }
            ChatLib.chat("&aRecompilation successful");
            Thread.sleep(500);
            ChatLib.command("ct reload", true);
        },
    });

    new Thread(task).start();
}
