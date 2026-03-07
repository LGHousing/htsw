import { defineConfig } from "vite";

export default defineConfig({
    build: {
        target: "node22",
        lib: {
            entry: "./src/main.ts",
            formats: ["es"],
        },
        rollupOptions: {
            external: [
                "node:fs",
                "node:path",
                "node:url",
            ],
        },
    }
});
