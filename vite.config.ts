import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { mapsPlugin } from "./vite-plugin-maps";

export default defineConfig({
  plugins: [vue(), mapsPlugin()],
});
