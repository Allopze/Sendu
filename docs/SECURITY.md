# Seguridad

## Sesiones y cookies

- Cookies httpOnly, SameSite y secure en producción.
- SESSION_SECRET obligatorio en producción.

## CSRF

- Tokens CSRF en cookie no-HTTPOnly.
- Validación en rutas de escritura, con exclusiones explícitas (auth, uploads y descargas).

## Validación de archivos

- Detección de tipo MIME desde contenido.
- Allowlist de MIME y validación de extensiones peligrosas.
- Verificación de tamaño final del archivo.

## Antivirus

- Integración opcional mediante backend/lib/antivirus.js.

## Rate limiting

- Limitadores generales y específicos para auth y descargas con contraseña.
- Chunk uploads con limitador dedicado.

## CSP

- CSP configurable con CSP_STRICT.
- En producción se recomienda activar CSP_STRICT y ajustar orígenes si usas recursos externos.

## Secret scanning preventivo

- CI ejecuta Gitleaks sobre el árbol actual del repositorio antes de tests y build.
- La configuración vive en `.gitleaks.toml` y excluye artefactos generados, datos mutables y releases empaquetados para evitar ruido.
- Para reproducir el escaneo localmente sin instalar binarios en el host:

```bash
docker run --rm \
	--user "$(id -u):$(id -g)" \
	-v "$PWD:/repo" \
	-w /repo \
	ghcr.io/gitleaks/gitleaks:latest \
	dir . --no-git --config .gitleaks.toml --redact
```
