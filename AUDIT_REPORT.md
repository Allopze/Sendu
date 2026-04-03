# Auditoría Técnica de Producción

Fecha: 2026-04-01
Proyecto: Sendu

# Actualización de implementación

Fecha: 2026-04-02

Esta sección refleja el estado vigente del repositorio después de contrastar el informe original con el código actual y aplicar fixes adicionales. La auditoría original se conserva debajo como referencia histórica, pero el estado actual debe leerse desde aquí.

## Estado vigente
- Estado: mejor que en la auditoría original, pero todavía no la sacaría como “producción madura”
- Nota global estimada: 7/10
- Nivel de confianza: Alto

## Bloqueadores originales ya resueltos
- `Secretos reales expuestos y plantilla inválida`: resuelto. `.env.example` ya usa placeholders y `PUBLIC_ORIGIN` válido.
- `SMTP inconsistente entre deploy y backend`: resuelto. El backend ahora toma base desde `SMTP_*` y permite override desde Admin/settings.
- `bytesReceived` contaminado por chunks inválidos`: resuelto. La actualización ocurre después del `rename` final y con recálculo autoritativo desde disco.
- `test:coverage` roto`: resuelto. `@vitest/coverage-v8` está instalada y la cobertura ejecuta correctamente.
- `CI sin coverage/smoke`: resuelto. El workflow ya incluye cobertura y Playwright smoke.
- `Huecos de accesibilidad mencionados en el informe`: resuelto para los casos citados. El modal de confirmación ya usa `role="dialog"` y `aria-modal`, y las acciones icon-only del dashboard ya tienen `aria-label`.

## Fixes aplicados en esta ronda
- Corregidos `docker-compose.yml` y `docker-compose.prebuilt.yml`, que estaban inválidos por bloques YAML duplicados.
- Reparada la reproducibilidad del smoke E2E:
  - `playwright.config.js` ahora inyecta `SESSION_SECRET` para producción en el `webServer`.
  - El entorno E2E deja explícitamente vacías las variables `SMTP_*` para no heredar verificación de email desde `.env` local.
  - Se alineó `reuseExistingServer` con el patrón recomendado por Playwright y se dejó `stderr` visible para depuración.
- Endurecido `scripts/build.js` para no borrar por completo `release/`, evitando fallos por artefactos previos con permisos distintos.
- Reducido logging sensible de email:
  - ya no se registran destinatarios ni asuntos completos;
  - ahora solo se registran conteo de destinatarios, dominios y longitud del asunto.
- Reducido el pico de memoria del ZIP en frontend:
  - se reemplazó `jszip` por `@zip.js/zip.js`;
  - el worker ya no convierte cada archivo a `ArrayBuffer`;
  - la compresión ahora consume `ReadableStream` de cada `File` y genera un `Blob` final desde un `TransformStream`, evitando duplicar en memoria tanto las entradas como el ZIP final en formato `ArrayBuffer`.
- Modularizado parcialmente `backend/server.js`:
  - auth extraído a `backend/routes/auth.js`;
  - settings públicos extraídos a `backend/routes/publicSettings.js`;
  - operaciones/admin metrics/jobs extraídos a `backend/routes/adminOperations.js`;
  - `server.js` sigue grande, pero ya no concentra estas rutas inline.
- Endurecido el cifrado de settings sensibles:
  - `backend/lib/encryption.js` ahora cifra nuevos secretos con AES-256-GCM;
  - `decrypt()` dejó de hacer fail-open para payloads cifrados corruptos;
  - se mantiene compatibilidad de lectura con el formato legado AES-CBC para no romper secretos ya guardados.
- Migración one-shot de secretos sensibles legado:
  - `backend/lib/migrations.js` ahora ejecuta la migración `006_sensitive_settings_gcm`;
  - los secretos sensibles heredados en AES-CBC o plaintext quedan reescritos a AES-256-GCM de forma idempotente.
- Streaming ZIP -> upload end-to-end para archivos/carpetas grandes:
  - el worker ya puede emitir chunks del ZIP en streaming con backpressure;
  - el frontend sube esos chunks a `/api/upload/chunk` sin materializar el archivo ZIP completo como `Blob` final;
  - `/api/upload/complete` ahora acepta `finalChunkIndex` y `actualSize` para cerrar subidas ZIP en streaming con tamaño final real.
