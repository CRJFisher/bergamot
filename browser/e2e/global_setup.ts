import { execSync } from "child_process";

// Builds the extension once before the e2e run. `build:test` injects a free
// MOCK_PKM_PORT into the bundle, writes it to test-port.txt, and copies the
// built dist into chrome/ so the persistent context can load the extension.
export default function global_setup() {
  console.log("Building extension for e2e (build:test)...");
  execSync("npm run build:test", { stdio: "inherit" });
}
