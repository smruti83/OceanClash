import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/socket.io": { target: "http://127.0.0.1:3000", ws: true } }
  },
  build: { target: "es2022", sourcemap: true }
});
