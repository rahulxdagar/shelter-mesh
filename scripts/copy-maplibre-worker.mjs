// MapLibre 6 resolves its worker at runtime relative to the bundle, which Next's bundler
// cannot follow; serve the worker files from /public and point setWorkerUrl at them.
import { cpSync, mkdirSync } from "node:fs";
const src = "node_modules/maplibre-gl/dist";
const dest = "public/vendor/maplibre";
mkdirSync(dest, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) cpSync(`${src}/${f}`, `${dest}/${f}`);
