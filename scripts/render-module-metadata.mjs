import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) {
    throw new Error("Usage: node scripts/render-module-metadata.mjs --tag <image-tag> --output <path>");
  }
  args.set(key.slice(2), value);
}

const tag = args.get("tag");
const outputPath = args.get("output");

if (!tag || !outputPath) {
  throw new Error("Both --tag and --output are required");
}

const metadataPath = path.join(process.cwd(), "metadata.json");
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

for (const container of metadata.containers ?? []) {
  if (container?.image?.tag) {
    container.image.tag = tag;
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
