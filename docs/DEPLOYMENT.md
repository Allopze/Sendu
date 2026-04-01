# Despliegue

Guía recomendada para producción usando Docker.

## Requisitos

- Docker y Docker Compose v2
- Un archivo .env con valores de producción (ver docs/ENVIRONMENT.md)

## Docker (desde código fuente)

1) Crea el archivo .env:

```
cp .env.example .env
```

2) Edita .env con tus valores reales antes del primer arranque.

- Genera un `SESSION_SECRET` nuevo con `openssl rand -hex 64`.
- Genera también un `ENCRYPTION_KEY` distinto si vas a guardar settings sensibles en la base de datos.
- Usa un único `PUBLIC_ORIGIN` válido, sin slash final.
- Ajusta `ALLOWED_ORIGINS` como lista separada por comas solo si realmente necesitas más de un origen.

Si necesitas correo transaccional desde el arranque, define también `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. Luego podrás sobrescribirlos desde el panel Admin si hace falta.

3) Construye y levanta el servicio:

```
docker compose --env-file .env up -d --build
```

4) Verifica estado y logs:

```
docker compose ps
docker compose logs -f --tail=200
```

5) Detener el servicio:

```
docker compose down
```

El archivo docker-compose.yml crea volúmenes persistentes para data, uploads, logs y branding.

## Docker (prebuilt / release)

1) Descomprime el ZIP del release en una carpeta.
2) Crea .env en esa carpeta.
3) Levanta con el compose prebuilt:

```
docker compose -f docker-compose.prebuilt.yml --env-file .env up -d --build
```

## Actualizaciones

### Desde código

```
git pull
docker compose --env-file .env up -d --build
```

### Desde release

1) Descarga nuevo ZIP
2) Reemplaza carpeta
3) Ejecuta:

```
docker compose -f docker-compose.prebuilt.yml --env-file .env up -d --build
```

## Reverse proxy (opcional)

Hay un ejemplo en nginx.conf.example. Asegura que el proxy preserve cabeceras, y habilita TLS en producción. Si usas un proxy externo, configura TRUST_PROXY=1.

## Persistencia

- data/: base de datos SQLite.
- uploads/: archivos subidos.
- branding/: logos y favicon.
- backend/logs/: logs de aplicación.

## Health checks

El contenedor expone:

- GET /api/health
- GET /api/health/ready

## Límites y recursos

Los archivos docker-compose incluyen límites de CPU y memoria. Ajusta según tu carga.

## Puertos

- Backend por defecto en 3000 (o 4000 para prebuilt)
- En producción, define PUBLIC_ORIGIN con la URL final
