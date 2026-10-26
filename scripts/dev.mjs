import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev", "-w", "server"], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn("npm", ["run", "dev", "-w", "client"], { stdio: "inherit", shell: process.platform === "win32" }),
];

let shuttingDown = false;
function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
for (const child of children) {
  child.on("exit", (code) => {
    if (!shuttingDown && code && code !== 0) {
      shutdown();
      process.exitCode = code;
    }
  });
}
