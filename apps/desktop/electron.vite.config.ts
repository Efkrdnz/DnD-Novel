import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Workspace packages ship TypeScript source, so they are bundled instead of externalized.
const bundleWorkspace = { exclude: ['@dnd/engine', '@dnd/ai', '@dnd/content'] }

export default defineConfig({
  main: {
    build: { externalizeDeps: bundleWorkspace },
  },
  preload: {
    build: {
      externalizeDeps: bundleWorkspace,
      // Sandboxed preloads must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
