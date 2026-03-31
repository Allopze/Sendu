# 1. Resumen ejecutivo

Auditando el repositorio completo encontré una base técnica con buenas intenciones y varias piezas ya maduras para una app single-instance: `build`, `lint` y `tests` pasan; hay health/readiness checks, cola de jobs, backups, limpieza de expirados, persistencia de sesiones/CSRF en SQLite, validación MIME por contenido y verificación de checksum. También ejecuté la app en `NODE_ENV=production`, probé flujos HTTP reales y recorrí la UI con Chromium headless.

La situación actual es bastante mejor que en la auditoría base: el secuestro de sesiones de upload por chunks, la fuga de `passwordHash`/`serverPath`, el bootstrap inseguro del primer admin, el solapamiento visible de rate limiting, el árbol vulnerable de producción y el bloqueo del resumable tras refresh/crash ya no son hoy los blockers activos. En validación local, la reanudación end-to-end tras refresh/crash ya completó correctamente en Chromium y la suite E2E browser cubre flujo guest, caso negativo de auth guard, flujo autenticado y resume.

- Veredicto claro: **No lista para producción**
- Motivo principal del veredicto: **aunque el flujo crítico ya quedó confiable en las validaciones locales, la operación sigue demasiado dependiente del panel interno y el comportamiento bajo carga/archivos grandes reales sigue insuficientemente verificado para un release serio**

## Actualización de la última pasada de fixes

- Estado de la pasada: **completada con validación**
- Validaciones ejecutadas tras los cambios: `npm test` (`77/77`), `npm run lint`, `npm run build`, `npm audit --omit=dev`, `npm run test:e2e:smoke` (`4 passed`)
- Hallazgos mitigados en código en esta pasada:
- 1. Se añadió `uploadToken` firmado para ligar cada chunk a su sesión de upload.
- 2. `/api/user/files` y `/api/admin/files` dejaron de exponer `passwordHash` y `serverPath`; ahora devuelven `hasPassword`.
- 3. El primer registro público ya no asciende automáticamente a admin sin bootstrap token.
- 4. Se eliminó el solapamiento obvio entre limitadores general y específicos en auth/download.
- 5. El dashboard ya muestra correctamente el estado `Protegido` y el borrado valida `res.ok`.
- 6. Se corrigieron claims falsos de producto: `50GB` y `archivo encriptado`.
- 7. Se introdujo un modo explícito “sin email”: el registro ya no deja usuarios bloqueados, `forgot-password` y acciones admin dependientes de correo fallan de forma explícita y el frontend refleja esa disponibilidad.
- 8. Se actualizó el árbol vulnerable del backend (`express-rate-limit`, `multer`, `file-type`, `path-to-regexp`, `qs`, `nodemailer`) y se eliminó `axios` del frontend; el árbol de producción quedó en `0` vulnerabilidades.
- 9. El build dejó de empaquetar bases SQLite residuales de `backend/`; se confirmó que el ZIP nuevo no contiene `db.sqlite`.
- 10. Las descargas solo incrementan `downloadCount` cuando `res.download()` completa correctamente; los abortos/fallos ya no consumen descargas y quedan métricas `download_start`, `download_complete`, `download_abort`, `download_fail`.
- 11. La UI empezó a renderizar límites reales del backend en home/registro, incluyendo cupo restante aproximado para invitados.
- 12. Se eliminó el engine de upload muerto (`useUpload.js` + `uploadWorker.js`) y el flujo activo quedó concentrado en `UploadContext`.
- 13. Se añadió endpoint de estado `/api/upload/status/:uploadId` y rehidratación del upload desde estado persistido para intentar retomar chunks ya confirmados por servidor.
- 14. Se endureció la compatibilidad de builds productivos en localhost/previews: el frontend ya hace fallback a mismo origen para API si detecta host local y backend/CSRF/sesión dejaron de depender de cookies `secure` rígidas.
- 15. Se añadieron `requestId` en respuestas de error/404 y un resumen derivado en `/api/admin/metrics` para correlación operativa rápida.
- 16. Se mejoró accesibilidad base en navbar/home/toasts/upload overlay: `aria-label`, `aria-live`, navegación por teclado y semántica de menú.
- 17. Se añadió una suite Playwright versionada dentro del repo (`[playwright.config.js](/home/allopze/dev/sendu/playwright.config.js)` + `[e2e/smoke.spec.js](/home/allopze/dev/sendu/e2e/smoke.spec.js)`) y el smoke principal ya corre contra la build productiva local: guest upload -> share link -> download con archivo verificado.
- 18. Se añadió `GET /api/auth/csrf` y el cliente ahora reintenta automáticamente una vez cuando detecta fallo CSRF bootstrap, reduciendo falsos `403` en los primeros `POST`.
- 19. Se endureció el manejo de cookies de sesión/CSRF para loopback y previews HTTP: `SESSION_COOKIE_DOMAIN` y `secure` ya no rompen localhost/`127.0.0.1` por herencia ciega desde `.env`.
- 20. La observabilidad operativa subió un escalón: `/api/admin/metrics` expone estado derivado, uploads activos/estancados, almacenamiento y alertas operativas; además admin ya tiene una vista de observabilidad consumiendo esos datos.
- 21. La compresión ZIP de múltiples archivos salió del hilo principal y pasó a un Web Worker (`[frontend/src/workers/zipWorker.js](/home/allopze/dev/sendu/frontend/src/workers/zipWorker.js)`), reduciendo congelamientos visibles y mejorando la robustez para cargas pesadas.
- 22. La persistencia de resumable se reforzó en cliente con múltiples backends (`OPFS`, `IndexedDB`, `Cache Storage`) y timeouts defensivos para evitar bloqueos durante la rehidratación.
- 23. Se cerró el atasco real del resumable tras refresh/crash: el efecto de auto-resume ya no se autocancela al pasar por `preparing`, el cliente conserva `uploadId`/archivo/estado y la reanudación completó end-to-end en browser real.
- 24. El backend dejó de autoboicotear el resume con temporales abortados: los `*.uploading` ya no cuentan como bytes válidos de la sesión y el smoke resume dejó de fallar por `HTTP 400` tras recargar.
- 25. La ruta de chunks ahora expone contadores operativos separados (`upload_chunk_client_error`, `upload_chunk_server_error`) y el panel admin muestra tasas/SLOs de uploads, descargas, resume y 5xx.
- 26. La observabilidad operativa se volvió más accionable: `[docs/OPERATIONS.md](/home/allopze/dev/sendu/docs/OPERATIONS.md)` ya documenta health, umbrales, alertas mínimas y runbooks concretos; `[docs/API.md](/home/allopze/dev/sendu/docs/API.md)` también refleja `GET /api/auth/csrf`, `GET /api/upload/status/:uploadId` y el contrato de `/api/admin/metrics`.
- 27. La suite Playwright versionada dejó de ser solo happy path: hoy cubre guest upload/share/download, auth guard negativo, upload autenticado visible en dashboard y resume tras refresh/crash; en esta pasada quedó `4/4` verde.
- 28. Se añadió regresión backend para reanudación con residuos de `*.uploading`, evitando reabrir el bug donde el propio servidor rechazaba un resume válido.
- Hallazgos todavía pendientes tras esta pasada:
- 1. La observabilidad mejoró mucho dentro del producto, pero siguen faltando alertas externas reales, trazas distribuidas y dashboards fuera del panel admin.
- 2. No hay evidencia suficiente de comportamiento con tráfico real, multi-GB, presión alta de disco/RAM o topologías multi-node.
- 3. Persisten claims/capacidades WeTransfer no implementadas a nivel de producto completo, especialmente malware scanning obligatorio, deliverability real y experiencia de grandes archivos por encima del rango validado.
- 4. La cobertura E2E browser ya es útil para release, pero aún no cubre restauración de sesión autenticada, errores de password/download y escenarios de degradación/red más agresivos.
- Nota: **la nota global se actualiza tras esta pasada, pero el veredicto sigue siendo conservador por brechas operativas y de escalabilidad aún no verificadas**

