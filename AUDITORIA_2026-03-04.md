# Auditoria Tecnica Sendu

Fecha: 2026-03-04
Alcance: cliente + servidor + jobs + persistencia + scripts + CI + Docker/Nginx
Modo: read-only (sin cambios de codigo)

## 0) Preconditions y limites de la auditoria

1. Alcance auditado: backend, frontend, jobs, persistencia, scripts, CI e infraestructura Docker/Nginx.
2. Metodo: revision estatica con evidencia en codigo + validacion de ejecucion (`test`, `lint`, `build`, scripts auxiliares).
3. Restricciones respetadas: no se modifico codigo, no se aplicaron parches, no se instalaron dependencias.
4. Nivel de certeza:
   - Alta en hallazgos con evidencia directa de ruta/simbolo/linea y repro local.
   - Media en riesgos dependientes de configuracion de despliegue o concurrencia.
5. Estado operativo observado:
   - `npm run test`: pasa en la ultima corrida (9 files, 63 tests).
   - `npm run lint --prefix frontend`: falla (37 errores, 2 warnings).
   - `npm run build --prefix frontend`: compila con warning de bundle grande.

## A) System Map

1. Frontend SPA React con providers globales de auth/theme/branding/toast/upload y routing protegido por rol.
   - Referencias: `frontend/src/App.jsx:1`, `frontend/src/App.jsx:29`, `frontend/src/App.jsx:38`, `frontend/src/components/auth/ProtectedRoute.jsx:10`.
2. Cliente API centralizado con `fetch` + `credentials: include` + CSRF header en metodos mutantes.
   - Referencias: `frontend/src/api/client.js:11`, `frontend/src/api/client.js:19`, `frontend/src/api/client.js:64`, `frontend/src/api/client.js:108`.
3. Backend Express monolitico con middleware de seguridad (`helmet`, `cors`, sesiones, CSRF), auth, upload, download, admin y health/readiness.
   - Referencias: `backend/server.js:301`, `backend/server.js:333`, `backend/server.js:390`, `backend/server.js:787`, `backend/server.js:1224`, `backend/server.js:1790`, `backend/server.js:1941`, `backend/server.js:2507`.
4. Plano de carga de chunks desacoplado via router dedicado con `multer` y control de cuota por sesion/usuario/invitado.
   - Referencias: `backend/server.js:286`, `backend/chunkRouter.js:31`, `backend/chunkRouter.js:138`, `backend/chunkRouter.js:212`.
5. Persistencia en SQLite con esquema versionado + stores persistentes para CSRF/sesiones/tokens/rate-limit.
   - Referencias: `backend/lib/migrations.js:24`, `backend/lib/persistentStores.js:27`, `backend/lib/persistentStores.js:35`, `backend/lib/persistentStores.js:95`.
6. Cola de trabajos en SQLite (emails, cleanup, branding conversion) con reintentos/backoff y locks.
   - Referencias: `backend/lib/jobQueue.js:18`, `backend/lib/jobQueue.js:52`, `backend/lib/jobQueue.js:69`, `backend/server.js:2920`.
7. Flujo principal real:
   - Upload: `HomePage`/`UploadContext` -> `apiClient.initUpload` -> `POST /api/upload/init` -> `POST /api/upload/chunk` -> `POST /api/upload/complete`.
   - Referencias: `frontend/src/pages/HomePage.jsx:6`, `frontend/src/context/UploadContext.jsx:402`, `frontend/src/api/client.js:64`, `backend/server.js:1224`, `backend/server.js:1435`.
   - Download: `GET /api/meta/:id` -> `POST /api/download/:id/validate` (si password) -> `GET /api/download/:id`.
   - Referencias: `frontend/src/pages/DownloadPage.jsx:22`, `backend/server.js:1747`, `backend/server.js:1790`.

## B) Hallazgos criticos (P0/P1)

No se encontro P0 confirmado en esta revision.

### AUD-001 - Doble cifrado de `smtpPass` al guardar settings

