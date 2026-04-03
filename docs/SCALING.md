# Escalado y Alta Disponibilidad

Esta guía define la estrategia objetivo para sacar Sendu de SQLite cuando el despliegue requiera alta disponibilidad real o `4+` instancias.

Importante: hoy el runtime del repositorio sigue funcionando sobre SQLite. Esta estrategia deja la topología objetivo documentada y observable en métricas, pero no sustituye todavía el trabajo de migración de código a PostgreSQL/Redis.

## Cuándo dejar SQLite

SQLite sigue siendo razonable para:

- una sola instancia,
- single-host con volumen persistente,
- cargas moderadas,
- despliegues donde una breve ventana de mantenimiento es aceptable.

SQLite deja de ser suficiente cuando necesitas cualquiera de estas condiciones:

- `4+` instancias activas detrás de balanceador,
- HA real entre nodos o zonas,
- picos frecuentes de escritura concurrente,
- failover automático sin depender de un único volumen RWX,
- aislamiento entre estado relacional, sesiones, límites y binarios.

## Topología objetivo para HA

| Componente | Estado actual | Objetivo HA |
| --- | --- | --- |
| Estado relacional (`files`, `upload_sessions`, `settings`, jobs, tokens) | SQLite | PostgreSQL gestionado |
| Sesiones | SQLite | Redis |
| Rate limiting | SQLite | Redis |
| Cola de trabajos | SQLite | PostgreSQL |
| Binarios (`uploads/`, chunks, branding) | Filesystem local | Object storage (`S3`, `R2`, `MinIO`) o shared filesystem controlado |
| Balanceo | single host / proxy local | Load balancer L7 con health checks |

## Variables de topología

Declara el perfil y los backends esperados en `.env`:

```env
DEPLOYMENT_PROFILE=ha
STATE_BACKEND=postgresql
SESSION_BACKEND=redis
RATE_LIMIT_BACKEND=redis
QUEUE_BACKEND=postgresql
UPLOAD_STORAGE_BACKEND=object-storage
```

Estas variables hoy alimentan:

- `/api/admin/metrics`
- `/metrics`
- alertas derivadas sobre topología incorrecta

Con ellas puedes detectar rápido configuraciones peligrosas, por ejemplo `DEPLOYMENT_PROFILE=ha` combinado con `STATE_BACKEND=sqlite`.

## Objetivo técnico del punto 2

Cerrar el punto 2 significa que Sendu pueda servir tráfico desde `4+` instancias o en una topología HA sin depender de SQLite ni del filesystem local para coordinar estado compartido.

En términos prácticos, el objetivo es sacar del path crítico:

- sesiones desde SQLite hacia Redis,
- rate limiting desde SQLite hacia Redis,
- estado durable desde SQLite hacia PostgreSQL,
- binarios y chunks desde disco local hacia object storage o shared filesystem controlado.

No se considera cerrado el punto 2 mientras la aplicación siga necesitando SQLite o almacenamiento local por nodo para coordinar múltiples réplicas en producción.

## Estrategia de corte

Para este proyecto se asume un corte limpio hacia PostgreSQL, no una convivencia prolongada SQLite/PostgreSQL.

Eso implica:

- no mantener dual-write entre SQLite y PostgreSQL en producción,
- no sostener una topología mixta donde una parte del tráfico siga escribiendo en SQLite,
- usar SQLite solo como origen de exportación y snapshot de rollback durante la ventana de migración,
- pasar a PostgreSQL como único backend relacional activo después del cutover.

La secuencia operativa esperada es:

1. congelar cambios de esquema y escrituras no esenciales,
2. generar snapshot consistente de SQLite,
3. ejecutar migración one-shot hacia PostgreSQL,
4. validar integridad,
5. cambiar la aplicación a PostgreSQL,
6. conservar SQLite solo como respaldo de rollback, en modo fuera de tráfico.

## Secuencia de migración recomendada

### Fase 1. Preparación

- Mantener `DEPLOYMENT_PROFILE=single` en producción actual.
- Añadir secret scanning y observabilidad de topología.
- Medir carga real: writes por segundo, tamaño medio de upload, jobs por minuto y saturación de disco.

Entregables de esta fase:

