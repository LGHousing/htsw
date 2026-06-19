import styles from "./styles.css?inline";
import { mountItemEditor } from "./ui";

const style = document.createElement("style");
style.textContent = styles;
document.head.appendChild(style);

const app = document.getElementById("app");
if (app) {
    mountItemEditor(app, acquireVsCodeApi());
}
