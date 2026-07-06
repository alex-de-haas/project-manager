import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const usage =
  "Usage: node scripts/render-app-manifest.mjs --tag <image-tag> --output <path> [--repository <image-repository>]";

let values;
try {
  ({ values } = parseArgs({
    options: {
      tag: { type: "string" },
      output: { type: "string" },
      repository: { type: "string" },
    },
  }));
} catch {
  throw new Error(usage);
}

const { tag, output: outputPath, repository } = values;

if (!tag || !outputPath) {
  throw new Error("Both --tag and --output are required");
}

const manifestPath = path.join(process.cwd(), "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Single-source the app version from package.json so the published manifest can never advertise
// a version the artifact doesn't carry (the "footer shows wrong version" drift class).
const packageJsonPath = path.join(process.cwd(), "package.json");
const { version: packageVersion } = JSON.parse(
  fs.readFileSync(packageJsonPath, "utf8")
);
if (!packageVersion) {
  throw new Error("package.json is missing a version to stamp into the manifest");
}
manifest.version = packageVersion;

const updateImage = (runtime) => {
  if (!runtime || typeof runtime !== "object" || !("image" in runtime)) {
    return;
  }

  if (typeof runtime.image === "string") {
    if (runtime.image.includes("@")) {
      throw new Error(
        "Digest image references are not supported by the release manifest renderer; use an image object with repository and tag."
      );
    }

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