- mantener `DEPLOYMENT_PROFILE=single` en producción actual,
- inventario de dependencias directas a SQLite en `backend/server.js`, `backend/lib/persistentStores.js`, `backend/lib/jobQueue.js` y rutas asociadas,
- definición explícita del entorno objetivo: PostgreSQL, Redis, storage remoto y balanceador.

Validación mínima:

- documentación de topología publicada,
- alertas de topología activas,
- línea base de rendimiento capturada para comparar después del cutover.

### Fase 2. Redis primero

- Mover sesiones a Redis.
- Mover rate limiting a Redis.
- Mantener sticky sessions desactivadas: con Redis ya no son necesarias.

Entregables de esta fase:

- backend Redis definitivo para sesiones,
- backend Redis definitivo para rate limiting,
- configuración nueva para `REDIS_URL` y parámetros operativos asociados,
- pruebas de login/logout y cuotas compartidas entre dos instancias.

Validación mínima:

- autenticación estable tras refresh contra varias réplicas,
- rate limiting consistente desde más de un nodo,
- despliegue staging sin necesidad de sticky sessions.

### Fase 3. Abstracción de persistencia

- Extraer acceso a datos a repositorios/servicios.
- Eliminar dependencias directas de `better-sqlite3` desde rutas y utilidades.
- Asegurar compatibilidad async para preparar el salto a PostgreSQL.

Entregables de esta fase:

- contratos de persistencia para `files`, `upload_sessions`, `settings`, tokens, cola y stores transversales,
- adapters y repositorios preparados para reemplazar SQLite por PostgreSQL sin SQL inline en rutas,
- eliminación progresiva de SQL inline en rutas.

Validación mínima:

- las rutas no dependen directamente de `db.prepare(...)` salvo en capas de infraestructura,
- los contratos expuestos por los repositorios son async,
- la suite existente sigue pasando sobre el backend SQLite actual.

Estado implementado hoy en el repo:

- `backend/lib/settingsRepository.js` ya cubre settings públicos, settings admin y lecturas de retención por defecto para uploads.
- `backend/lib/settingsRepository.js` también cubre ahora la aplicación transaccional con auditoría de cambios de settings consumida por el panel admin.
- `backend/server.js` ya resuelve por `settingsRepository` las lecturas runtime de settings para límites de upload, chunk rate, concurrencia, SMTP, templates y branding usado en emails, sin SQL inline directo en ese composition root.
- `backend/lib/adminSettings.js` y `backend/routes/adminSettings.js` ya delegan en `settingsRepository` la persistencia auditada de configuración; la migración sensible también quedó apoyada en el repositorio mediante helpers síncronos, eliminando SQL inline directo de ese helper.
- `backend/lib/usersRepository.js` ya cubre registro, login, verificación, reset y administración de usuarios.
- `backend/lib/uploadSessionsRepository.js` ya cubre el ciclo de vida de `upload_sessions` en `upload.js` y `chunkRouter.js`, además de los contadores operativos de sesiones activas/obsoletas y la limpieza periódica de sesiones terminales antiguas.
- `backend/lib/filesRepository.js` ahora cubre listados, borrado, metadata, descargas, inserción final de archivos completados y selección de candidatos para cleanup/reconcile.
- `backend/lib/jobQueueRepository.js` ahora encapsula la persistencia de la cola y `backend/lib/jobQueue.js` quedó como orquestador async sin SQL inline directo.
- `backend/lib/persistentStoresRepository.js` ahora encapsula los stores persistentes transversales de CSRF, guest tracking, download tokens, sesiones y rate limits; `backend/lib/persistentStores.js` quedó como wrapper de compatibilidad sin `db.prepare(...)` inline.
- `backend/make_admin.js` y `backend/update_settings.js` ya consumen `usersRepository` y `settingsRepository` respectivamente, sacando SQL inline directo de esos utilitarios de mantenimiento.
- `backend/lib/migrationsRepository.js` ahora encapsula el bookkeeping de `schema_migrations` y la inspección de columnas usada por `backend/lib/migrations.js`.
- `backend/lib/durableStateSchema.js` centraliza ahora los objetos DDL durables compartidos para SQLite y PostgreSQL; `backend/lib/migrations.js` ya no concentra inline el bloque principal de schema/indexes/auditoría y delega en ese registro compartido para `001_initial_schema`, `004_files_indexes`, `005_settings_audit_log` y `007_durable_state_expansion`.
- `backend/lib/bootstrap.js` ya usa repositorios para sembrar defaults operativos, branding por defecto y métricas informativas de arranque.
- `backend/server.js` ya consume repositorios async para `requireAdmin`, export de métricas, limpieza de sesiones de subida y limpieza/reconciliación de archivos, reduciendo más SQL inline fuera de rutas.
- `backend/lib/jobHandlers.js` ya reutiliza `filesRepository` para la limpieza en background de archivos expirados o agotados por descargas.
- `backend/lib/operationalMetrics.js` ya consume `uploadSessionsRepository`, stats async de cola y `databaseHealthRepository`, sin fallback SQL inline desde ese helper.
- `backend/routes/health.js` ya usa `databaseHealthRepository` para readiness y dejó de ejecutar `SELECT 1` directamente desde la ruta.
- rutas ya migradas sin SQL inline de dominio: `auth.js`, `adminUsers.js`, `publicSettings.js`, `upload.js`, `chunkRouter.js`, `download.js` y `files.js`.
- validación actual de esta fase en el estado SQLite vigente: `npx vitest run backend/tests/*.test.js` pasando con `23` archivos y `122` tests.
- el runner de migraciones sigue siendo SQLite-first en su orquestación, pero la deuda restante ya no es el bloque DDL principal sino el wiring final para ejecutar la misma evolución de estado durable sobre un backend PostgreSQL real.

