# 🔍 Auditoría del Proyecto Sendu v2

**Fecha de Auditoría:** 1 de Diciembre, 2025  
**Versión del Proyecto:** 1.0.0  
**Auditor:** GitHub Copilot

---

## 📋 Resumen Ejecutivo

**Sendu** es una aplicación web de compartición de archivos construida con una arquitectura moderna fullstack. Utiliza Express.js en el backend y React en el frontend, con SQLite como base de datos.

### Calificación General: ⭐⭐⭐⭐ (4/5)

| Categoría | Estado |
|-----------|--------|
| Funcionalidad | ✅ Completo |
| Seguridad | ⚠️ Necesita mejoras |
| Rendimiento | ✅ Bueno |
| Mantenibilidad | ✅ Bueno |
| Documentación | ⚠️ Limitada |

---

## 🏗️ Arquitectura del Proyecto

### Estructura de Directorios
```
sendu-v2/
├── backend/
│   ├── server.js           # Servidor principal Express
│   ├── check_settings.js   # Utilidad de configuración
│   ├── make_admin.js       # Utilidad para crear admin
│   └── update_settings.js  # Utilidad de settings
├── frontend/
│   ├── src/
│   │   ├── api/            # Cliente API
│   │   ├── components/     # Componentes React
│   │   ├── context/        # Context providers
│   │   ├── hooks/          # Custom hooks
│   │   └── pages/          # Páginas principales
│   └── [configuración Vite/Tailwind]
├── scripts/
│   └── cleanup.js          # Script de limpieza
├── branding/               # Assets de marca
├── uploads/                # Archivos subidos
└── tmp/                    # Archivos temporales
```

### Stack Tecnológico

**Backend:**
- Express.js 5.1.0
- SQLite (better-sqlite3)
- bcrypt para hashing de contraseñas
- Multer para uploads
- Nodemailer para emails
- Helmet para seguridad
- express-rate-limit

**Frontend:**
- React 19.2.0
- React Router 7.9.6
- Tailwind CSS 3.4.17
- Vite 7.2.4
- Axios para peticiones HTTP
- Lucide React para iconos
- Recharts para gráficos

---

## ✅ Funcionalidades Implementadas

### Sistema de Autenticación
- [x] Registro de usuarios con verificación por email
- [x] Login con email o username
- [x] Sesiones persistentes con cookies (30 días)
- [x] Sistema de roles (admin/user)
- [x] Logout seguro

### Sistema de Archivos
- [x] Upload chunked (10MB por chunk)
- [x] Límites de tamaño configurables
- [x] Protección con contraseña
- [x] Fechas de expiración
- [x] Límite de descargas
- [x] Eliminación de archivos

### Panel de Administración
- [x] Estadísticas del sistema
- [x] Gestión de usuarios (CRUD completo)
- [x] Gestión de archivos
- [x] Configuración SMTP
- [x] Personalización de marca (logos, favicon)
- [x] Editor de plantillas de email
- [x] Límites de subida configurables

### Sistema de Branding
- [x] Logo para tema claro/oscuro
- [x] Favicon personalizable
- [x] Texto del footer personalizable
- [x] Toggle del nombre de la app

---

## 🔐 Análisis de Seguridad

### ✅ Buenas Prácticas Implementadas

1. **Helmet.js** - Headers de seguridad configurados
2. **Rate Limiting** - 100 requests por 15 minutos en `/api/`
3. **bcrypt** - Hash de contraseñas con salt factor 10
4. **CORS configurado** - Orígenes restringidos en producción
5. **Cookies HttpOnly** - Sesiones protegidas contra XSS
6. **Validación de propiedad** - Verificación de dueño para archivos

### ⚠️ Vulnerabilidades Potenciales

#### 1. **Secreto de Sesión Hardcodeado** (Severidad: ALTA)
```javascript
// server.js línea 59
secret: process.env.SESSION_SECRET || 'dev-secret',
```
**Riesgo:** En ausencia de variable de entorno, usa un secreto predecible.
**Recomendación:** Forzar la existencia de `SESSION_SECRET` en producción.

