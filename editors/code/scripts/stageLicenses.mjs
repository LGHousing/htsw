import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

copyFileSync(
    `${repositoryRoot}docs/legal/third-party-licenses.txt`,
    `${extensionRoot}THIRD_PARTY_NOTICES.txt`,
);
