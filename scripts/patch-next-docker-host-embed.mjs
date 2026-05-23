import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const chunksDir = join(process.cwd(), ".next", "static", "chunks");
const files = (await readdir(chunksDir)).filter((file) => file.endsWith(".js"));

const assetSuffixNeedle =
  'let t="/_next/",r=function(){if(null!=self.TURBOPACK_ASSET_SUFFIX)return self.TURBOPACK_ASSET_SUFFIX;let e=document?.currentScript?.getAttribute?.("src")??"",t=e.indexOf("?");return t>=0?e.slice(t):""}(),';

const assetSuffixReplacement =
  'let dh=null,t="/_next/",r=function(){if(null!=self.TURBOPACK_ASSET_SUFFIX)return self.TURBOPACK_ASSET_SUFFIX;let e=document?.currentScript?.getAttribute?.("src")??"";try{let t=new URL(e,location.href),r=t.pathname.match(/^\\/api\\/apps\\/((?:dev\\/)?[^/]+)\\/embed(?:\\/(.*))?\\/?$/),n=t.searchParams.get("path"),o=r?.[2]??"";if(r&&n?.startsWith("/_next/"))return dh={appPath:r[1],embedToken:t.searchParams.get("embedToken"),mode:"query"},"";if(r&&o.startsWith("_next/"))return dh={appPath:r[1],embedToken:t.searchParams.get("embedToken"),mode:"path"},""}catch(e){}let n=e.indexOf("?");return n>=0?e.slice(n):""}(),';

const urlBuilderNeedle =
  'function N(e){return`${t}${e.split("/").map(e=>encodeURIComponent(e)).join("/")}${r}`}';

const urlBuilderReplacement =
  'function N(e){let n=`${t}${e.split("/").map(e=>encodeURIComponent(e)).join("/")}${r}`;return dh?dh.mode==="path"?"/api/apps/"+dh.appPath+"/embed"+n+(dh.embedToken?"?embedToken="+encodeURIComponent(dh.embedToken):""):"/api/apps/"+dh.appPath+"/embed?path="+encodeURIComponent(n)+(dh.embedToken?"&embedToken="+encodeURIComponent(dh.embedToken):""):n}';

const chunkTypeNeedle =
  'let q=/\\.js(?:\\?[^#]*)?(?:#.*)?$/,K=/\\.css(?:\\?[^#]*)?(?:#.*)?$/;function L(e){return K.test(e)}';

const chunkTypeReplacement =
  'let q=/\\.js(?=$|[?&#])/,K=/\\.css(?=$|[?&#])/;function L(e){return K.test(e)}';

const assetPrefixNeedle =
  "let{pathname:t}=new URL(e.src),n=t.indexOf(\"/_next/\");if(-1===n)throw Object.defineProperty(new r.InvariantError(`Expected document.currentScript src to contain '/_next/'. Received ${e.src} instead.`),\"__NEXT_ERROR_CODE\",{value:\"E784\",enumerable:!1,configurable:!0});return t.slice(0,n)}";

const assetPrefixReplacement =
  "let{pathname:t,searchParams:n}=new URL(e.src),o=t.indexOf(\"/_next/\");if(-1===o){let e=n.get(\"path\");if(e){let t=e.indexOf(\"/_next/\");if(-1!==t)return e.slice(0,t)}}if(-1===o)throw Object.defineProperty(new r.InvariantError(`Expected document.currentScript src to contain '/_next/'. Received ${e.src} instead.`),\"__NEXT_ERROR_CODE\",{value:\"E784\",enumerable:!1,configurable:!0});return t.slice(0,o)}";

if (files.length === 0) {
  throw new Error("No Next.js chunks found to patch.");
}

let patchedRuntime = 0;
let patchedChunkType = 0;
let patchedAssetPrefix = 0;
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
    patchedRuntime += 1;
  }

  if (nextSource.includes(chunkTypeNeedle)) {
    nextSource = nextSource.replace(chunkTypeNeedle, chunkTypeReplacement);
    patchedChunkType += 1;
  }

  if (nextSource.includes(assetPrefixNeedle)) {
    nextSource = nextSource.replace(assetPrefixNeedle, assetPrefixReplacement);
    patchedAssetPrefix += 1;
  }

  if (nextSource !== source) {
    await writeFile(path, nextSource);
  }
}

if (patchedRuntime === 0) {
  throw new Error("Turbopack runtime chunk did not match the Docker Host embed patch target.");
}

if (patchedChunkType === 0) {
  throw new Error("Turbopack chunk type detection did not match the Docker Host embed patch target.");
}

if (patchedAssetPrefix === 0) {
  throw new Error("Next.js asset-prefix chunk did not match the Docker Host embed patch target.");
}

console.log(
  `Patched ${patchedRuntime} Turbopack runtime chunk(s), ${patchedChunkType} chunk type detector(s), and ${patchedAssetPrefix} asset-prefix chunk(s) for Docker Host embed assets.`,
);