#### 2. **Falta de Validación de Entrada** (Severidad: MEDIA)
- Los campos de registro no validan formato de email
- No hay sanitización de nombres de usuario
- No hay validación de longitud de contraseña en registro

**Ejemplo problemático:**
```javascript
// server.js línea 175
const { email, username, password } = req.body;
if (!email || !username || !password) return res.status(400).json({ error: 'Missing fields' });
// No valida formato de email ni longitud de password
```

#### 3. **Path Traversal Potencial** (Severidad: MEDIA)
```javascript
// server.js - uploads
const finalPath = path.join(UPLOAD_DIR, finalFileId);
```
Si bien usa UUIDs (seguros), el `originalName` se guarda sin sanitizar.

#### 4. **Falta de Límite de Intentos de Login** (Severidad: MEDIA)
No hay protección contra ataques de fuerza bruta específicos para login.

#### 5. **Credenciales SMTP en Base de Datos** (Severidad: BAJA)
Las credenciales SMTP se guardan en texto plano en la tabla `settings`.

#### 6. **Ausencia de Verificación de Email Obligatoria** (Severidad: BAJA)
Los usuarios pueden operar sin verificar su email.

#### 7. **Falta de CSRF Protection** (Severidad: MEDIA)
No hay tokens CSRF implementados para formularios.

---

## 🐛 Bugs y Problemas Encontrados

### Bug 1: Estado `setUserMenuOpen` no definido
**Archivo:** `AdminPage.jsx`
**Líneas:** 76, 89, 101, 111, 119
```javascript
setUserMenuOpen(null); // Esta función no está definida en el componente
```
**Impacto:** Posible error en tiempo de ejecución.

### Bug 2: Campo incorrecto en eliminación de usuario
**Archivo:** `server.js` línea 396
```javascript
const userFiles = db.prepare('SELECT id, storagePath FROM files WHERE userId = ?').all(id);
// El campo correcto es 'serverPath', no 'storagePath'
```
**Impacto:** No elimina archivos del disco al eliminar usuario.

### Bug 3: Falta de manejo de cancelación de upload
**Archivo:** `HomePage.jsx`
```javascript
const handleCancel = () => {
    // TODO: Implement cancel logic in useUpload
    window.location.reload();
};
```
**Impacto:** UX pobre - recargar página no es ideal.

### Bug 4: Verificación de email no implementada
El endpoint `/verify` no existe pero se envía email de verificación con enlace.

---

## 📊 Análisis de Base de Datos

### Esquema Actual

```sql
-- Users Table
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    isVerified INTEGER DEFAULT 0,
    verificationToken TEXT,
    resetToken TEXT,
    resetTokenExpires INTEGER,
    createdAt INTEGER NOT NULL
);

-- Files Table
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    originalName TEXT NOT NULL,
    serverPath TEXT NOT NULL,
    mimeType TEXT NOT NULL,
    size INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER,
    maxDownloads INTEGER,
    downloadCount INTEGER DEFAULT 0,
    passwordHash TEXT,
    userId TEXT,
    FOREIGN KEY (userId) REFERENCES users(id)
);

-- Settings Table
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Reports Table
CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    fileId TEXT NOT NULL,
    reason TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (fileId) REFERENCES files(id)
);
```

### Observaciones
- ✅ Uso de UUIDs para IDs (seguro)
- ✅ Timestamps como INTEGER (epoch ms)
- ✅ Foreign keys definidas
- ⚠️ No hay índices definidos explícitamente
- ⚠️ Tabla `reports` no tiene funcionalidad implementada

---

## ⚡ Análisis de Rendimiento

### Aspectos Positivos
1. **Upload Chunked** - Archivos grandes se dividen en chunks de 10MB
2. **SQLite con WAL** - Journal mode optimizado para concurrencia
3. **Session Store separado** - Sesiones en DB diferente
4. **Lazy loading implícito** - React Router maneja rutas

### Áreas de Mejora

1. **Sin caché de archivos estáticos**
```javascript
// No hay headers de cache configurados para /branding
app.use('/branding', express.static(BRANDING_DIR));
```

