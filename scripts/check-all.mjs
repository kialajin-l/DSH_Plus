/**
 * Syntax-check every plugin's host and browser entries.
 *
 * Usage: npm run check
 */
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const entries = await readdir(root, { withFileTypes: true });
const failures = [];

function check(file) {
  return new Promise((resolve) => {
    if (!existsSync(file)) return resolve(true);
    const child = spawn(process.execPath, ["--check", file], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code === 0));
  });
}

for (const entry of entries) {
  if (!entry.isDirectory() || !entry.name.startsWith("dsh-")) continue;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, entry.name, "package.json"), "utf8"));
  } catch {
    continue;
  }
  console.log(`\n==> ${manifest.name}@${manifest.version}`);
  for (const file of ["lib/index.js", "client/client.js"]) {
    const target = join(root, entry.name, file);
    const ok = await check(target);
    console.log(`  ${ok ? "ok  " : "FAIL"} ${file}`);
    if (!ok) failures.push(`${entry.name}/${file}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} file(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nall entries parse cleanly");