- Tipo: Integridad de configuracion
- Severidad: P1
- Prioridad: Now
- Confianza: Alta
- Esfuerzo: M
- Ubicacion: `backend/server.js:2177`, `backend/server.js:2224`, `backend/server.js:568`, `frontend/src/pages/AdminPage.jsx:66`, `frontend/src/pages/AdminPage.jsx:98`, `frontend/src/pages/AdminPage.jsx:911`
- Evidencia: backend devuelve settings "tal cual" (incluyendo `smtpPass` cifrada), frontend la reusa y reenvia, backend vuelve a cifrar cualquier valor truthy de `smtpPass`.
- Impacto: al guardar cambios no relacionados, puede quedar una password SMTP invalida y romper envio de correos (verify/reset/welcome).
- Repro: configurar SMTP -> abrir Admin -> cambiar otro campo -> guardar -> probar envio.
- Remediacion: no devolver `smtpPass` cifrada al frontend (enmascarar), o no recifrar si ya esta cifrada, o separar endpoint dedicado de secreto.
- Verificacion: guardar settings sin tocar password no debe afectar envio.
- Test regresion: integracion admin-settings roundtrip + `testEmail` exitoso antes/despues.

### AUD-002 - Contrato de politica de password inconsistente entre cliente y servidor

- Tipo: Contrato API/UX
- Severidad: P1
- Prioridad: Now
- Confianza: Alta
- Esfuerzo: S
- Ubicacion: `backend/server.js:781`, `backend/server.js:803`, `frontend/src/pages/RegisterPage.jsx:32`, `frontend/src/pages/ResetPasswordPage.jsx:65`, `frontend/src/pages/ResetPasswordPage.jsx:165`, `frontend/src/pages/AdminPage.jsx:193`
- Evidencia: backend exige `>=8` + letra + numero; frontend valida/mensajeria de `>=6`.
- Impacto: fallos evitables en registro/reset, friccion de soporte y percepcion de error inconsistente.
- Repro: usar password de 6 chars; frontend la permite, backend rechaza.
- Remediacion: centralizar politica (constante compartida o endpoint de policy).
- Verificacion: misma policy y mismo mensaje en register/reset/admin reset.
- Test regresion: e2e de register/reset con casos borde (7, 8, sin numero, sin letra).

### AUD-003 - Ventana de carrera en bootstrap admin durante registro

- Tipo: Seguridad/Autorizacion
- Severidad: P1
- Prioridad: Now
- Confianza: Media-Alta
- Esfuerzo: M
- Ubicacion: `backend/server.js:810`, `backend/server.js:812`, `backend/server.js:828`, `backend/server.js:835`, `backend/server.js:837`, `backend/server.js:841`
- Evidencia: decision de `bootstrapRequested` ocurre antes de `await bcrypt.hash` e `INSERT`; dos solicitudes concurrentes pueden computar estado elegible y ambas insertar `role='admin'`.
- Impacto: creacion no intencional de multiples admins en la fase de bootstrap/token.
- Repro: disparar registros paralelos en DB vacia o ventana de bootstrap token.
- Remediacion: transaccion atomica check-and-set bootstrap flag + creacion de usuario.
- Verificacion: solo un registro puede obtener rol admin por bootstrap.
- Test regresion: test concurrente de registro dual (`Promise.all`) con asercion de 1 admin.

### AUD-004 - Gate de calidad CI bloqueado por lint frontend

- Tipo: Entrega/Calidad
- Severidad: P1
- Prioridad: Now
- Confianza: Alta
- Esfuerzo: M
- Ubicacion: `.github/workflows/ci.yml:34`, `frontend/src/components/ui/FileItem.jsx:47`, `frontend/src/components/upload/DropZone.jsx:23`, `frontend/vite.config.js:14`
- Evidencia: `npm run lint --prefix frontend` falla con 37 errores y 2 warnings; CI ejecuta ese paso.
- Impacto: bloqueo de merges/release y ruido tecnico continuo.
- Repro: ejecutar `npm run lint --prefix frontend`.
- Remediacion: plan de saneamiento en 1-2 PRs (hooks, exports fast-refresh, no-unused-vars, globals Node en config).
- Verificacion: lint en verde local + CI.
- Test regresion: incorporar lint estricto en pipeline como required check.