# 2. Nota global

- Nota total: **58/100**
- Correctitud funcional: **72/100**
- Seguridad: **60/100**
- Performance: **56/100**
- UX/UI: **60/100**
- Calidad de código: **57/100**
- Testing: **72/100**
- Operación/observabilidad: **63/100**
- Preparación para producción: **52/100**

# 3. Hallazgos críticos

**Hallazgo 1: Cualquier cliente puede subir chunks a una sesión de upload ajena**

- Estado de validación: **Confirmado por código y por ejecución**
- Estado tras esta pasada: **Mitigado en código y cubierto por test de regresión**
- Severidad: **Crítico**
- Categoría: **Seguridad / Correctitud funcional**
- Descripción clara: la ruta de chunks valida que el `uploadId` exista y que la sesión no esté expirada, pero no valida que el request pertenezca al usuario autenticado que creó la sesión ni al fingerprint/IP invitado asociado.
- Impacto real: permite corrupción de uploads, sabotaje de transferencias, consumo indebido de cuota y potencial inyección de contenido en un archivo que otro usuario cree estar subiendo.
- Cómo reproducirlo:
- 1. Iniciar una subida autenticada y obtener un `uploadId`.
- 2. Desde otra sesión sin autenticación, enviar `POST /api/upload/chunk?uploadId=<id>&index=0` con un archivo cualquiera.
- 3. El backend acepta el fragmento.
- Evidencia concreta:
- En ejecución real, el request anónimo devolvió `200 {"message":"Fragmento subido"}` contra un `uploadId` creado por otra sesión.
- El código solo consulta `status` y `createdAt` en `upload_sessions`, sin comprobar ownership.
- Archivos/rutas implicadas:
- `[backend/chunkRouter.js](/home/allopze/dev/sendu/backend/chunkRouter.js)` 
- `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)`
- Líneas exactas si aplica:
- `[backend/chunkRouter.js:165](/home/allopze/dev/sendu/backend/chunkRouter.js#L165)` a `[backend/chunkRouter.js:214](/home/allopze/dev/sendu/backend/chunkRouter.js#L214)`
- `[backend/server.js:1392](/home/allopze/dev/sendu/backend/server.js#L1392)` a `[backend/server.js:1406](/home/allopze/dev/sendu/backend/server.js#L1406)`
- Causa raíz: se optimizó la ruta `/api/upload/chunk` montándola antes de `session`, `csrf` y `httpLogger`, pero no se reintrodujo un control explícito de ownership a nivel de sesión de subida.
- Recomendación de solución:
- 1. Persistir en `upload_sessions` el `userId` o fingerprint de creación y validarlo en cada chunk.
- 2. Requerir sesión para uploads autenticados y validar fingerprint/token firmado para invitados.
- 3. Añadir tests negativos de secuestro de `uploadId`.
- Riesgo de no corregirlo: cualquier actor con un `uploadId` válido puede interferir con transferencias activas en producción.

**Hallazgo 2: La API expone `passwordHash` y `serverPath` al frontend**

