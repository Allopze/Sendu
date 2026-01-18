# Operaciones

## Backup

El script guarda data, uploads y branding en un directorio de backup.

```
node scripts/backup.js [rutaDestino]
```

Ejemplo:

```
node scripts/backup.js ./backups/backup-2026-01-17
```

## Restore

```
node scripts/restore.js <rutaBackup>
```

## Cleanup

El script elimina archivos expirados o con límite de descargas alcanzado.

```
node scripts/cleanup.js
```

También puedes ejecutar limpieza desde Admin:

- POST /api/admin/jobs/cleanup
- POST /api/admin/cleanup-chunks

## Jobs y métricas

- GET /api/admin/jobs/stats
- GET /api/admin/metrics

## Logs

Los logs se guardan en backend/logs/ y se montan como volumen en Docker.

## Automatización recomendada

- Backup diario (cron o scheduler de tu plataforma)
- Limpieza periódica de archivos expirados
- Monitorización de /api/health/ready