## C) Hallazgos importantes (P2)

### AUD-005 - Texto corrupto/encoding roto en verificacion de email

- Tipo: UX/Calidad i18n
- Severidad: P2
- Prioridad: Next
- Confianza: Alta
- Esfuerzo: S
- Ubicacion: `frontend/src/pages/VerifyEmailPage.jsx:28`, `frontend/src/pages/VerifyEmailPage.jsx:29`, `frontend/src/pages/VerifyEmailPage.jsx:91`, `frontend/src/pages/VerifyEmailPage.jsx:123`
- Evidencia: multiples cadenas con mojibake y whitespace irregular detectado por lint.
- Impacto: UI degradada en flujo sensible (verificacion).
- Remediacion: normalizar codificacion UTF-8 y texto fuente.
- Verificacion: render correcto de acentos y sin errores `no-irregular-whitespace`.

### AUD-006 - `JSON.parse` sin proteccion en plantillas de email admin

- Tipo: Robustez frontend/backend contract
- Severidad: P2
- Prioridad: Next
- Confianza: Alta
- Esfuerzo: S
- Ubicacion: `frontend/src/pages/AdminPage.jsx:962`, `backend/server.js:2195`, `backend/server.js:2206`, `backend/server.js:2224`
- Evidencia: frontend parsea directo `settings.emailTemplates`; backend acepta string sin validar estructura JSON.
- Impacto: una configuracion corrupta puede romper render del panel admin.
- Remediacion: validar JSON en backend y proteger parse en frontend (`try/catch` + fallback).
- Verificacion: settings invalido no tumba la pantalla.

### AUD-007 - Endpoints mutantes de upload excluidos de CSRF

- Tipo: Seguridad defensiva (dependiente de despliegue)
- Severidad: P2
- Prioridad: Next
- Confianza: Media
- Esfuerzo: M
- Ubicacion: `backend/server.js:390`, `backend/server.js:397`, `backend/server.js:398`, `backend/server.js:399`, `backend/server.js:400`
- Evidencia: `/upload/init|chunk|complete|cancel` estan en `ignorePaths` de CSRF.
- Impacto: con cookies `SameSite=None` y frontend/backend separados, aumenta superficie de CSRF de consumo de recursos.
- Remediacion: exigir CSRF al menos en `init/cancel` o validar `Origin/Referer` estrictamente.
- Verificacion: requests cross-site no autorizados rechazados.

### AUD-008 - Riesgo de intermitencia en tests por DB compartida entre suites

- Tipo: Fiabilidad de test
- Severidad: P2
- Prioridad: Next
- Confianza: Media
- Esfuerzo: S
- Ubicacion: `backend/tests/auth.test.js:16`, `backend/tests/download.test.js:15`, `backend/server.js:2887`
- Evidencia: ambas suites apuntan a `data/test.sqlite`; `startServer` devuelve `null` si `db` ya existe, lo que acopla estado.
- Impacto: potencial flakiness/contencion en escenarios paralelos.
- Remediacion: DB por suite (`test-auth.sqlite`, `test-download.sqlite`) y aislamiento explicito.
- Verificacion: multiples corridas seguidas estables sin fallos aleatorios.

## D) Hallazgos menores (P3)

### AUD-009 - Script operativo roto por dependencia no declarada

- Tipo: Tooling
- Severidad: P3
- Prioridad: Later
- Confianza: Alta
- Esfuerzo: S
- Ubicacion: `backend/check_settings.js:1`, `package.json:1`
- Evidencia: `node backend/check_settings.js` falla con `ERR_MODULE_NOT_FOUND` para `node-fetch`.
- Impacto: script de diagnostico no usable.
- Remediacion: usar `fetch` nativo de Node 20 o declarar dependencia.

### AUD-010 - Metodo de cliente API obsoleto/inconsistente para descarga

