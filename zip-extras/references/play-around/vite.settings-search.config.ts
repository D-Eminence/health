import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'settings-dashboard/search-assets',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/settings-search.tsx',
      name: 'SettingsGlobalSearch',
      formats: ['iife'],
      fileName: () => 'global-search.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: asset => asset.name?.endsWith('.css') ? 'global-search.css' : '[name][extname]',
      },
    },
  },
})
