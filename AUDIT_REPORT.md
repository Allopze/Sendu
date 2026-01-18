# Auditoría Sendu v2 (Producto, UX y Arquitectura)

Fecha: 2026-01-17

## Ejecución y evidencia
- Proyecto levantado en modo dev con `npm run dev`; backend inició en 3000 y frontend en 2000 (logs OK). No se realizó navegación UI completa por entorno sin navegador interactivo.
- Evidencia de configuración y flujos basada en código y documentación.

---

# A) Product Map

## ¿Qué problema resuelve?
Plataforma de intercambio de archivos con subidas en chunks, links protegidos por contraseña y expiración, panel admin y branding self‑hosted. Objetivo: compartir archivos grandes de forma segura, con control y operación simple. Ver [README.md](README.md).

## Usuarios y roles
- Invitado: sube archivos con límites estrictos, comparte link, descarga según permisos. Ver [backend/server.js](backend/server.js) y [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
- Usuario registrado: sube con límites ampliados, ve su historial, elimina archivos. Ver [frontend/src/pages/DashboardPage.jsx](frontend/src/pages/DashboardPage.jsx).
- Admin: gestiona usuarios, branding, SMTP, límites, métricas y limpieza. Ver [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx) y [docs/ADMIN.md](docs/ADMIN.md).

## Módulos y responsabilidades
- Backend API (Node/Express): auth, upload, download, admin, settings, health. Ver [backend/server.js](backend/server.js) y [docs/API.md](docs/API.md).
- Persistencia SQLite: users, files, settings, upload_sessions, etc. Ver [backend/lib/migrations.js](backend/lib/migrations.js).
- Stores persistentes: sesiones, CSRF, rate limit, tokens. Ver [backend/lib/persistentStores.js](backend/lib/persistentStores.js).
- Cola de trabajos: emails, limpieza, branding. Ver [backend/lib/jobQueue.js](backend/lib/jobQueue.js).
- Métricas básicas in-memory. Ver [backend/lib/metrics.js](backend/lib/metrics.js).
- Frontend React/Vite: Home (subida), Dashboard, Admin, Download, Auth. Ver [frontend/src/App.jsx](frontend/src/App.jsx).
- Scripts operativos: backup/restore/cleanup. Ver [docs/OPERATIONS.md](docs/OPERATIONS.md).
- Infra y despliegue: Docker/Compose + health checks. Ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Configuración disponible
- Variables de entorno (producción y dev). Ver [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).
- Panel admin: branding, SMTP, límites de upload, chunking, rate limit, concurrencia, footer. Ver [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx).
- Settings públicos: branding y límites. Ver [backend/server.js](backend/server.js) y [frontend/src/api/client.js](frontend/src/api/client.js).

## Endpoints/API clave
- Auth: registro, login, verify, reset. Ver [docs/API.md](docs/API.md).
- Upload: init, chunk, complete, cancel. Ver [docs/API.md](docs/API.md).
- Download: meta, validate, download. Ver [docs/API.md](docs/API.md).
- Admin: stats, users, settings, branding, jobs, metrics. Ver [docs/API.md](docs/API.md).

## Modelos de datos principales
- `users`, `files`, `settings`, `upload_sessions`, `guest_uploads`, `reports`. Ver [backend/lib/migrations.js](backend/lib/migrations.js).
- `sessions`, `csrf_tokens`, `download_tokens`, `rate_limits`, `job_queue`. Ver [backend/lib/persistentStores.js](backend/lib/persistentStores.js) y [backend/lib/jobQueue.js](backend/lib/jobQueue.js).

## Flujos principales
- Happy path (invitado): Home → seleccionar archivos → upload en chunks → link de descarga → descarga. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx) y [frontend/src/pages/DownloadPage.jsx](frontend/src/pages/DownloadPage.jsx).
- Happy path (usuario): Registro/verify → login → upload → Dashboard → copiar link/eliminar. Ver [frontend/src/pages/LoginPage.jsx](frontend/src/pages/LoginPage.jsx) y [frontend/src/pages/DashboardPage.jsx](frontend/src/pages/DashboardPage.jsx).
- Admin: login → Admin panel → branding/SMTP/limits → limpieza jobs. Ver [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx).

## Edge cases relevantes
- Usuario no verificado intenta subir → 403. Ver [backend/server.js](backend/server.js).
- Invitado supera límites de subida → 429. Ver [backend/server.js](backend/server.js).
- Archivo expirado o max downloads alcanzado → 410. Ver [backend/server.js](backend/server.js).
- Chunk missing / disk space insuficiente / antivirus no disponible → error de subida. Ver [backend/server.js](backend/server.js).

---

# B) Experiencia y Operaciones (Audit)