- Secret scanning preventivo en CI:
  - `.github/workflows/ci.yml` ahora ejecuta Gitleaks antes de tests/build;
  - el scan corre sobre el árbol actual (`dir --no-git`) para bloquear nuevas credenciales sin reabrir todo el histórico git;
  - el resultado se publica además como SARIF.
- Resume post-refresh para ZIP streaming:
  - el frontend persiste las entradas fuente del ZIP en almacenamiento local;
  - tras un refresh, reconstruye el stream, consulta el progreso remoto y reanuda desde los bytes ya recibidos.
- Modularización adicional de backend:
  - upload/init/status/complete/cancel extraído a `backend/routes/upload.js`;
  - settings admin/branding/SMTP test/rate-limit reset extraído a `backend/routes/adminSettings.js`;
  - download/meta/share extraído a `backend/routes/download.js`;
  - listados y borrado de archivos extraído a `backend/routes/files.js`;
  - stats y administración de usuarios extraído a `backend/routes/adminUsers.js`;
  - health/readiness extraído a `backend/routes/health.js`;
  - bootstrap de base de datos/defaults movido a `backend/lib/bootstrap.js`.
- Estrategia de escalado real codificada en repo:
  - nueva guía `docs/SCALING.md` para `4+` instancias / HA;
  - nuevas variables declarativas de topología (`DEPLOYMENT_PROFILE`, `STATE_BACKEND`, `SESSION_BACKEND`, `RATE_LIMIT_BACKEND`, `QUEUE_BACKEND`, `UPLOAD_STORAGE_BACKEND`);
  - `/api/admin/metrics` y `/metrics` ahora exponen si una topología marcada como `ha` está realmente lista o sigue apoyándose en SQLite/filesystem local.

## Validación actualizada
- `docker compose -f docker-compose.yml config`: pasando.
- `docker compose -f docker-compose.prebuilt.yml config`: pasando.
- `npm run build`: pasando.
- `npm run lint`: pasando, con warning no bloqueante de `baseline-browser-mapping` desactualizado.
- `npm run test`: `14` archivos de test, `95/95` tests pasando.
- `npx vitest run backend/tests/operationalMetrics.test.js`: pasando (`1/1`).
- `npm run test:coverage`: pasando.
- `npm run test:e2e:smoke`: `4/4` escenarios pasando.
- `npm audit --omit=dev`: `0` vulnerabilidades en root.
- `npm audit --omit=dev --prefix frontend`: `0` vulnerabilidades en frontend.

## Pendiente real a día de hoy
- Conectar `/metrics` o `/api/admin/metrics` a monitorización/alertado externo real; hoy sigue documentado, pero no integrado en el repo.

# Veredicto final
- Estado: Está parcialmente lista, pero no debería salir a producción todavía
- Nota global: 6/10
- Nivel de confianza: Alto

# Resumen ejecutivo
Sendu tiene una base técnica bastante mejor que un MVP improvisado. El flujo principal funciona, la build de producción genera artefactos válidos, el lint pasa, el árbol de dependencias de producción está en `0` vulnerabilidades conocidas y el smoke E2E principal pasó en navegador real. También validé `npm run test`, con `77/77` tests pasando.

No la sacaría todavía. Hay tres bloqueadores claros: el repositorio fuente expone secretos reales y una plantilla de entorno inválida, la configuración SMTP de despliegue/documentación no coincide con cómo el backend realmente lee SMTP, y el contador de bytes de subida por chunks se incrementa antes de validar el chunk, lo que puede contaminar cuotas y dejar sesiones de upload en mal estado. Además, la cobertura no está operativa en la práctica, la observabilidad sigue siendo mayormente interna y la historia de escalado sigue limitada por SQLite.