- Estado de validación: **Confirmado por código y por ejecución**
- Estado tras esta pasada: **Mitigado en código y cubierto por test de regresión**
- Severidad: **Crítico**
- Categoría: **Seguridad / API design**
- Descripción clara: el endpoint de archivos del usuario devuelve `SELECT * FROM files`, lo que envía al navegador campos internos que no deberían salir del backend, incluidos `passwordHash` y `serverPath`.
- Impacto real: expone hashes bcrypt de contraseñas de transferencias protegidas y rutas internas del servidor a cualquier usuario autenticado dueño de archivos; además deja evidencia de que la capa API no tiene serializers/DTOs defensivos.
- Cómo reproducirlo:
- 1. Subir un archivo con contraseña.
- 2. Llamar `GET /api/user/files` autenticado.
- 3. Inspeccionar la respuesta JSON.
- Evidencia concreta:
- La respuesta real incluyó `passwordHash:"$2b$12$..."`.
- La tabla `files` define `passwordHash` y `serverPath`, y el endpoint devuelve todas las columnas sin filtrado.
- Archivos/rutas implicadas:
- `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)`
- `[backend/lib/migrations.js](/home/allopze/dev/sendu/backend/lib/migrations.js)`
- Líneas exactas si aplica:
- `[backend/server.js:1909](/home/allopze/dev/sendu/backend/server.js#L1909)` a `[backend/server.js:1926](/home/allopze/dev/sendu/backend/server.js#L1926)`
- `[backend/lib/migrations.js:46](/home/allopze/dev/sendu/backend/lib/migrations.js#L46)` a `[backend/lib/migrations.js:59](/home/allopze/dev/sendu/backend/lib/migrations.js#L59)`
- Causa raíz: ausencia de contratos de salida explícitos para la API; se reutiliza directamente el modelo de almacenamiento como payload público.
- Recomendación de solución:
- 1. Reemplazar `SELECT *` por selección explícita de columnas públicas.
- 2. Introducir serializers para `files`.
- 3. Revisar `/api/admin/files` por el mismo patrón.
- Riesgo de no corregirlo: fuga continua de material sensible y normalización de malas prácticas de exposición de datos en otras rutas.

**Hallazgo 3: El primer registro público crea un administrador sin depender realmente del bootstrap documentado**

- Estado de validación: **Confirmado por código y por ejecución**
- Estado tras esta pasada: **Mitigado en código y cubierto por test de regresión**
- Severidad: **Alto**
- Categoría: **Seguridad / Producción**
- Descripción clara: si `users.count === 0`, el primer usuario registrado recibe rol `admin` automáticamente, independientemente del modo de bootstrap descrito en la documentación.
- Impacto real: si la instancia queda expuesta antes de un bootstrap controlado, el primer actor externo que llegue puede convertirse en administrador.
- Cómo reproducirlo:
- 1. Arrancar una instancia vacía.
- 2. Registrar el primer usuario.
- 3. La respuesta devuelve mensaje de admin bootstrap y el usuario queda con rol `admin`.
- Evidencia concreta:
- La respuesta real fue `Usuario registrado como administrador. Por favor verifica tu email.`
- La documentación dice que el primer admin depende de `ALLOW_PUBLIC_REGISTRATION=false` y `ADMIN_BOOTSTRAP_TOKEN`, pero el código marca `bootstrapRequested = true` cuando `userCount === 0`.
- Archivos/rutas implicadas:
- `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)`
- `[docs/ADMIN.md](/home/allopze/dev/sendu/docs/ADMIN.md)`
- Líneas exactas si aplica:
- `[backend/server.js:817](/home/allopze/dev/sendu/backend/server.js#L817)` a `[backend/server.js:844](/home/allopze/dev/sendu/backend/server.js#L844)`
- `[backend/server.js:857](/home/allopze/dev/sendu/backend/server.js#L857)` a `[backend/server.js:859](/home/allopze/dev/sendu/backend/server.js#L859)`
- `[docs/ADMIN.md:3](/home/allopze/dev/sendu/docs/ADMIN.md#L3)` a `[docs/ADMIN.md:6](/home/allopze/dev/sendu/docs/ADMIN.md#L6)`
- Causa raíz: lógica de bootstrap embebida dentro del flujo público de registro, no como proceso administrativo separado y explícito.
- Recomendación de solución:
- 1. Eliminar la promoción automática del primer usuario en registro público.
- 2. Mover el bootstrap a una ruta/CLI/token de inicialización de un solo uso.
- 3. Alinear documentación y comportamiento.
- Riesgo de no corregirlo: takeover administrativo del tenant en el primer despliegue o tras restauraciones limpias.

**Hallazgo 4: Sin SMTP el producto entra en un callejón sin salida para usuarios normales**

