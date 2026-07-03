import styles from "./styles.css?inline";
import { mountSoundPreviewer } from "./ui";
import { installTooltips } from "../tooltip";

const style = document.createElement("style");
style.textContent = styles;
document.head.appendChild(style);

const app = document.getElementById("app");
if (app) {
    installTooltips();
    mountSoundPreviewer(app, acquireVsCodeApi());
}
