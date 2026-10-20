// Produces vendor/omniroute: a pinned, unmodified OmniRoute build trimmed to
// the files its server actually loads (traced with @vercel/nft), plus its
// license notices. The app runs this server itself.
//
//   node scripts/prepare-omniroute.mjs              # (re)build vendor/omniroute
//   node scripts/prepare-omniroute.mjs --if-missing # only when absent or a different version
import { nodeFileTrace } from "@vercel/nft";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const OMNIROUTE_VERSION = "3.8.52";

const root = resolve(".");
const work = join(root, "vendor-build"); // full npm install (scratch, gitignored)
const out = join(root, "vendor", "omniroute");
const marker = join(out, "VERSION");

if (process.argv.includes("--if-missing") && existsSync(marker) && readFileSync(marker, "utf8").trim() === OMNIROUTE_VERSION) process.exit(0);

console.log(`Preparing OmniRoute ${OMNIROUTE_VERSION} (one-time, takes a few minutes)…`);
const pkgDir = join(work, "node_modules", "omniroute");
if (!existsSync(join(pkgDir, "package.json")) || JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version !== OMNIROUTE_VERSION) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "package.json"), '{"name":"omniroute-vendor-build","private":true}');
  // Optional deps (local ML runtimes, native SQLite, keychain) are not needed:
  // the server falls back to Node's built-in node:sqlite.
  const r = spawnSync("npm", ["install", `omniroute@${OMNIROUTE_VERSION}`, "--omit=optional", "--omit=dev", "--no-audit", "--no-fund"], { cwd: work, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function listFiles(dir) {
  const res = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) res.push(...listFiles(p));
    else if (e.isFile()) res.push(p);
  }
  return res;
}

const dist = join(pkgDir, "dist");
const distFiles = listFiles(dist);
const entries = distFiles.filter((f) => /\.(c|m)?js$/.test(f) && !f.includes(`${sep}static${sep}`) && !f.includes(`${sep}public${sep}`));
console.log(`Tracing ${entries.length} server files…`);
const { fileList } = await nodeFileTrace(entries, { base: work, processCwd: dist, mixedModules: true });

const files = new Set([...distFiles.map((f) => relative(work, f)), ...fileList]);
// Keep each traced package's package.json so module resolution still works.
for (const f of [...files]) {
  const m = f.match(/^(.*?node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/);
  if (m) files.add(join(m[1], "package.json"));
}
for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.md", "package.json"]) files.add(join("node_modules", "omniroute", notice));

rmSync(out, { recursive: true, force: true });
let bytes = 0;
for (const rel of files) {
  const src = join(work, rel);
  if (!existsSync(src) || !statSync(src).isFile()) continue;
  const dst = join(out, rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  bytes += statSync(src).size;
}
writeFileSync(marker, OMNIROUTE_VERSION + "\n");
console.log(`vendor/omniroute ready: ${files.size} files, ${(bytes / 1e6).toFixed(0)} MB`);
