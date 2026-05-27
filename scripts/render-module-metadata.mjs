import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) {
    throw new Error(
      "Usage: node scripts/render-module-metadata.mjs --tag <image-tag> --output <path> [--repository <image-repository>]"
    );
  }
  args.set(key.slice(2), value);
}

const tag = args.get("tag");
const outputPath = args.get("output");
const repository = args.get("repository");

if (!tag || !outputPath) {
  throw new Error("Both --tag and --output are required");
}

const metadataPath = path.join(process.cwd(), "metadata.json");
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

const updateImage = (image) => {
  if (!image || typeof image !== "object") {
    return;
  }

  if (repository && image.repository) {
    image.repository = repository;
  }
  if (image.tag) {
    image.tag = tag;
  }
};

for (const container of metadata.containers ?? []) {
  updateImage(container?.image);
}

for (const service of metadata.services ?? []) {
  if (service?.source?.type === "image") {
    updateImage(service.source.image);
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
