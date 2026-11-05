// Stage-18 standalone build: contains only Chart Lab and its dependencies.
// Not the production UQP web application; never bundled with a live API.
import {fileURLToPath} from "node:url";
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
 plugins:[react()],
 base:"./",
 build:{
  outDir:"chart-lab-dist",
  emptyOutDir:true,
  rollupOptions:{input:fileURLToPath(new URL("./chart-lab.html",import.meta.url))},
 },
});