### Fase 4. PostgreSQL para estado duradero

- Migrar tablas relacionales críticas: `files`, `upload_sessions`, `settings`, `job_queue`, tokens y auditoría.
- Ejecutar migración one-shot con ventana controlada y cutover limpio.
- Validar integridad antes del cutover definitivo.

Entregables de esta fase:

- esquema PostgreSQL equivalente y versionado,
- scripts de migración one-shot desde SQLite,
- validación de integridad por conteo, claves y campos críticos,
- runbook de cutover y rollback usando snapshot SQLite como respaldo.

Orden recomendado dentro de esta fase:

1. `settings`
2. `files`
3. `upload_sessions`
4. tokens y auditoría
5. `job_queue`

Validación mínima:

- staging funcionando íntegramente sobre PostgreSQL para estado durable,
- comparación SQLite vs PostgreSQL sin pérdida de registros,
- rollback documentado antes del cutover productivo,
- ausencia de dual-write o mixed mode una vez abierto el tráfico sobre PostgreSQL.

Estado implementado hoy en el repo:

- `backend/lib/postgresDurableState.js` ya define un runner de migraciones PostgreSQL y un repositorio de bookkeeping equivalente sobre un cliente query-capable.
- `backend/lib/durableStateCutover.js` ya exporta snapshots deterministas del estado durable desde SQLite y soporta importación/render SQL para PostgreSQL.
- `scripts/postgres-cutover.js` ya expone el flujo operativo one-shot con modos `export`, `render-schema`, `render-sql` y `execute`.
- `package.json` ya publica los comandos `cutover:postgres:*` y el workspace ya incluye la dependencia `pg` para hacer ejecutable el modo `execute` contra un PostgreSQL real.
- la cobertura mínima de esta base quedó validada con `backend/tests/postgresDurableState.test.js`, `backend/tests/durableStateCutover.test.js`, `backend/tests/migrationsRepository.test.js`, `backend/tests/migrations.test.js` y además con la suite backend completa pasando en `23` archivos y `122` tests.

Lo que sigue pendiente dentro de esta fase:

- conectar el runtime principal a repositorios PostgreSQL reales para `settings`, `files`, `upload_sessions`, tokens, auditoría y `job_queue`, en lugar de dejar PostgreSQL solo como runner/cutover sidecar.
- validar un cutover end-to-end contra una instancia PostgreSQL real en staging, incluyendo conteos, constraints, rollback y smoke post-cambio.
- cerrar el plan de activación de `STATE_BACKEND=postgresql` y `QUEUE_BACKEND=postgresql` sin mixed mode después del cambio.

### Fase 5. Object storage para binarios

- Sacar `uploads/` y chunks del disco local.
- Mantener solo caché temporal efímera en cada réplica.
- Separar lifecycle policies para chunks incompletos, archivos finales y branding.

Entregables de esta fase:

- backend de storage seleccionable con `UPLOAD_STORAGE_BACKEND=filesystem|shared-filesystem|object-storage`,
- uploads finales fuera de disco local,
- estrategia explícita para chunks reanudables en multiinstancia,
- políticas de expiración y limpieza para objetos temporales.

