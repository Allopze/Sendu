# Configuración de entorno

Sendu carga variables desde .env (dotenv) en el backend y el frontend durante desarrollo.

## Requeridas en producción

| Variable | Requerida | Descripción |
| --- | --- | --- |
| SESSION_SECRET | Sí | Secreto de sesión (mínimo 32 caracteres). |
| PUBLIC_ORIGIN | Sí | URL pública de la app sin slash final (debe ser HTTPS para cookies seguras). |
| ALLOWED_ORIGINS | Sí | Lista separada por comas con orígenes permitidos para CORS. Debe incluir PUBLIC_ORIGIN. |

## Recomendadas en producción

| Variable | Requerida | Descripción |
| --- | --- | --- |
| SESSION_COOKIE_DOMAIN | No | Dominio de cookie (ej. .example.com). Necesario si usas subdominios. |
| SESSION_COOKIE_NAME | No | Nombre de cookie de sesión (por defecto sendu.sid). |
| SESSION_COOKIE_SAMESITE | No | SameSite para cookie de sesión (lax, strict, none). Por defecto lax. |
| SESSION_COOKIE_SECURE | No | Secure para cookie de sesión (true/false). Por defecto true en producción. **IMPORTANTE**: Si usas HTTP (no HTTPS), debes poner `false`, pero esto NO es recomendado en producción. |
| TRUST_PROXY | No | Habilita trust proxy (por defecto 1 en producción). Necesario si hay un reverse proxy (nginx, Cloudflare, etc.) delante de la app. |
| CSP_STRICT | No | `true` para activar Content Security Policy estricta. Elimina `'unsafe-inline'` de las directivas `script-src` y `style-src` en las cabeceras CSP. **Nota:** puede romper estilos inline de React; prueba en staging antes de activar en producción. Si usas Cloudflare Analytics, la directiva ya incluye `cloudflareinsights.com`. |

## Problema común: Sesión se pierde al refrescar

Si la sesión se cierra al refrescar la página, verifica:

1. **HTTPS vs HTTP**: Si `PUBLIC_ORIGIN` usa `http://` pero estás en producción, las cookies seguras no funcionarán.
   - Solución A (recomendada): Usa HTTPS
   - Solución B: Añade `SESSION_COOKIE_SECURE=false` (no seguro)

2. **Reverse Proxy**: Si usas nginx, Cloudflare, etc., asegúrate de que `TRUST_PROXY=1`.

3. **Dominio**: Si accedes por IP o un dominio diferente al configurado en `PUBLIC_ORIGIN`, las cookies no se enviarán.

4. **Diagnostico**: Ejecuta `node scripts/diagnose-session.js` para verificar la configuración.

## Configuración del servidor

| Variable | Requerida | Descripción |
| --- | --- | --- |
| NODE_ENV | No | development o production. |
| PORT | No | Puerto del backend (por defecto 3000). |

## Registro de usuarios

| Variable | Requerida | Descripción |
| --- | --- | --- |
| ALLOW_PUBLIC_REGISTRATION | No | true para permitir registro público. |
| ADMIN_BOOTSTRAP_TOKEN | No | Token para crear el primer admin si el registro público está deshabilitado. |

## Rutas de almacenamiento

| Variable | Requerida | Descripción |
| --- | --- | --- |
| APP_DATA_PATH | No | Directorio de base de datos (data). |
| DATA_PATH | No | Alias para APP_DATA_PATH. |
| APP_UPLOADS_PATH | No | Directorio de uploads. |
| STORAGE_PATH | No | Alias para APP_UPLOADS_PATH. |
| APP_TEMP_PATH | No | Directorio temporal (chunks). |
| UPLOAD_SESSION_MAX_AGE_HOURS | No | TTL de sesiones de subida (horas). |

## Frontend (desarrollo)

| Variable | Requerida | Descripción |
| --- | --- | --- |
| BACKEND_PORT | No | Puerto del backend para el proxy de Vite. |
| FRONTEND_PORT | No | Puerto del frontend. |

## SMTP

La configuración SMTP se guarda en la base de datos desde el panel Admin (no desde .env). En .env.example aparecen valores de referencia para despliegues y releases.

## Rate limiting (nota)

Los contadores de rate limit se guardan en SQLite (tabla `rate_limits`). En despliegues recién inicializados, puedes reiniciar contadores desde el panel Admin vía `POST /api/admin/rate-limits/reset`.

## Ejemplo

Revisa .env.example para un ejemplo completo.