## UX/UI
Fortalezas: home claro, estado de subida, copy link, panel admin completo. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx) y [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx).
Fricciones:
- Estados de error de subida no siempre traducen causas (verificación, límites, antivirus) a CTA útil. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
- No hay vista de “mis envíos” para invitados (solo logged). Ver [frontend/src/pages/DashboardPage.jsx](frontend/src/pages/DashboardPage.jsx).
- Falta configuración UI para `maxDownloads` (backend lo soporta). Ver [backend/lib/migrations.js](backend/lib/migrations.js).

## Performance
- Subidas chunked, compresión y validación MIME sólidas. Ver [backend/server.js](backend/server.js).
- Posible presión de memoria al comprimir con JSZip para múltiples archivos. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
- Rate limiting por instancia (no distribuido). Ver [backend/lib/persistentStores.js](backend/lib/persistentStores.js).

## Seguridad
Cobertura sólida: CSRF, CSP, cookies seguras, MIME allowlist, hashing de tokens y contraseñas. Ver [docs/SECURITY.md](docs/SECURITY.md) y [backend/server.js](backend/server.js).
Huecos razonables:
- Sin MFA / sin políticas de contraseñas configurables.
- Sin auditoría de acciones admin/descargas.

## Observabilidad
- Logs y métricas básicas; health checks. Ver [docs/OPERATIONS.md](docs/OPERATIONS.md) y [backend/lib/metrics.js](backend/lib/metrics.js).
- Falta tracing y export de métricas (Prometheus). Métricas son in-memory.

## Admin & mantenimiento
- Backup/restore/cleanup y jobs listos. Ver [docs/OPERATIONS.md](docs/OPERATIONS.md).
- Falta exportación de datos (usuarios/archivos) y auditoría de acciones.

## Despliegue/actualización
- Docker y release ZIP bien documentados. Ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) y [docs/RELEASE.md](docs/RELEASE.md).
- Multi‑replica limitado por rate limit in‑memory y SQLite compartido. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

# C) Benchmarking (categoría y gaps)

## Categoría
File‑sharing estilo WeTransfer/Dropbox Transfer, con admin y branding self‑hosted.

## Patrones de mercado útiles
- WeTransfer/Dropbox Transfer: expiración, password, max downloads, notificaciones, preview.
- Self‑hosted (FileRun/Nextcloud share): auditoría, cuotas por usuario, retención, logs.

## Must‑have faltantes (coherentes con el repo)
- `maxDownloads` configurable por archivo desde UI (ya existe en DB). Ver [backend/lib/migrations.js](backend/lib/migrations.js).
- Reintentos y reanudación de subidas (ya existe `upload_sessions`). Ver [backend/lib/migrations.js](backend/lib/migrations.js).
- Notificación de descarga (plantillas ya existen). Ver [backend/templates/email/index.js](backend/templates/email/index.js).

---

# 1) Current State Summary (máx. 12 líneas)
1) Fortalezas: arquitectura clara, backend sólido con CSRF/rate‑limit/MIME/AV, admin completo y docs operativas. Ver [backend/server.js](backend/server.js) y [docs/SECURITY.md](docs/SECURITY.md).
2) Fortalezas: cola de jobs y stores persistentes en SQLite listos para escala moderada. Ver [backend/lib/jobQueue.js](backend/lib/jobQueue.js) y [backend/lib/persistentStores.js](backend/lib/persistentStores.js).
3) Debilidades: UX de errores de subida/verify no guía al usuario y carece de estados accionables. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
4) Debilidades: no hay configuración UI para límites de descarga por archivo. Ver [backend/lib/migrations.js](backend/lib/migrations.js).
5) Debilidades: métricas no exportables y sin auditoría de acciones. Ver [backend/lib/metrics.js](backend/lib/metrics.js).
6) Oportunidades claras: reanudación de subidas, notificaciones de descarga y audit log. Ver [backend/lib/migrations.js](backend/lib/migrations.js).

---

# 2) Prioritized Backlog

## Mejoras (incrementales)
### P0
- UX de verificación y errores de subida con CTAs claras (evita bloqueo del flujo core).

### P1
- Configurar `maxDownloads` por archivo desde UI y API.
- Reintentos y reanudación de subida tras refresh o cortes.

### P2
- Panel de auditoría (acciones admin, descargas, intentos fallidos).

### P3
- Ajustes finos de accesibilidad y atajos de teclado.

## Nuevas features
### P1
- Notificación al remitente cuando se descarga el archivo.

### P2
- Reporte de abuso/takedown usando tabla `reports`.
- Previews y miniaturas para archivos soportados.

### P3
- Compartición por email con plantilla y branding.

---

# 3) Feature Specs (P0–P2)