- Estado de validación: **Confirmado por código y por ejecución**
- Estado tras esta pasada: **Mitigado en código y cubierto por tests de regresión**
- Severidad: **Alto**
- Categoría: **Correctitud funcional / Operación**
- Descripción clara: si SMTP no está configurado, el backend omite el envío del correo de verificación, pero sigue registrando al usuario con mensaje de “verifica tu email”; a la vez bloquea `/api/upload/init` para usuarios no verificados.
- Impacto real: un usuario normal puede registrarse, iniciar sesión y quedar bloqueado del flujo principal de “subir archivos” sin forma real de verificar su cuenta.
- Cómo reproducirlo:
- 1. Arrancar la app sin variables SMTP.
- 2. Registrar un usuario no-admin.
- 3. Iniciar sesión y llamar `POST /api/upload/init`.
- Evidencia concreta:
- El log real mostró `SMTP not configured, skipping email queue`.
- El registro devolvió `201` con mensaje de verificación.
- `/api/auth/me` devolvió `isVerified: 0`.
- `/api/upload/init` devolvió `403 {"error":"Verifica tu email para subir archivos"}`.
- Archivos/rutas implicadas:
- `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)`
- Líneas exactas si aplica:
- `[backend/server.js:742](/home/allopze/dev/sendu/backend/server.js#L742)` a `[backend/server.js:746](/home/allopze/dev/sendu/backend/server.js#L746)`
- `[backend/server.js:849](/home/allopze/dev/sendu/backend/server.js#L849)` a `[backend/server.js:860](/home/allopze/dev/sendu/backend/server.js#L860)`
- `[backend/server.js:1262](/home/allopze/dev/sendu/backend/server.js#L1262)` a `[backend/server.js:1270](/home/allopze/dev/sendu/backend/server.js#L1270)`
- Causa raíz: se trató la ausencia de SMTP como un caso “silencioso” en vez de como una condición de configuración incompatible con el producto.
- Recomendación de solución:
- 1. Bloquear registro/verificación dependiente de email cuando SMTP no esté operativo.
- 2. O bien introducir un modo alternativo explícito de verificación/manual approval.
- 3. Añadir readiness específico para “email features enabled”.
- Riesgo de no corregirlo: onboarding roto, soporte manual, abandono del producto y tickets de producción desde el día 1.

**Hallazgo 5: El rate limiting tenía solapamientos y ya estaba fallando en runtime**

- Estado de validación: **Confirmado por código y por ejecución**
- Estado tras esta pasada: **Mitigado en código; pendiente endurecer con pruebas de carga/runtime más agresivas**
- Severidad: **Alto**
- Categoría: **Seguridad / Fiabilidad**
- Descripción clara: la app aplica un limitador general a `/api/*` y otros limitadores específicos a auth y validación de descargas. Ese solapamiento dispara validaciones de `express-rate-limit` durante requests reales.
- Impacto real: protección antiabuso poco confiable, conteos inconsistentes, ruido operativo y riesgo de throttling no intencionado en endpoints críticos.
- Cómo reproducirlo:
- 1. Arrancar la app en producción.
- 2. Hacer requests a registro/login.
- 3. Revisar logs del servidor.
- Evidencia concreta:
- El servidor emitió `ValidationError: The hit count for [object Object] was incremented more than once for a single request. code: 'ERR_ERL_DOUBLE_COUNT'`.
- El limitador general cubre `/api/*`, y luego `/api/auth/register`, `/api/auth/login`, `/api/auth/forgot-password` y `/api/download/:id/validate` añaden limitadores extra.
- Archivos/rutas implicadas:
- `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)`
- `[backend/lib/persistentStores.js](/home/allopze/dev/sendu/backend/lib/persistentStores.js)`
- Líneas exactas si aplica:
- `[backend/server.js:431](/home/allopze/dev/sendu/backend/server.js#L431)` a `[backend/server.js:452](/home/allopze/dev/sendu/backend/server.js#L452)`
- `[backend/server.js:458](/home/allopze/dev/sendu/backend/server.js#L458)` a `[backend/server.js:490](/home/allopze/dev/sendu/backend/server.js#L490)`
- `[backend/server.js:790](/home/allopze/dev/sendu/backend/server.js#L790)` 
- `[backend/server.js:1005](/home/allopze/dev/sendu/backend/server.js#L1005)` 
- `[backend/server.js:1783](/home/allopze/dev/sendu/backend/server.js#L1783)` 
- `[backend/lib/persistentStores.js:458](/home/allopze/dev/sendu/backend/lib/persistentStores.js#L458)` a `[backend/lib/persistentStores.js:544](/home/allopze/dev/sendu/backend/lib/persistentStores.js#L544)`
- Causa raíz: diseño de rate limiting por capas sin exclusiones claras entre el limitador global y los especializados.
- Recomendación de solución:
- 1. Excluir explícitamente auth/password-reset/download-validate del limitador global.
- 2. Actualizar `express-rate-limit` a una versión corregida.
- 3. Añadir tests de integración sobre headers y contadores.
- Riesgo de no corregirlo: antiabuso inconsistente justo en login, reset y descargas protegidas.

**Hallazgo 6: Había dependencias vulnerables en la ruta crítica del producto**

- Estado de validación: **Confirmado por `npm audit`**
- Estado tras esta pasada: **Mitigado en producción; `npm audit --omit=dev` quedó en `0` vulnerabilidades**
- Severidad: **Alto**
- Categoría: **Seguridad / Supply chain**
- Descripción clara: el backend tiene 6 vulnerabilidades en dependencias de producción y el frontend 1 alta. Varias afectan directamente a parsing HTTP/multipart o al rate limiting del producto.
- Impacto real: una app de transferencia de archivos depende del parser de multipart y del control de abuso; dejar CVEs abiertas en esos componentes aumenta la superficie de explotación real.
- Cómo reproducirlo:
- 1. Ejecutar `npm audit --omit=dev`.
- 2. Ejecutar `npm audit --omit=dev --prefix frontend`.
- Evidencia concreta:
- Estado inicial: backend `6` vulnerabilidades (`3 high`, `1 moderate`, `2 low`) y frontend `1 high` (`axios`).
- Estado actual: `npm audit --omit=dev` devuelve `0` vulnerabilidades de producción.
- Paquetes mitigados en esta pasada: `multer`, `express-rate-limit`, `file-type`, `path-to-regexp`, `qs`, `axios`, `nodemailer`.
- Archivos/rutas implicadas:
- `[package-lock.json](/home/allopze/dev/sendu/package-lock.json)`
- `[frontend/package-lock.json](/home/allopze/dev/sendu/frontend/package-lock.json)`
- Líneas exactas si aplica: **no aplica; evidencia de tooling**
- Causa raíz: deuda de actualización y ausencia de una política de bloqueo de release por auditoría.
- Recomendación de solución:
- 1. Mantener política de CI que falle en `high/critical`.
- 2. Revalidar uploads y rate limiting tras cada bump sensible de networking/multipart.
- 3. Vigilar regresiones del árbol `prod` como parte del release checklist.
- Riesgo de no corregirlo: reabrir superficie crítica en futuras actualizaciones sin una política preventiva.