2. **Queries sin paginación**
```javascript
// Carga todos los archivos del usuario sin límite
const files = stmt.all(req.session.userId);
```

3. **Sin compresión de respuestas**
No hay middleware de compression configurado.

---

## 🧹 Calidad del Código

### Aspectos Positivos
- ✅ Estructura de proyecto clara y organizada
- ✅ Separación de contextos (Auth, Theme, Branding)
- ✅ Custom hooks para lógica reutilizable
- ✅ Componentes modulares
- ✅ Uso de ES Modules
- ✅ Tailwind CSS bien configurado

### Áreas de Mejora

1. **Falta de TypeScript** - Todo el proyecto usa JavaScript vanilla
2. **Sin tests** - No hay archivos de test
3. **Manejo de errores inconsistente** - Algunos try/catch, otros no
4. **Comentarios escasos** - Código poco documentado
5. **Variables mágicas** - Valores hardcodeados (ej: chunk size 10MB)

---

## 📝 Funcionalidades Faltantes

### Alta Prioridad
- [ ] Endpoint de verificación de email (`/verify`)
- [ ] Endpoint de reseteo de contraseña
- [ ] Sistema de reportes (tabla existe pero no hay API)
- [ ] Protección CSRF

### Media Prioridad
- [ ] Notificaciones de descarga al propietario
- [ ] Compartir con múltiples destinatarios
- [ ] Previsualización de archivos
- [ ] Historial de actividad

### Baja Prioridad
- [ ] API de estadísticas públicas
- [ ] Integración con servicios cloud (S3, etc.)
- [ ] Soporte multi-idioma
- [ ] PWA / Service Workers

---

## 🔧 Recomendaciones de Mejora

### Inmediatas (Críticas)

1. **Corregir el bug de `setUserMenuOpen`**
   ```javascript
   // Añadir al estado del componente AdminPage
   const [userMenuOpen, setUserMenuOpen] = useState(null);
   ```

2. **Corregir campo `storagePath` → `serverPath`**
   ```javascript
   const userFiles = db.prepare('SELECT id, serverPath FROM files WHERE userId = ?').all(id);
   ```

3. **Forzar SESSION_SECRET en producción**
   ```javascript
   if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
       throw new Error('SESSION_SECRET is required in production');
   }
   ```

### Corto Plazo

4. **Implementar endpoint de verificación de email**
5. **Añadir validación de entrada con librería (Joi, Zod, etc.)**
6. **Implementar rate limiting específico para login**
7. **Añadir middleware de compression**

### Largo Plazo

8. **Migrar a TypeScript**
9. **Añadir suite de tests (Jest/Vitest)**
10. **Implementar sistema de logs estructurado**
11. **Documentar API con OpenAPI/Swagger**

---

## 📁 Archivos Clave Revisados

| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| `backend/server.js` | ~650 | Servidor principal - API completa |
| `frontend/src/pages/AdminPage.jsx` | ~650 | Panel de administración |
| `frontend/src/api/client.js` | ~100 | Cliente API fetch |
| `frontend/src/hooks/useUpload.js` | ~65 | Hook de upload chunked |
| `scripts/cleanup.js` | ~50 | Script de limpieza automática |

---

## 📈 Métricas del Proyecto

| Métrica | Valor |
|---------|-------|
| Dependencias Backend | 10 |
| Dependencias Frontend | 10 |
| DevDependencies Frontend | 12 |
| Endpoints API | ~25 |
| Componentes React | ~15 |
| Páginas | 6 |
| Contextos | 3 |
| Custom Hooks | 2 |

---

## ✍️ Conclusión

**Sendu v2** es un proyecto bien estructurado con funcionalidad sólida para compartir archivos. La arquitectura es moderna y sigue buenas prácticas en general. Sin embargo, hay áreas críticas de seguridad que deben abordarse antes de un despliegue en producción, particularmente:

1. El bug del campo `storagePath`
2. La falta de validación de entrada robusta
3. El secreto de sesión por defecto
4. La ausencia de verificación de email funcional

Con las correcciones recomendadas, el proyecto estaría listo para un uso en producción seguro.

---

*Auditoría generada automáticamente por GitHub Copilot*
