# Sendu

Plataforma de intercambio de archivos con subidas en chunks, enlaces protegidos, expiración, panel de administración y branding. Backend en Node.js/Express y frontend en React (Vite).

## Documentación

- docs/ENVIRONMENT.md
- docs/DEPLOYMENT.md
- docs/RELEASE.md
- docs/API.md
- docs/ADMIN.md
- docs/OPERATIONS.md
- docs/SECURITY.md
- docs/TROUBLESHOOTING.md
- docs/ARCHITECTURE.md
- docs/SCALING.md

## Inicio rápido (desarrollo)

1) Copia la plantilla de entorno, genera secretos nuevos y reemplaza todos los placeholders:

```
cp .env.example .env
openssl rand -hex 64
```

Usa el valor generado para `SESSION_SECRET` y, preferiblemente, otro distinto para `ENCRYPTION_KEY`. `PUBLIC_ORIGIN` debe ser una sola URL pública válida.

Si ejecutas con Docker y el host ya usa el puerto `3000`, define `HOST_PORT` en `.env` para publicar el contenedor en otro puerto, por ejemplo `HOST_PORT=3301`.

2) Instala dependencias:

```
npm install
```

3) Levanta backend y frontend en modo desarrollo:

```
npm run dev
```

- Backend: http://localhost:3000
- Frontend: http://localhost:5173

## Producción (Docker)

Usa docker-compose y un archivo .env con placeholders reemplazados por valores reales. Ver guía completa en docs/DEPLOYMENT.md.

## Scripts principales

- npm run dev: backend + frontend con hot reload.
- npm run start: inicia backend en modo producción.
- npm run build: build completo y paquete de release.
- npm run test: ejecuta tests con Vitest.
- npm run backup / npm run restore: backups de data/uploads/branding.
- npm run cleanup: limpieza de archivos expirados.

## Configuración

Variables clave: SESSION_SECRET, PUBLIC_ORIGIN y ALLOWED_ORIGINS. Detalle completo en docs/ENVIRONMENT.md.

## Health checks

- GET /api/health
- GET /api/health/ready

## Estructura del proyecto (alto nivel)

- backend/: servidor Node/Express, jobs, base de datos SQLite
- frontend/: app React (Vite)
- docs/: documentación
- scripts/: utilidades (build, backup, restore, cleanup)
- docker-compose.yml / Dockerfile: despliegue

## Releases

El build genera un ZIP en release/. Detalles en docs/RELEASE.md.
