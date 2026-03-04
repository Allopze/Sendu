# Administración

## Primer admin (bootstrap)

Si ALLOW_PUBLIC_REGISTRATION=false, se debe definir ADMIN_BOOTSTRAP_TOKEN. El primer registro con ese token crea un usuario admin y marca el bootstrap como completado.

## Panel Admin

Rutas principales disponibles en la UI:

- Usuarios: cambiar email/username, rol, verificación, reset de contraseña.
- Archivos: listado y gestión.
- Branding: logo claro/oscuro, favicon, icono de dropzone.
- SMTP: configuración y test de correo.
- Limites de upload, tamaño de chunks, límites de invitados.

## Branding

Se aceptan PNG, JPG, SVG e ICO. Si subes un SVG como logo, se genera automáticamente una versión PNG para emails.

## Email

Las plantillas se guardan en settings y se combinan con defaults. El envío se hace mediante una cola de trabajos para reintentos.
