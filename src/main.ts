/**
 * Browser entry point: mounts the app shell and registers the service worker.
 * Covered by the Playwright E2E suite rather than unit tests.
 */
import { registerSW } from "virtual:pwa-register";

import { renderApp } from "./app";
import "./styles.css";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Warmly: #app mount point is missing from index.html");
}
renderApp(root);

// registerType is "prompt": a new version waits until the app chooses to
// activate it, so an update can never interrupt an unsaved draft.
registerSW({ immediate: true });
