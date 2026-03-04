# Releases

## Requisitos

- Node.js 20+
- Dependencias instaladas (npm install)

## Crear un release

El build genera un paquete listo para producción:

```
npm run build
```

## Artefactos

- dist/: build final (frontend + backend + scripts)
- release/: ZIP empaquetado listo para distribuir

El nombre del ZIP incluye versión y fecha: sendu-v<version>-<YYYYMMDD>.zip

## Prebuilt (recomendado para despliegue rápido)

El ZIP incluye:

- Dockerfile.prebuilt
- docker-compose.prebuilt.yml
- public/ (frontend precompilado)
- backend/ y scripts/

Pasos básicos:

1) Descomprime el ZIP
2) Crea .env (ver docs/ENVIRONMENT.md)
3) Ejecuta:

```
docker compose -f docker-compose.prebuilt.yml --env-file .env up -d --build
```

## Versionado

Se usa el campo version de package.json. Actualiza antes de crear un release.