**Hallazgo 7: La promesa central del producto no coincide con la realidad técnica**

- Estado de validación: **Confirmado por código y por ejecución**
- Estado tras esta pasada: **Parcialmente mitigado; se corrigieron claims visibles y ahora la UI muestra límites reales, pero sigue pendiente cerrar capacidades avanzadas tipo WeTransfer**
- Severidad: **Alto**
- Categoría: **Producto / UX / Correctitud funcional**
- Descripción clara: la UI promete “Sube archivos de hasta 50GB”, pero el backend limita por defecto a 100MB para usuarios registrados y 50MB para invitados. Además, la vista de éxito afirma “Tu archivo ha sido encriptado” cuando el código no cifra archivos subidos en reposo; solo cifra ciertos settings.
- Impacto real: genera expectativas falsas sobre capacidad y seguridad, erosiona confianza y puede provocar reclamaciones de producto incluso aunque “todo funcione”.
- Cómo reproducirlo:
- 1. Abrir `/register` y leer el claim de 50GB.
- 2. Revisar límites efectivos del backend.
- 3. Subir un archivo y leer el copy de la vista de éxito.
- Evidencia concreta:
- En navegador headless, la pantalla de registro mostró `Sube archivos de hasta 50GB`.
- El backend define `maxFileSize: 100` MB y `guestMaxFileSize: 50` MB por defecto.
- La UI de éxito dice `Tu archivo ha sido encriptado`, pero la lógica de cifrado solo se usa para settings SMTP.
- Archivos/rutas implicadas:
- `[frontend/src/pages/RegisterPage.jsx](/home/allopze/dev/sendu/frontend/src/pages/RegisterPage.jsx)`
- `[frontend/src/pages/HomePage.jsx](/home/allopze/dev/sendu/frontend/src/pages/HomePage.jsx)`
- `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)`
- `[backend/lib/encryption.js](/home/allopze/dev/sendu/backend/lib/encryption.js)`
- Líneas exactas si aplica:
- `[frontend/src/pages/RegisterPage.jsx:61](/home/allopze/dev/sendu/frontend/src/pages/RegisterPage.jsx#L61)` a `[frontend/src/pages/RegisterPage.jsx:63](/home/allopze/dev/sendu/frontend/src/pages/RegisterPage.jsx#L63)`
- `[backend/server.js:2561](/home/allopze/dev/sendu/backend/server.js#L2561)` a `[backend/server.js:2567](/home/allopze/dev/sendu/backend/server.js#L2567)`
- `[frontend/src/pages/HomePage.jsx:785](/home/allopze/dev/sendu/frontend/src/pages/HomePage.jsx#L785)` a `[frontend/src/pages/HomePage.jsx:790](/home/allopze/dev/sendu/frontend/src/pages/HomePage.jsx#L790)`
- `[backend/lib/encryption.js:14](/home/allopze/dev/sendu/backend/lib/encryption.js#L14)` a `[backend/lib/encryption.js:60](/home/allopze/dev/sendu/backend/lib/encryption.js#L60)`
- Causa raíz: copy de producto desacoplado de capacidades reales y ausencia de una revisión de claims de seguridad/capacidad antes del release.
- Recomendación de solución:
- 1. Corregir inmediatamente claims de capacidad y cifrado.
- 2. Exponer límites reales desde backend y renderizarlos en UI.
- 3. Solo comunicar cifrado si existe cifrado real en tránsito y/o en reposo con diseño verificable.
- Riesgo de no corregirlo: pérdida de confianza, soporte innecesario y posible exposición reputacional.

# 4. Bugs y errores encontrados

