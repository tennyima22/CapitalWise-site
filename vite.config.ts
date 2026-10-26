import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The project lives in OneDrive, where file-change events can be missed; polling keeps the
    // dev server from serving stale files (e.g. an out-of-date stylesheet).
    watch: { usePolling: true, interval: 300 },
  },
})
