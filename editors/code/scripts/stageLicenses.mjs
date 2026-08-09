import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

for (const name of ["THIRD_PARTY_NOTICES.txt", "Apache-2.0.txt"]) {
    copyFileSync(`${repositoryRoot}${name}`, `${extensionRoot}${name}`);
}
