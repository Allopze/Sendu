import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load env files: first frontend/.env then root .env as fallback
dotenv.config({ path: path.resolve(__dirname, '.env') })
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const BACKEND_PORT = process.env.BACKEND_PORT || process.env.PORT || 3000
const FRONTEND_PORT = process.env.FRONTEND_PORT || 5173

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(FRONTEND_PORT),
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        secure: false,
      },
      '/branding': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
