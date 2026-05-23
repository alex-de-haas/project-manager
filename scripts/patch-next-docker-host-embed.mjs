import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const chunksDir = join(process.cwd(), ".next", "static", "chunks");
const files = (await readdir(chunksDir)).filter((file) => file.endsWith(".js"));

const assetSuffixNeedle =
  'let t="/_next/",r=function(){if(null!=self.TURBOPACK_ASSET_SUFFIX)return self.TURBOPACK_ASSET_SUFFIX;let e=document?.currentScript?.getAttribute?.("src")??"",t=e.indexOf("?");return t>=0?e.slice(t):""}(),';

const assetSuffixReplacement =
  'let dh=null,t="/_next/",r=function(){if(null!=self.TURBOPACK_ASSET_SUFFIX)return self.TURBOPACK_ASSET_SUFFIX;let e=document?.currentScript?.getAttribute?.("src")??"";try{let t=new URL(e,location.href),r=t.pathname.match(/^\\\\/api\\\\/apps\\\\/([^/]+)\\\\/embed\\\\/?$/),n=t.searchParams.get("path");if(r&&n?.startsWith("/_next/"))return dh={moduleId:r[1],embedToken:t.searchParams.get("embedToken")},""}catch(e){}let n=e.indexOf("?");return n>=0?e.slice(n):""}(),';

const urlBuilderNeedle =
  'function N(e){return`${t}${e.split("/").map(e=>encodeURIComponent(e)).join("/")}${r}`}';

const urlBuilderReplacement =
  'function N(e){let n=`${t}${e.split("/").map(e=>encodeURIComponent(e)).join("/")}${r}`;return dh?"/api/apps/"+dh.moduleId+"/embed?path="+encodeURIComponent(n)+(dh.embedToken?"&embedToken="+encodeURIComponent(dh.embedToken):""):n}';

if (files.length === 0) {
  throw new Error("No Next.js chunks found to patch.");
}

let patched = 0;
for (const file of files) {
  const path = join(chunksDir, file);
  const source = await readFile(path, "utf8");
  let nextSource = source;
  const didPatchRuntime =
    nextSource.includes(assetSuffixNeedle) && nextSource.includes(urlBuilderNeedle);

  if (didPatchRuntime) {
    nextSource = nextSource
      .replace(assetSuffixNeedle, assetSuffixReplacement)
      .replace(urlBuilderNeedle, urlBuilderReplacement);
    patched += 1;
  }

  if (nextSource !== source) {
    await writeFile(path, nextSource);
  }
}

if (patched === 0) {
  throw new Error("Turbopack runtime chunk did not match the Docker Host embed patch target.");
}

console.log(`Patched ${patched} Turbopack runtime chunk(s) for Docker Host embed assets.`);