## P0 — UX de verificación y errores de subida
- name: Verificación guiada y bloqueo explícito de uploads
- problem_statement: usuarios no verificados reciben errores genéricos y abandonan el flujo principal.
- target_user: usuarios registrados no verificados.
- user_flow: Home → subir → si 403 verify → mostrar banner con CTA “Reenviar verificación” y “Ir a verify”.
- requirements_and_rules: mostrar estado de verificación en navbar, interceptar error 403, permitir resend.
- edge_cases: SMTP no configurado; usuario ya verificado; rate limit en resend.
- technical_changes: backend (endpoints, modelos, validación): reutilizar `/auth/resend-verification` ya existente. Ver [backend/server.js](backend/server.js).
- technical_changes: frontend (pantallas/componentes): banner + modal en Home/Dashboard; feedback en Login. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
- technical_changes: database (migraciones): no.
- technical_changes: infra (docker, env vars): no.
- risks_and_dependencies: dependencia de SMTP para email real.
- effort_estimate (S/M/L) + justification: S (UI + manejo de error + llamada a endpoint existente).
- validation_plan (acceptance_criteria + tests): subir archivo con usuario no verificado → CTA visible → resend OK → reintento exitoso.

## P1 — `maxDownloads` por archivo
- name: Límite de descargas por archivo
- problem_statement: el backend soporta `maxDownloads` pero no hay UI ni input en upload.
- target_user: usuarios y admins.
- user_flow: Home → opciones avanzadas → set max downloads → upload → DownloadPage muestra contador.
- requirements_and_rules: validar 1–1000; nulo = ilimitado; aplicar en `/upload/init`.
- edge_cases: archivos existentes sin límite; admin override.
- technical_changes: backend (endpoints, modelos, validación): aceptar `maxDownloads` en `/upload/init` y guardar en `files`. Ver [backend/server.js](backend/server.js).
- technical_changes: frontend (pantallas/componentes): añadir input en Home y mostrar en Dashboard/Download. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx) y [frontend/src/pages/DownloadPage.jsx](frontend/src/pages/DownloadPage.jsx).
- technical_changes: database (migraciones): ya existe columna `maxDownloads` en `files`.
- technical_changes: infra (docker, env vars): no.
- risks_and_dependencies: none.
- effort_estimate (S/M/L) + justification: M (UI + validación + API).
- validation_plan (acceptance_criteria + tests): archivo con límite llega a 410 en descarga; UI indica contador.

## P1 — Reanudación de subidas
- name: Resume + retry de chunks
- problem_statement: cortes de red o refresh obligan a reiniciar uploads largos.
- target_user: usuarios con archivos grandes.
- user_flow: upload → fallo → reintentar → continuar desde último chunk; refresh → retomar.
- requirements_and_rules: registrar progreso en `upload_sessions`; persistir en localStorage; endpoint de estado.
- edge_cases: sesión expirada, chunks corruptos, límite de concurrencia alcanzado.
- technical_changes: backend (endpoints, modelos, validación): agregar `GET /upload/status?uploadId=` y actualizar `bytesReceived`. Ver [backend/lib/migrations.js](backend/lib/migrations.js) y [backend/server.js](backend/server.js).
- technical_changes: frontend (pantallas/componentes): reintentos exponenciales por chunk, recuperación al recargar. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
- technical_changes: database (migraciones): usar `bytesReceived` ya existente.
- technical_changes: infra (docker, env vars): no.
- risks_and_dependencies: manejo de consistencia entre chunks y meta.
- effort_estimate (S/M/L) + justification: M/L (estado + endpoint + UI resiliente).
- validation_plan (acceptance_criteria + tests): cortar red → reintento automático → upload completa sin reiniciar.

