// Waits for the Vite dev server, then launches Electron pointed at it.
const { spawn } = require("child_process");
const waitOn = require("wait-on");
const path = require("path");

waitOn({ resources: ["http://localhost:5173"], timeout: 30000 }).then(() => {
  const electronBin = require("electron");
  const child = spawn(electronBin, [path.join(__dirname, "..")], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: "http://localhost:5173" }
  });
  child.on("exit", (code) => process.exit(code));
}).catch((err) => {
  console.error("Vite dev server did not start:", err);
  process.exit(1);
});