- **[Mitigado en esta pasada]** El dashboard ya muestra correctamente el badge `Protegido` consumiendo `hasPassword` en vez de asumir `file.password`. Evidencia en `[frontend/src/pages/DashboardPage.jsx](/home/allopze/dev/sendu/frontend/src/pages/DashboardPage.jsx)` y contrato sanitizado de `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)`.
- **[Mitigado en esta pasada]** El modal de borrado ya comprueba `res.ok` y no reporta éxito falso cuando la respuesta del backend falla. Evidencia en `[frontend/src/pages/DashboardPage.jsx](/home/allopze/dev/sendu/frontend/src/pages/DashboardPage.jsx)` y `[frontend/src/pages/AdminPage.jsx](/home/allopze/dev/sendu/frontend/src/pages/AdminPage.jsx)`.
- **[Mitigado en esta pasada]** El contador de descargas ya no se incrementa antes de tiempo; el backend solo suma `downloadCount` cuando `res.download()` completa sin error, y el test cubre tanto éxito como archivo faltante. Ver `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)` y `[backend/tests/download.test.js](/home/allopze/dev/sendu/backend/tests/download.test.js)`.
- **[Mitigado en esta pasada]** El resumable tras refresh/crash ya completa end-to-end en browser real: el cliente rehidrata estado, recupera el mismo `uploadId`, consulta `/api/upload/status/:uploadId` y termina la subida tras recargar. Además quedó cubierta la regresión de temporales `*.uploading` en backend. Evidencia en `[frontend/src/context/UploadContext.jsx](/home/allopze/dev/sendu/frontend/src/context/UploadContext.jsx)`, `[backend/chunkRouter.js](/home/allopze/dev/sendu/backend/chunkRouter.js)`, `[backend/server.js](/home/allopze/dev/sendu/backend/server.js)`, `[backend/tests/e2eUploadDownload.test.js](/home/allopze/dev/sendu/backend/tests/e2eUploadDownload.test.js)` y `[e2e/smoke.spec.js](/home/allopze/dev/sendu/e2e/smoke.spec.js)`.
- **[Confirmado]** La opción `thumbnail_generate` aparece en la UI de administración, pero no existe handler registrado para ese tipo de job. Evidencia en `[frontend/src/pages/AdminPage.jsx:30](/home/allopze/dev/sendu/frontend/src/pages/AdminPage.jsx#L30)` a `[frontend/src/pages/AdminPage.jsx:37](/home/allopze/dev/sendu/frontend/src/pages/AdminPage.jsx#L37)` y `[backend/lib/jobHandlers.js:27](/home/allopze/dev/sendu/backend/lib/jobHandlers.js#L27)` a `[backend/lib/jobHandlers.js:32](/home/allopze/dev/sendu/backend/lib/jobHandlers.js#L32)`.
- **[Mitigado en esta pasada]** Ya existe una suite E2E browser versionada dentro del repo con Playwright y en esta pasada quedó `4/4` verde contra build productiva local: guest upload -> share -> download, auth guard negativo, flujo autenticado con dashboard y resume tras refresh/crash. Sigue faltando ampliarla a más negativos y degradaciones, pero ya sirve como señal de release básica.
- **[Confirmado]** El E2E backend cubre un archivo de 11 bytes (`hello sendu`), no valida grandes subidas, reintentos reales, caída de red ni concurrencia. Evidencia en `[backend/tests/e2eUploadDownload.test.js:56](/home/allopze/dev/sendu/backend/tests/e2eUploadDownload.test.js#L56)` a `[backend/tests/e2eUploadDownload.test.js:107](/home/allopze/dev/sendu/backend/tests/e2eUploadDownload.test.js#L107)`.
- **[Confirmado]** La página de éxito dice que el archivo está “encriptado” sin que exista cifrado de archivos en backend; es un bug de producto/UX, no solo copy. Evidencia en `[frontend/src/pages/HomePage.jsx:789](/home/allopze/dev/sendu/frontend/src/pages/HomePage.jsx#L789)`.

# 5. Inconsistencias y deuda técnica

- **[Parcialmente mitigado en esta pasada]** El contrato de archivos está mejor que en la auditoría base: backend ya sanitiza y frontend consume `hasPassword`, por lo que dejó de exponer secretos y de renderizar estado falso. Sigue faltando un contrato/DTO compartido y explícito entre capas para evitar regresiones similares.
- **[Confirmado]** `backend/server.js` es un monolito de más de 3.100 líneas. La propia documentación reconoce la necesidad de modularizarlo. Ver `[docs/ARCHITECTURE.md:87](/home/allopze/dev/sendu/docs/ARCHITECTURE.md#L87)` a `[docs/ARCHITECTURE.md:111](/home/allopze/dev/sendu/docs/ARCHITECTURE.md#L111)`.
- **[Mitigado en esta pasada]** Se eliminó la duplicación principal del motor de uploads borrando `useUpload.js` y `uploadWorker.js`; el flujo vivo quedó concentrado en `UploadContext`.
- **[Confirmado]** La documentación de bootstrap admin no coincide con el comportamiento real del registro inicial. Ver `[docs/ADMIN.md:5](/home/allopze/dev/sendu/docs/ADMIN.md#L5)` frente a `[backend/server.js:823](/home/allopze/dev/sendu/backend/server.js#L823)`.
- **[Confirmado]** La documentación de arquitectura aún dice “Rate Limiting | In-memory”, pero el código ya usa SQLite store. Ver `[docs/ARCHITECTURE.md:16](/home/allopze/dev/sendu/docs/ARCHITECTURE.md#L16)` a `[docs/ARCHITECTURE.md:24](/home/allopze/dev/sendu/docs/ARCHITECTURE.md#L24)` frente a `[backend/lib/persistentStores.js:458](/home/allopze/dev/sendu/backend/lib/persistentStores.js#L458)`.
- **[Confirmado]** El build frontend carga `frontend/.env` y luego el `.env` raíz como fallback, lo que mete acoplamiento innecesario entre build del cliente y configuración del servidor. Ver `[frontend/vite.config.js:11](/home/allopze/dev/sendu/frontend/vite.config.js#L11)` a `[frontend/vite.config.js:15](/home/allopze/dev/sendu/frontend/vite.config.js#L15)`.
- **[Parcialmente mitigado en esta pasada]** El backend sigue haciendo `dotenv.config()` de forma incondicional en arranque, pero ya no rompe por defecto localhost/previews por herencia de `SESSION_COOKIE_DOMAIN` y cookies `secure`: ahora hay tratamiento especial para loopback y `PUBLIC_ORIGIN` local. Sigue existiendo acoplamiento innecesario entre `.env` raíz y arranques aislados.
- **[Mitigado en esta pasada]** El build ya no copia artefactos SQLite residuales desde `backend/`; `scripts/build.js` excluye `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal` y `*.db`, y el ZIP `release/sendu-v1.0.0-20260331.zip` fue verificado sin entradas `db.sqlite`.

