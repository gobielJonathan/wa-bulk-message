import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // Entry 1: Your renamed HTML page (points to main.js internally)
        popup: resolve(__dirname, 'popup.html'),
        
        // Entry 2: Your standalone JS file built completely separately
        background: resolve(__dirname, 'src/background.js'),
        content: resolve(__dirname, 'src/content.js')
      },
      output: {
        // Optional: Keeps your output naming predictable
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
})