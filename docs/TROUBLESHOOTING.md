# Troubleshooting

## Error: SESSION_SECRET is required in production

Define SESSION_SECRET en .env y reinicia.

## Error: PUBLIC_ORIGIN is required in production

Define PUBLIC_ORIGIN con la URL pública sin slash final.

## CORS bloqueado en frontend

Verifica ALLOWED_ORIGINS y PUBLIC_ORIGIN. En desarrollo, usa el proxy de Vite.

## Emails no salen

Configura SMTP en el panel Admin y usa el endpoint de prueba. Si no hay SMTP, el envío se simula.

## Subidas fallan en archivos grandes

Revisa límites en Admin (chunkSize, maxFileSize, guestMaxFileSize) y el límite de proxy/CDN.

## Error con módulos nativos

better-sqlite3 y sharp requieren toolchain en algunos entornos. Usa Docker o instala dependencias de compilación.

## Error: unable to open database file

La causa más común en Docker es que el contenedor no puede escribir en `./data`, aunque `/app/data` exista.

Verifica:

- `PUID` y `PGID` en `.env` con los valores reales de `id -u` y `id -g`.
- Permisos del host sobre `data/`, `uploads/`, `backend/logs/` y `branding/`.
- Reinicio completo tras cambiar permisos o `.env`: `docker compose down && docker compose up -d --build`.
