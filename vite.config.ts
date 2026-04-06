import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  // Tauri expects a fixed port during development
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Watch for changes in the src directory
      ignored: ["**/src-tauri/**"],
    },
  },
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
}));
