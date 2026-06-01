// Vitest workspace config — tells the VSCode Vitest extension which
// subprojects actually have tests. Without this, the extension probes
// every `vite.config.ts` in the repo (cli/, editors/code/, ...) and
// emits noisy "Vitest not found" errors for the ones that bundle but
// don't test.
export default ["./language", "./ct_module"];
