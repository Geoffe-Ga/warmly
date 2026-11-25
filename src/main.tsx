/**
 * Browser entry point: mounts the app shell and registers the service worker.
 * Covered by the Playwright E2E suite rather than unit tests.
 */
import { render } from "preact";
import { registerSW } from "virtual:pwa-register";

import { App } from "./app/App";
import { appUpdates } from "./app/updates";
import "./styles.css";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Warmly: #app mount point is missing from index.html");
}
render(<App />, root);

// registerType is "prompt": a new version waits until the person asks for
// it, so an update can never reload the page under an unsaved draft. The
// app shell shows that one is ready and saves unsaved work before switching.
const activate = registerSW({
  immediate: true,
  onNeedRefresh() {
    appUpdates.offer(() => activate(true));
  },
});

if (import.meta.env.MODE !== "production") {
  // A browser test cannot publish a new build half-way through, so outside
  // production a test can say that a version is waiting. Switching to it
  // reloads the page, as the real one does.
  window.addEventListener("warmly:test-update-ready", () => {
    appUpdates.offer(() => {
      window.location.reload();
      return Promise.resolve();
    });
  });
}