## P1 — Notificación de descarga
- name: Email al remitente cuando hay descarga
- problem_statement: remitentes no saben si el archivo fue descargado.
- target_user: usuarios registrados.
- user_flow: upload → marcar “notificar descarga” → cada download envía email.
- requirements_and_rules: opcional por archivo; rate limit para evitar spam.
- edge_cases: SMTP no configurado; múltiples descargas; archivo protegido por password.
- technical_changes: backend (endpoints, modelos, validación): almacenar flag en `files`; en `/download/:id` encolar email. Ver [backend/server.js](backend/server.js) y [backend/lib/jobQueue.js](backend/lib/jobQueue.js).
- technical_changes: frontend (pantallas/componentes): toggle en Home y Dashboard. Ver [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
- technical_changes: database (migraciones): agregar columna `notifyOnDownload` en `files`.
- technical_changes: infra (docker, env vars): SMTP configurado vía admin. Ver [docs/ADMIN.md](docs/ADMIN.md).
- risks_and_dependencies: volumen de emails y deliverability.
- effort_estimate (S/M/L) + justification: M (migración + emails + UI).
- validation_plan (acceptance_criteria + tests): descargar archivo → email en cola → envío OK.

## P2 — Auditoría de acciones
- name: Audit log de acciones clave
- problem_statement: sin trazabilidad de acciones admin y descargas.
- target_user: admin.
- user_flow: Admin → Audit log → filtros por fecha/usuario/acción.
- requirements_and_rules: registrar login, cambios settings, delete file, download.
- edge_cases: alto volumen, anonimización de IP.
- technical_changes: backend (endpoints, modelos, validación): tabla `audit_logs`, middleware de logging y endpoint `/admin/audit`. Ver [backend/server.js](backend/server.js).
- technical_changes: frontend (pantallas/componentes): nueva sección en Admin. Ver [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx).
- technical_changes: database (migraciones): nueva tabla `audit_logs`.
- technical_changes: infra (docker, env vars): no.
- risks_and_dependencies: crecimiento de DB.
- effort_estimate (S/M/L) + justification: L (infra + UI + storage).
- validation_plan (acceptance_criteria + tests): acción admin genera registro visible.

## P2 — Reporte de abuso
- name: Reporte de enlace y revisión
- problem_statement: no hay canal formal para denunciar archivos.
- target_user: visitantes.
- user_flow: DownloadPage → “Reportar” → envío → Admin revisa.
- requirements_and_rules: captcha simple o rate limit; estados pending/closed.
- edge_cases: spam, reportes duplicados.
- technical_changes: backend (endpoints, modelos, validación): CRUD sobre `reports`. Ver [backend/lib/migrations.js](backend/lib/migrations.js).
- technical_changes: frontend (pantallas/componentes): botón y formulario en Download + admin list. Ver [frontend/src/pages/DownloadPage.jsx](frontend/src/pages/DownloadPage.jsx).
- technical_changes: database (migraciones): tabla ya existe (`reports`).
- technical_changes: infra (docker, env vars): no.
- risks_and_dependencies: moderación y SLA.
- effort_estimate (S/M/L) + justification: M.
- validation_plan (acceptance_criteria + tests): reporte creado → visible en Admin → cambio de estado.

---

# 4) Top 10 Quick Wins (1–3 días)
1) Mensajes de error de upload con CTA de verificación — Impacto: reduce abandono. Qué tocar: [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx). Validar: simular 403.
2) Mostrar límites efectivos (guest vs user) en Home — Impacto: claridad. Qué tocar: [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx) y [frontend/src/api/client.js](frontend/src/api/client.js). Validar: comparar logged/guest.
3) Tooltip de expiración y estado en Dashboard — Impacto: control. Qué tocar: [frontend/src/pages/DashboardPage.jsx](frontend/src/pages/DashboardPage.jsx). Validar: archivos con `expiresAt`.
4) Estado vacío con CTA “Nuevo envío” en Dashboard — Impacto: activación. Qué tocar: [frontend/src/pages/DashboardPage.jsx](frontend/src/pages/DashboardPage.jsx).
5) Copiar link con confirmación en Download — Impacto: share. Qué tocar: [frontend/src/pages/DownloadPage.jsx](frontend/src/pages/DownloadPage.jsx).
6) Botón “Reintentar” en fallos de upload — Impacto: resiliencia. Qué tocar: [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
7) Textos de error consistentes (ES) — Impacto: claridad. Qué tocar: [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx) y [frontend/src/pages/DownloadPage.jsx](frontend/src/pages/DownloadPage.jsx).
8) Mostrar estado SMTP en Admin (configurado/no) — Impacto: operación. Qué tocar: [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx).
9) Indicador de espacio y tamaño del archivo antes de subir — Impacto: reduce fallos. Qué tocar: [frontend/src/pages/HomePage.jsx](frontend/src/pages/HomePage.jsx).
10) Enlaces a docs desde Admin (OPERATIONS/SECURITY) — Impacto: soporte. Qué tocar: [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx).

---

# 5) Monetización o Tiers (si aplica)
Aplica si se ofrece SaaS o multi‑tenant. Para self‑hosted puro no es necesario.

Propuesta de tiers (si se productiza):
- Free: 2GB total, 100MB por archivo, 7 días de retención, sin branding.
- Pro: 100GB total, 5GB por archivo, 30 días, branding básico, notificación de descarga.
- Enterprise: ilimitado, SSO, auditoría completa, políticas de retención, soporte.

Métricas para validar valor:
- Activación: % uploads completados y % descargas efectivas.
- Retención: usuarios activos 7/30 días.
- Conversión: upgrade rate vs límites alcanzados.

