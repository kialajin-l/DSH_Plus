/**
 * Pack every plugin in this repository into dist/<name>-<version>.tgz.
 *
 * Usage: npm run pack:all
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dist = join(root, "dist");

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

const entries = await readdir(root, { withFileTypes: true });
const packages = [];
for (const entry of entries) {
  if (!entry.isDirectory() || !entry.name.startsWith("dsh-")) continue;
  try {
    const manifest = JSON.parse(await readFile(join(root, entry.name, "package.json"), "utf8"));
    packages.push({ dir: entry.name, name: manifest.name, version: manifest.version });
  } catch {
    // Not a plugin directory.
  }
}

if (packages.length === 0) {
  console.error("no plugins found");
  process.exit(1);
}

await mkdir(dist, { recursive: true });
for (const pkg of packages) {
  console.log(`\n==> packing ${pkg.name}@${pkg.version}`);
  await run("npm", ["pack", "--pack-destination", dist], join(root, pkg.dir));
}
console.log(`\npacked ${packages.length} plugin(s) into ${dist}`);
