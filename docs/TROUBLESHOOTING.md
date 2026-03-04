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