- Tipo: Deuda de contrato
- Severidad: P3
- Prioridad: Later
- Confianza: Alta
- Esfuerzo: S
- Ubicacion: `frontend/src/api/client.js:95`, `backend/server.js:1790`
- Evidencia: cliente define `POST /download/:id`; backend expone `GET /api/download/:id`; metodo ademas no se usa.
- Impacto: deuda tecnica y potencial bug futuro si alguien lo reutiliza.
- Remediacion: eliminar o alinear metodo.

### AUD-011 - Mensaje de producto desalineado con limites reales por defecto

- Tipo: UX/expectativas
- Severidad: P3
- Prioridad: Later
- Confianza: Alta
- Esfuerzo: S
- Ubicacion: `frontend/src/pages/RegisterPage.jsx:51`, `backend/server.js:210`, `backend/server.js:2412`
- Evidencia: UI promete hasta 50GB, backend por defecto para usuario registrado = 100MB.
- Impacto: expectativas incorrectas y tickets de soporte.
- Remediacion: mostrar limite dinamico real desde `/api/settings/limits`.

### AUD-012 - Bundle principal grande en build

- Tipo: Performance
- Severidad: P3
- Prioridad: Later
- Confianza: Alta
- Esfuerzo: M
- Ubicacion: salida de `npm run build --prefix frontend` (chunk JS ~769KB)
- Impacto: TTI/LCP peores en redes lentas.
- Remediacion: code-splitting por rutas y `manualChunks`.

## E) Riesgos transversales

1. Complejidad concentrada en `backend/server.js` eleva riesgo de regresion por acoplamiento.
   - Referencia: `backend/server.js:1`.
2. Senales de drift frontend (codigo duplicado y/o no usado alrededor de upload) aumentan costo de mantenimiento.
   - Referencias: `frontend/src/context/UploadContext.jsx:1`, `frontend/src/hooks/useUpload.js:1`.
3. Base de seguridad funcional buena (rate limit persistente, tokens de descarga de un solo uso, sessions persistentes), pero conviene endurecer bordes de bootstrap y CSRF en uploads.
   - Referencias: `backend/lib/persistentStores.js:311`, `backend/server.js:1747`, `backend/server.js:390`.

## F) Evidencia de ejecucion

1. `npm run test`: 9 passed, 63 passed.
2. `npm run lint --prefix frontend`: 37 errors, 2 warnings.
3. `npm run build --prefix frontend`: build OK con warning de chunk >500kB.
4. `node backend/check_settings.js`: falla por `node-fetch` no encontrado.

## G) Plan priorizado (Now/Next/Later)

1. Now: corregir `AUD-001` (SMTP double encryption).
2. Now: unificar policy de password (`AUD-002`).
3. Now: cerrar carrera de bootstrap admin (`AUD-003`).
4. Now: dejar lint en verde (`AUD-004`) para destrabar CI.
5. Next: robustecer templates JSON (`AUD-006`).
6. Next: corregir encoding de verify page (`AUD-005`).
7. Next: revisar CSRF en upload mutaciones (`AUD-007`).
8. Next: aislar DB por suite de test (`AUD-008`).
9. Later: arreglar script `check_settings` (`AUD-009`).
10. Later: limpiar API client muerto/inconsistente (`AUD-010`).
11. Later: alinear copy de limites (`AUD-011`).
12. Later: plan de code-splitting (`AUD-012`).

## H) Mejoras/nuevas funcionalidades alineadas al diseno actual

1. Endpoint de politica de password consumido por frontend para evitar drift futuro.
2. Historial/auditoria de cambios de settings admin (quien cambio que y cuando), reutilizando SQLite y sesion.
3. SMTP secret rotation safe flow (campo password con opcion explicita cambiar en vez de roundtrip implicito).
4. Dashboard de salud de cola de jobs (pending/failed/dead con acciones de reintento), aprovechando `job_queue`.
5. Descarga progresiva de frontend por rutas (`lazy`) para reducir bundle inicial.
