# Operaciones

## Health y readiness

- GET `/api/health`
- GET `/api/health/ready`
- GET `/api/admin/metrics`

Checklist mínimo antes de abrir tráfico:

- `/api/health/ready` devuelve `status: "ok"`.
- `/api/admin/metrics` devuelve `health.status: "ok"`.
- `summary.storage.freePercent` está por encima de `15%`.
- `queue.byStatus.dead` está en `0`.
- `summary.http.serverErrorRate` está por debajo de `1%`.

## Backup

El script guarda `data`, `uploads` y branding en un directorio de backup.

```bash
node scripts/backup.js [rutaDestino]
```

Ejemplo:

```bash
node scripts/backup.js ./backups/backup-2026-01-17
```

## Restore

```bash
node scripts/restore.js <rutaBackup>
```

## Cleanup

El script elimina archivos expirados o con límite de descargas alcanzado.

```bash
node scripts/cleanup.js
```

También puedes ejecutar limpieza desde Admin:

- POST `/api/admin/jobs/cleanup`
- POST `/api/admin/cleanup-chunks`

## Jobs y métricas

- GET `/api/admin/jobs/stats`
- GET `/api/admin/metrics`

`/api/admin/metrics` expone:

- `alerts`: alertas derivadas para disk, dead jobs, 5xx, stale uploads y degradación de resume.
- `summary`: tráfico, storage, uploads, downloads y resumable.
- `slo`: objetivos y valor actual para completion rate de uploads, success rate de downloads, availability de resumable y server error rate HTTP.

## Logs

Los logs se guardan en `backend/logs/` y se montan como volumen en Docker.

Cada respuesta de error devuelve `requestId` y además se expone `X-Request-Id` para correlación con logs.

## SLOs operativos recomendados

- Upload completion rate: `>= 98%`
- Download success rate: `>= 99%`
- Resume availability rate: `>= 90%`
- HTTP 5xx rate: `< 1%`
- Dead jobs: `0`

## Alertas mínimas

Si integras monitorización externa, alerta cuando ocurra cualquiera de estas condiciones:

- `health.status !== "ok"`
- `summary.storage.freePercent < 0.15`
- `queue.byStatus.dead > 0`
- `summary.http.serverErrorRate >= 0.01`
- `summary.uploads.staleSessions > 0`
- `summary.resumable.chunkServerErrors > 0`
- `summary.resumable.availabilityRate < 0.9` con al menos `3` probes

## Runbooks

### Resume degradado o uploads estancados

1. Revisar `alerts` y `summary.resumable` en `/api/admin/metrics`.
2. Confirmar que `uploads/` y `data/` siguen siendo escribibles.
3. Ejecutar `POST /api/admin/cleanup-chunks` para limpiar residuos si hay sesiones expiradas.
4. Buscar en logs `requestId`, `upload_resume_probe`, `upload_chunk_client_error` y `upload_chunk_server_error`.
5. Validar que `/api/upload/status/:uploadId` devuelve solo `completedChunks` completos y que no hay saturación de disco.

### Descargas fallidas o abortadas

1. Revisar `summary.downloads` y `summary.http`.
2. Validar expiración, password y conteo de descargas del archivo afectado.
3. Correlacionar `download_fail`, `download_abort` y `requestId` en logs.
4. Si el fallo coincide con presión de disco o 5xx, pausar release o enrutar rollback.

### Disk low

1. Revisar `summary.storage`.
2. Ejecutar limpieza de expirados y chunks huérfanos.
3. Confirmar que backups recientes existen antes de borrar manualmente.
4. Si queda por debajo de `8%`, bloquear nuevos uploads grandes hasta ampliar storage.

### Dead jobs

1. Revisar `GET /api/admin/jobs/stats`.
2. Reintentar jobs muertos con `POST /api/admin/jobs/retry-dead`.
3. Si reaparecen, inspeccionar logs de workers y credenciales de SMTP/branding/cleanup.

## Automatización recomendada

- Backup diario (cron o scheduler de tu plataforma)
- Limpieza periódica de archivos expirados
- Monitorización de `/api/health/ready`
- Polling de `/api/admin/metrics` hacia tu sistema externo de alertas
