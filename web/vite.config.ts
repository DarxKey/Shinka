import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  // In sviluppo l'interfaccia gira sul server di Vite e chiede le API al centro locale.
  // Il terminale di un progetto è un WebSocket: passa dallo stesso tramite.
  server: { proxy: { "/api": { target: "http://127.0.0.1:7850", ws: true } } },
});