# 6. Riesgos de seguridad

- **Mitigado en esta pasada:** la autorización de chunks ajenos ya no es el blocker activo que era en la auditoría base; quedó cerrada con token firmado por sesión y pruebas de regresión. Conviene revalidarlo con más presión/runtime antes de darlo por blindado.
- **Mitigado en esta pasada:** la fuga de `passwordHash` y `serverPath` ya no bloquea el release actual; la API devuelve un payload saneado con `hasPassword`.
- **Mitigado en esta pasada:** el primer registro público ya no asciende automáticamente a admin; el riesgo residual pasa más por documentación/procedimiento que por takeover inmediato del primer deploy.
- **Mitigado en esta pasada:** las dependencias vulnerables del path crítico (`multer`, `express-rate-limit`, `file-type`, `path-to-regexp`, `qs`, `nodemailer`) y `axios` ya no bloquean el release; `npm audit --omit=dev` quedó en `0`.
- **Riesgo medio confirmado:** el antiabuso quedó mejor alineado y la dependencia vulnerable fue actualizada, pero falta una revalidación más agresiva en runtime/carga para darlo por completamente cerrado.
- **Riesgo medio confirmado:** logging con PII operacional. El backend registra emails/recipients en eventos de correo, por ejemplo `[backend/server.js:744](/home/allopze/dev/sendu/backend/server.js#L744)` y `[backend/lib/jobHandlers.js:74](/home/allopze/dev/sendu/backend/lib/jobHandlers.js#L74)`.
- **Riesgo medio confirmado:** antivirus existe pero es opcional y estaba desactivado durante la auditoría; por tanto la protección frente a malware real quedó **no verificada**. Ver `[backend/lib/antivirus.js:8](/home/allopze/dev/sendu/backend/lib/antivirus.js#L8)` a `[backend/lib/antivirus.js:32](/home/allopze/dev/sendu/backend/lib/antivirus.js#L32)` y `[backend/server.js:1625](/home/allopze/dev/sendu/backend/server.js#L1625)` a `[backend/server.js:1637](/home/allopze/dev/sendu/backend/server.js#L1637)`.
- **Riesgo bajo confirmado:** se emite `Strict-Transport-Security` incluso en ejecución HTTP si `NODE_ENV=production`, lo que sigue siendo una footgun de configuración y de pruebas locales. El riesgo práctico bajó porque sesión/CSRF ya no dependen de cookies `secure` rígidas en loopback, pero el header sigue siendo mejorable.
- **Bien hecho:** hay `helmet`, cookies `httpOnly`, CSRF persistente, validación MIME por contenido y límites por descargas/expiración. Es una buena base, pero hoy no compensa los fallos anteriores.

# 7. Riesgos de producción

- **[Confirmado]** La app no ha demostrado soportar el caso WeTransfer que dice vender. El límite por defecto es 100MB para registrados y 50MB para invitados; no hay validación real en esta auditoría de multi-GB, resumable after restart ni backpressure bajo carga.
- **[Mitigado parcialmente en esta pasada]** La creación de ZIP de múltiples archivos ya no corre en el hilo principal: el frontend mueve la compresión a un Web Worker. Esto reduce congelamientos de UI, pero no sustituye una estrategia realmente robusta de grandes cargas/reanudación bajo refresh o presión de memoria.
- **[Mitigado en esta pasada]** La reanudación tras refresh/crash ya pasó end-to-end en Chromium sobre build productiva local, incluyendo recarga durante la subida y finalización con la misma sesión. El riesgo residual se mueve ahora a escenarios no verificados de mayor estrés, otros navegadores y cargas más grandes.
- **[Parcialmente mitigado]** La observabilidad ya incluye métricas de inicio/completado/abort/fallo de descargas, `requestId` en respuestas de error/404, estado derivado en `/api/admin/metrics`, SLOs/resúmenes de resume/chunk errors y runbooks documentados. Aun así, siguen faltando alertas externas reales, trazas y dashboards operacionales fuera de la propia app.
- **[Confirmado]** Hay readiness, backups y runbooks mínimos, lo cual suma a favor. Ver `[backend/server.js:2657](/home/allopze/dev/sendu/backend/server.js#L2657)` a `[backend/server.js:2684](/home/allopze/dev/sendu/backend/server.js#L2684)` y `[docs/OPERATIONS.md:3](/home/allopze/dev/sendu/docs/OPERATIONS.md#L3)` a `[docs/OPERATIONS.md:49](/home/allopze/dev/sendu/docs/OPERATIONS.md#L49)`.
- **[Probable]** SQLite con `better-sqlite3` puede sostener bien un despliegue single-host, pero no hay evidencia de comportamiento bajo ráfagas reales de uploads concurrentes, escrituras altas o topología multi-node. La propia documentación recomienda migrar a PostgreSQL/MySQL para mayor carga. Ver `[docs/ARCHITECTURE.md:69](/home/allopze/dev/sendu/docs/ARCHITECTURE.md#L69)` a `[docs/ARCHITECTURE.md:72](/home/allopze/dev/sendu/docs/ARCHITECTURE.md#L72)`.
- **[No verificado]** Deliverability real de emails, bounce handling, DKIM/SPF/DMARC, antivirus real con ClamAV y recuperación ante desastre end-to-end.

# 8. Oportunidades de mejora