# Lo mejor del proyecto
- El backend falla rápido si faltan variables críticas de producción en [backend/server.js](backend/server.js#L51) y [backend/server.js](backend/server.js#L56).
- La base de seguridad es buena para el tamaño del producto: Helmet/CSP/HSTS en [backend/server.js](backend/server.js#L338), cookies `secure`/`httpOnly`/`sameSite` en [backend/server.js](backend/server.js#L412), [backend/server.js](backend/server.js#L413), [backend/server.js](backend/server.js#L414) y [backend/server.js](backend/server.js#L415), y rate limiting persistente en [backend/server.js](backend/server.js#L479), [backend/server.js](backend/server.js#L511) y [backend/server.js](backend/server.js#L531).
- La subida por chunks ya está ligada a un token de sesión de upload: se emite en [backend/server.js](backend/server.js#L1493), se valida en [backend/chunkRouter.js](backend/chunkRouter.js#L177) y tiene prueba negativa en [backend/tests/e2eUploadDownload.test.js](backend/tests/e2eUploadDownload.test.js#L86).
- La validación de archivos es seria: allowlist de MIME al iniciar en [backend/server.js](backend/server.js#L1337), verificación del tipo real en [backend/server.js](backend/server.js#L1806) y [backend/server.js](backend/server.js#L1812), y soporte de antivirus opcional en [backend/server.js](backend/server.js#L1825).
- Tiene primitives operativas útiles: readiness en [backend/server.js](backend/server.js#L2889), métricas operativas en [backend/server.js](backend/server.js#L3208), y rotación de logs en [backend/lib/logger.js](backend/lib/logger.js#L56) y [backend/lib/logger.js](backend/lib/logger.js#L67).
- La postura del contenedor está por encima de la media para un proyecto pequeño: usuario no root en [Dockerfile](Dockerfile#L50) y [Dockerfile.prebuilt](Dockerfile.prebuilt#L34), `no-new-privileges` en [docker-compose.yml](docker-compose.yml#L48) y filesystem read-only en [docker-compose.yml](docker-compose.yml#L53).
- La validación ejecutable es buena: `npm run test` dio `10` archivos de test y `77` tests pasando, y `npm run test:e2e:smoke` dio `4/4` pasando.

# Bloqueadores de producción

## 1. Secretos reales expuestos y plantilla de entorno inválida
- Problema: el repositorio fuente incluye secretos reales y una plantilla de entorno inválida en [.env.example](.env.example#L13), [.env.example](.env.example#L18), [.env.example](.env.example#L81) y [.env.example](.env.example#L82). Además, `PUBLIC_ORIGIN` está mal configurado con múltiples URLs en [.env.example](.env.example#L23).
- Por qué es grave: la documentación de despliegue invita a copiar directamente esa plantilla en [README.md](README.md#L22) y [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#L15). Aunque no puedo verificar desde el código si esas credenciales siguen activas, ya deben considerarse comprometidas. Además, ese `PUBLIC_ORIGIN` no coincide con el contrato del backend y puede romper links públicos y cookies.
- Evidencia concreta:
  - `SESSION_SECRET` real en [.env.example](.env.example#L13).
  - `ENCRYPTION_KEY` real en [.env.example](.env.example#L18).
  - `SMTP_USER` y `SMTP_PASS` reales en [.env.example](.env.example#L81) y [.env.example](.env.example#L82).
  - La ruta de despliegue desde el código fuente sigue diciendo `cp .env.example .env` en [README.md](README.md#L22) y [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#L15).
- Recomendación:
  - Rotar y revocar de inmediato todo valor expuesto.
  - Reemplazar la plantilla raíz por placeholders y ejemplos sintéticos.
  - Activar secret scanning y bloquear por CI cualquier credencial real.
  - Corregir `PUBLIC_ORIGIN` para que sea una única URL válida.
- Nota importante: el build sí genera una plantilla saneada en [scripts/build.js](scripts/build.js#L155), [scripts/build.js](scripts/build.js#L159) y [scripts/build.js](scripts/build.js#L222), pero el camino de despliegue desde el repo sigue siendo inseguro.

## 2. La configuración SMTP de despliegue no coincide con la implementación real
- Problema: Docker Compose y la plantilla de entorno empujan SMTP por variables de entorno, pero el backend lee SMTP exclusivamente desde `settings` en base de datos.
- Por qué es grave: un operador puede desplegar con `.env` pensando que el correo, la verificación y el reset de contraseña están configurados, cuando en realidad el backend seguirá considerando SMTP como “no configurado”. Eso rompe onboarding, recuperación de contraseña y cualquier flujo dependiente de email.
- Evidencia concreta:
  - Compose expone SMTP por env en [docker-compose.yml](docker-compose.yml#L26), [docker-compose.yml](docker-compose.yml#L27), [docker-compose.yml](docker-compose.yml#L28), [docker-compose.yml](docker-compose.yml#L29), [docker-compose.yml](docker-compose.yml#L30) y [docker-compose.yml](docker-compose.yml#L31).
  - La plantilla raíz promueve SMTP en [.env.example](.env.example#L71).
  - El backend carga SMTP desde `settings` en [backend/server.js](backend/server.js#L617) y [backend/server.js](backend/server.js#L618).
  - La propia documentación dice otra cosa en [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md#L72).
  - Cuando SMTP “no está configurado”, el backend omite el encolado de correo en [backend/server.js](backend/server.js#L798).
- Recomendación:
  - Definir una sola fuente de verdad para SMTP y aplicarla end-to-end.
  - Si SMTP va por Admin/settings, eliminarlo de compose y de la plantilla operativa.
  - Si SMTP va por env, hacer que `getSmtpConfig()` consuma env y solo use DB si está documentado como override.
  - Añadir validación de arranque y tests de integración para este flujo.

## 3. `bytesReceived` se incrementa antes de validar completamente el chunk
- Problema: la ruta de upload por chunks suma bytes a la sesión antes de terminar todas las validaciones del fragmento.
- Por qué es grave: un cliente defectuoso o malicioso puede contaminar la cuota en progreso y dejar sesiones “envenenadas”, afectando límites y disponibilidad de subidas posteriores. En una ruta pública de uploads, esto es riesgo real de degradación o denegación parcial de servicio.
- Evidencia concreta:
  - La actualización ocurre en [backend/chunkRouter.js](backend/chunkRouter.js#L230).
  - Después de eso todavía pueden dispararse rechazos por índice fuera de rango, tamaño de chunk o total excedido en [backend/chunkRouter.js](backend/chunkRouter.js#L238), [backend/chunkRouter.js](backend/chunkRouter.js#L246) y [backend/chunkRouter.js](backend/chunkRouter.js#L271).
- Recomendación:
  - Mover la actualización de `bytesReceived` después de todas las validaciones y del rename final.
  - O recalcular los bytes autoritativos desde disco y revertir siempre en rutas de error.
  - Añadir tests negativos específicos para cuotas contaminadas por chunks inválidos.

# Riesgos importantes
- La cobertura automatizada no está realmente operativa. El script existe en [package.json](package.json#L19), pero `npm run test:coverage` falla porque falta `@vitest/coverage-v8`.
- El workflow visible en [.github/workflows/ci.yml](.github/workflows/ci.yml#L24), [.github/workflows/ci.yml](.github/workflows/ci.yml#L33), [.github/workflows/ci.yml](.github/workflows/ci.yml#L36) y [.github/workflows/ci.yml](.github/workflows/ci.yml#L39) ejecuta tests backend, lint, build y audit, pero no corre Playwright ni cobertura.
- La observabilidad es útil pero sigue siendo interna a la app. Hay readiness y métricas en [backend/server.js](backend/server.js#L2889) y [backend/server.js](backend/server.js#L3208), pero no veo integración en el repo con Prometheus, Sentry, DataDog, Grafana o envío externo de logs.
- El frontend puede degradarse fuerte en cargas de carpetas grandes. En [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx#L275) cada archivo se carga completo en memoria con `arrayBuffer()`, y luego el worker genera un ZIP completo en memoria en [frontend/src/workers/zipWorker.js](frontend/src/workers/zipWorker.js#L28) y [frontend/src/workers/zipWorker.js](frontend/src/workers/zipWorker.js#L42).
- El logging expone datos operativos de usuario. El envío de correo registra destinatario y asunto en [backend/lib/jobHandlers.js](backend/lib/jobHandlers.js#L74), y el modo mock también deja `to` y `subject` en [backend/server.js](backend/server.js#L725).
- La historia de escalabilidad sigue limitada por SQLite. El sistema usa WAL en [backend/lib/database.js](backend/lib/database.js#L37) y timeout en [backend/lib/database.js](backend/lib/database.js#L40), pero la propia documentación reconoce que para alta escritura o 4+ instancias hay que pasar a Postgres/Redis en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#L71), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#L188) y [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#L196).
- Hay huecos de accesibilidad técnica. El modal de confirmación en [frontend/src/components/ui/ConfirmModal.jsx](frontend/src/components/ui/ConfirmModal.jsx) no define `role="dialog"` ni `aria-modal`, y el dashboard usa acciones icon-only apoyadas en `title` en [frontend/src/pages/DashboardPage.jsx](frontend/src/pages/DashboardPage.jsx#L224) y [frontend/src/pages/DashboardPage.jsx](frontend/src/pages/DashboardPage.jsx#L240).

# Mejoras recomendadas
- Modularizar el backend. El propio roadmap lo admite en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#L87) y [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#L89). Hoy conviven auth, upload, admin y observabilidad en [backend/server.js](backend/server.js#L1313), [backend/server.js](backend/server.js#L2523) y [backend/server.js](backend/server.js#L3208).
- Endurecer el cifrado de settings sensibles. [backend/lib/encryption.js](backend/lib/encryption.js#L19) y [backend/lib/encryption.js](backend/lib/encryption.js#L39) usan AES-CBC, y ante error devuelven el texto original en [backend/lib/encryption.js](backend/lib/encryption.js#L47). Preferir AES-GCM y fallo cerrado.
- Añadir validación fuerte de `settings` administrativos. La allowlist en [backend/server.js](backend/server.js#L2534) es buena, pero faltan rangos y formatos más estrictos para límites y SMTP.
- Llevar Playwright smoke y cobertura a CI, no solo a ejecución manual.
- Reducir el logging de PII y dejar políticas explícitas de retención/sanitización.
- Actualizar dependencias rezagadas aunque hoy no tengan CVE explotable: Express, express-session, dotenv, React, react-router-dom, Recharts, winston.

# Evaluación por categoría
- Arquitectura: 6/10
- Calidad de código: 6/10
- Seguridad: 5/10
- Performance: 6/10
- Testing: 7/10
- Mantenibilidad: 5/10
- Preparación operativa para producción: 6/10

# Qué falta para llegar a 8/10, 9/10 y 10/10

## Para llegar a 8/10
- Rotar y eliminar todos los secretos expuestos.
- Corregir la plantilla raíz y `PUBLIC_ORIGIN`.
- Arreglar el bug de `bytesReceived` en chunks.
- Unificar la configuración SMTP y validarla de verdad.
- Reparar `test:coverage`.
- Ejecutar Playwright smoke en CI junto con los checks ya existentes.

## Para llegar a 9/10
- Añadir observabilidad y alertas externas verificables.
- Hacer pruebas de carga, de archivos grandes y de concurrencia real.
- Reducir logging sensible.
- Endurecer el cifrado de settings.
- Cubrir mejor escenarios negativos de upload/download y continuidad de sesión.

## Para llegar a 10/10
- Separar backend por dominios/servicios y reducir el acoplamiento de [backend/server.js](backend/server.js).
- Definir estrategia de escalado real más allá de SQLite para alta disponibilidad.
- Automatizar despliegue, rollback y verificación post-release.
- Tener SLOs y dashboards externos maduros, no solo panel interno.

# Plan de acción priorizado

## 1. Urgente
- Revocar y rotar todas las credenciales expuestas en [.env.example](.env.example#L13), [.env.example](.env.example#L18), [.env.example](.env.example#L81) y [.env.example](.env.example#L82).
- Sustituir `.env.example` por placeholders y corregir `PUBLIC_ORIGIN`.
- Arreglar el orden de actualización de `bytesReceived` en [backend/chunkRouter.js](backend/chunkRouter.js#L230).
- Elegir y documentar una única fuente de verdad para SMTP.

## 2. Importante
- Instalar la dependencia de cobertura, hacer que `npm run test:coverage` funcione y meterla en CI.
- Ejecutar `npm run test:e2e:smoke` en CI.
- Conectar `/api/admin/metrics` a monitorización/alertado externo.
- Probar archivos grandes, resume, disco y concurrencia bajo presión real.

## 3. Deseable
- Modularizar [backend/server.js](backend/server.js).
- Reducir el coste de memoria del zipping en frontend.
- Mejorar accesibilidad de modales y acciones icon-only.
- Actualizar dependencias menores/mayores con una ronda de regresión controlada.

# Conclusión final
No la lanzaría hoy.

La base es suficientemente buena como para no llamarla frágil, pero todavía no alcanza estándar de producción por seguridad operacional, por inconsistencias en despliegue y por un bug real en el camino de uploads.

La condición mínima para replantear el release es cerrar el problema de secretos/configuración, resolver el bug de cuota por chunks y alinear el pipeline de testing/CI con lo que realmente querrías confiar en producción.

# Validación ejecutada
- `npm run test`: `10` archivos de test, `77/77` tests pasando.
- `npm run test:e2e:smoke`: `4/4` escenarios pasando.
- `npm run lint`: pasando, con warning no bloqueante de `baseline-browser-mapping` desactualizado.
- `npm run build`: pasando.
- `npm audit --omit=dev`: `0` vulnerabilidades en root.
- `npm audit --omit=dev --prefix frontend`: `0` vulnerabilidades en frontend.
- `npm run test:coverage`: fallando por dependencia faltante `@vitest/coverage-v8`.
