# API (resumen)

Base: /api

## Auth

- POST /auth/register
- POST /auth/login
- POST /auth/logout
- GET /auth/csrf
- GET /auth/me
- GET /auth/verify
- POST /auth/resend-verification
- POST /auth/forgot-password
- GET /auth/reset-password/validate
- POST /auth/reset-password

## Upload

- POST /upload/init
- GET /upload/status/:uploadId
- POST /upload/complete
- POST /upload/cancel
- POST /upload/chunk (ruta optimizada)

## Descarga

- GET /meta/:id
- POST /download/:id/validate
- GET /download/:id
- POST /download/:id

## Usuario

- GET /user/files
- DELETE /files/:id

## Admin

- GET /admin/stats
- GET /admin/users
- PUT /admin/users/:id
- DELETE /admin/users/:id
- POST /admin/users/:id/toggle-role
- POST /admin/users/:id/toggle-verified
- POST /admin/users/:id/reset-password
- POST /admin/users/:id/send-verification
- POST /admin/users/:id/send-reset
- GET /admin/files
- GET /admin/settings
- POST /admin/settings
- POST /admin/branding/upload
- DELETE /admin/branding/:type
- POST /admin/smtp/test
- POST /admin/cleanup-chunks
- GET /admin/jobs/stats
- GET /admin/metrics
- GET /metrics
- POST /admin/jobs/cleanup
- POST /admin/rate-limits/reset

## Settings (público)

- GET /settings/public
- GET /settings/limits

## Health

- GET /health
- GET /health/ready

## Notas

- La mayoría de endpoints requieren sesión y CSRF (ver docs/SECURITY.md).
- Las rutas públicas de lectura están exentas de CSRF.
- `/upload/status/:uploadId` requiere `x-upload-token` o `uploadToken` de la sesión de subida.
- `/admin/metrics` devuelve `alerts`, `summary` y `slo` para consumo humano o polling externo.
- `/metrics` expone el mismo estado operativo en formato Prometheus y acepta sesión admin o `Authorization: Bearer <METRICS_EXPORT_TOKEN>`.