- **Impacto alto / esfuerzo medio:** introducir serializers/DTOs para todas las respuestas críticas (`files`, `users`, `settings`) y prohibir `SELECT *` en endpoints HTTP.
- **[Completado en esta pasada]** Se cerró la propiedad de sesión de upload con token firmado y validación de ownership por sesión.
- **Impacto alto / esfuerzo bajo:** corregir claims de capacidad, cifrado y estados protegidos en UI para que reflejen límites reales del backend.
- **Impacto alto / esfuerzo bajo:** convertir capacidades opcionales de correo en un modo explícito de producto con mensajes y restricciones coherentes entre frontend y backend.
- **[Completado en esta pasada]** Se consolidó el engine de upload en una sola implementación eliminando `useUpload.js` y `uploadWorker.js`.
- **Impacto alto / esfuerzo medio:** separar `server.js` en rutas/servicios (`auth`, `upload`, `download`, `admin`) para reducir el riesgo de cambios laterales.
- **[Completado parcialmente en esta pasada]** El zipping pesado de múltiples archivos se movió a Web Worker; sigue pendiente decidir si parte del procesamiento debe ir además a backend job para escenarios más grandes o más sensibles a memoria.
- **[Completado parcialmente en esta pasada]** Se endureció accesibilidad básica: `aria-label`, `aria-live`, navegación por teclado y semántica en navbar/toasts/acciones icon-only.
- **[Completado en esta pasada]** Ya existe smoke E2E browser versionado con Playwright cubriendo happy path guest, auth guard negativo, flujo autenticado y resume tras refresh/crash; en la validación quedó `4/4` verde.
- **[Completado en esta pasada]** Se amplió telemetría por transferencia y operación: `upload_init`, `upload_resume_probe`, `upload_resume_available`, `upload_chunk_client_error`, `upload_chunk_server_error`, `upload_complete`, `download_start`, `download_abort`, `download_fail`, `download_complete`.

# 9. Nuevas funcionalidades recomendadas

- **Prioridad 1:** aprovechar la base ya cerrada del resumable para endurecerla con escenarios de red más agresivos, archivos más grandes y soporte claramente documentado por navegador.
- **Prioridad 1:** expiración configurable y límites de descarga visibles desde el share link y dashboard. Ya existe backend parcial; falta convertirlo en producto consistente.
- **Prioridad 1:** protección de transferencia con contraseña bien representada en UI, opción de link de un solo uso y analítica básica de aperturas/descargas.
- **Prioridad 2:** previews y thumbnails server-side para imágenes/documentos ligeros. Tiene sentido con el panel admin y mejora percepción de producto.
- **Prioridad 2:** cuarentena/antivirus real con feedback al usuario y panel de incidentes.
- **Prioridad 3:** límites por plan/cuota, branding personalizado y panel de actividad si el producto apunta a equipos o multi-tenant ligero.

# 10. Plan de acción

## Inmediato (antes de salir a producción)

- Integrar `/api/admin/metrics` con alertado externo real y dejar umbrales operativos cableados fuera del panel interno.
- Validar con carga y archivos más grandes el comportamiento de resume, disco, memoria y cola antes de prometer un release tipo WeTransfer.
- Mantener la suite Playwright verde en CI y ampliar al menos un caso negativo de descarga protegida y uno de sesión autenticada persistida.
- Exponer y renderizar límites reales desde backend en toda la UI, no solo en copy puntual.

## Corto plazo (1–2 semanas)

- Completar E2E browser para registro/login/upload/download/delete y casos negativos aprovechando la suite Playwright ya añadida.
- Añadir tests de API para límites, ownership, expiración, descargas máximas y errores de chunk.
- Profundizar validación del resumable con degradación real de red, refresh repetido y archivos superiores al rango hoy smokeado.
- Profundizar accesibilidad básica y estados de error/recuperación.
- Definir una política de release que falle por CVEs altas y por ausencia de cobertura smoke mínima realmente verde.

## Medio plazo (1–2 meses)

- Modularizar `server.js` y extraer capa de servicios.
- Añadir observabilidad de producto y operación fuera de la app: métricas exportables, alertas, dashboards y trazas.
- Mover zipping pesado y tareas derivadas a background/Web Worker.
- Revisar estrategia de persistencia si se prevé tráfico alto o despliegue multi-node.

# 11. Decisión final de release

- ¿Está lista para producción? **No**
- Si la respuesta es no, ¿qué condiciones mínimas deben cumplirse para decir que sí?
- 1. Integrar alertas externas reales y una señal operativa consumible fuera del panel admin.
- 2. Validar con evidencia el comportamiento con archivos más grandes, presión de disco y algo de concurrencia real.
- 3. Ampliar la suite E2E browser ya verde a descargas protegidas, persistencia autenticada y degradación de red más dura.
- 4. Alinear toda la UI con límites/capacidades reales servidos por backend y terminar el hardening/documentación de variables de entorno por entorno.

VEREDICTO FINAL
- Estado: No lista
- Nota total: 58
- Riesgo principal: la app ya pasó el flujo crítico localmente, pero sigue demasiado poco verificada fuera del entorno controlado y con observabilidad externa insuficiente
- Mayor fortaleza: buena base operativa para single-instance con health checks, limpieza, backups y controles de integridad de archivo
- Mayor debilidad: el salto entre “funciona localmente” y “opera con confianza bajo tráfico real” sigue sin estar cerrado
- ¿La liberaría hoy a producción?: No
- Razón en una frase: el núcleo ya mejoró mucho y el resume quedó verde, pero sin alertas externas y sin validación de carga/grandes archivos todavía no es un release de producción confiable
