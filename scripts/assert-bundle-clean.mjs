import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const forbidden = [
  "XAI_API_KEY",
  "AUTH_GOOGLE_SECRET",
  "FAL_KEY",
  "FAL_API_KEY",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "AWS_SECRET_ACCESS_KEY",
];
const textExt = new Set([".js", ".css", ".html", ".map", ".json", ".txt", ".svg"]);

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.error(`dist is missing: ${dir}`);
      process.exit(1);
    }
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

const files = await walk(distDir);
if (files.length === 0) {
  console.error(`dist is empty: ${distDir}`);
  process.exit(1);
}

const hits = [];

for (const file of files) {
  if (!textExt.has(extname(file))) {
    continue;
  }
  const text = await readFile(file, "utf8");
  for (const token of forbidden) {
    if (text.includes(token)) {
      hits.push(`${file}: ${token}`);
    }
  }
}

if (hits.length > 0) {
  console.error("Provider secrets found in dist:");
  for (const hit of hits) {
    console.error(`  ${hit}`);
  }
  process.exit(1);
}

console.log(`dist is clean (${files.length} files)`);