Validación mínima:

- una subida puede continuar o completarse desde una réplica distinta,
- ZIP streaming y resume siguen funcionando con storage remoto,
- los nodos no almacenan estado persistente imprescindible en disco local.

### Fase 6. Cutover HA

- Cambiar `DEPLOYMENT_PROFILE=ha`.
- Declarar backends finales en `.env`.
- Exigir `sendu_topology_profile_ready{profile="ha"} == 1` antes de abrir tráfico.
- Hacer canary con una réplica nueva antes de expandir al resto.

Entregables de esta fase:

- despliegue canario con backends finales,
- activación de monitorización y alertado externo,
- prueba de failover y prueba de carga con `4` réplicas,
- documentación de rollback y postmortem de validación.

Validación mínima:

- `sendu_topology_profile_ready{profile="ha"} == 1`,
- health/readiness estables en varias réplicas,
- tráfico real atendido sin sticky sessions,
- failover sin pérdida de sesiones ni corrupción de uploads.

## Orden recomendado por PR

Para reducir riesgo, la migración debería partirse así:

1. PR 1: extraer contratos de persistencia y aislar accesos a SQLite.
2. PR 2: mover sesiones a Redis.
3. PR 3: mover rate limiting a Redis.
4. PR 4: introducir esquema PostgreSQL, repositorios y comando de migración one-shot.
5. PR 5: completar el cutover limpio del estado durable a PostgreSQL.
6. PR 6: migrar `job_queue` a PostgreSQL y revisar locking multiworker.
7. PR 7: mover uploads/chunks a object storage o shared filesystem controlado.
8. PR 8: ejecutar canary, pruebas de carga, failover y activar `DEPLOYMENT_PROFILE=ha`.

## Matriz mínima de validación

Cada fase debe cerrarse con pruebas concretas, no solo con tests unitarios.

1. Tests unitarios de adapters SQLite, Redis y PostgreSQL.
2. Tests de integración con Redis y PostgreSQL reales.
3. Smoke E2E con al menos dos instancias detrás de proxy.
4. Prueba de resume de uploads desde un nodo distinto al que inició la sesión.
5. Prueba de jobs con varios workers sin duplicados no controlados.
6. Prueba de carga con `4` réplicas antes del cambio definitivo a `ha`.

## Riesgos principales

Los riesgos que hay que vigilar durante la migración son:

- acceso SQL directo todavía repartido por rutas y utilidades,
- diferencias semánticas entre SQLite y PostgreSQL,
- ventana de cutover mal planificada o sin snapshot consistente,
- reanudación de uploads cuando los chunks ya no estén en disco local,
- duplicación de jobs en despliegues con múltiples workers,
- rollback incompleto después del corte a PostgreSQL.

## Definición de hecho

El punto 2 se considera realmente cerrado cuando se cumplan todas estas condiciones:

1. La aplicación no depende de SQLite para estado compartido entre nodos.
2. Las sesiones y el rate limiting funcionan de forma consistente entre varias réplicas.
3. El estado durable principal vive en PostgreSQL.
4. Los uploads y chunks no dependen del filesystem local del nodo que recibió la petición original.
5. `sendu_topology_profile_ready{profile="ha"} == 1` en el despliegue objetivo.
6. Existe validación documentada de canary, carga y failover con al menos `4` réplicas.

## Qué no se debe hacer

- No declarar `DEPLOYMENT_PROFILE=ha` mientras `STATE_BACKEND=sqlite`.
- No asumir que un volumen NFS con SQLite equivale a alta disponibilidad.
- No usar filesystem local para chunks en un balanceador multi-nodo sin afinidad o almacenamiento compartido.
- No abrir tráfico a múltiples instancias si sesiones y rate limiting siguen siendo locales al nodo.

## Criterios de salida para decir “HA lista”

- PostgreSQL con backups y réplica/HA del proveedor.
- Redis persistente o con la estrategia de durability aceptada para sesiones y rate limits.
- Binarios fuera del disco local o en un shared filesystem con SLA explícito.
- `sendu_topology_profile_ready{profile="ha"} == 1`.
- Alertas externas activas sobre `/metrics`.
- Prueba de failover y prueba de carga con al menos `4` réplicas completadas.