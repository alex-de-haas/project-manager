import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) {
    throw new Error(
      "Usage: node scripts/render-app-manifest.mjs --tag <image-tag> --output <path> [--repository <image-repository>]"
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

const manifestPath = path.join(process.cwd(), "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const updateImage = (runtime) => {
  if (!runtime || typeof runtime !== "object" || !("image" in runtime)) {
    return;
  }

  if (typeof runtime.image === "string") {
    const lastSlash = runtime.image.lastIndexOf("/");
    const lastColon = runtime.image.lastIndexOf(":");
    const existingRepository =
      lastColon > lastSlash ? runtime.image.slice(0, lastColon) : runtime.image;
    const imageRepository = repository || existingRepository;
    runtime.image = `${imageRepository || runtime.image}:${tag}`;
    return;
  }

  if (!runtime.image || typeof runtime.image !== "object") {
    return;
  }

  if (repository && runtime.image.repository) {
    runtime.image.repository = repository;
  }
  if (runtime.image.tag) {
    runtime.image.tag = tag;
  }
};

for (const service of manifest.services ?? []) {
  for (const runtime of Object.values(service?.runtimes ?? {})) {
    updateImage(runtime);
  }
}

for (const runtime of manifest.runtimes ?? []) {
  updateImage(runtime);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
