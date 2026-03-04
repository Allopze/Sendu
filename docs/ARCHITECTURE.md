# Sendu Architecture & Refactoring Guide

## Current State (v2.x)

### Data Persistence

All critical state is now persisted in SQLite:

**Docker deployments (recommended for single host):**
When using the provided docker-compose, persistence is handled via bind mounts to project folders so data stays alongside the repo:
- `./data` → `/app/data`
- `./uploads` → `/app/uploads`
- `./backend/logs` → `/app/backend/logs`
- `./branding` → `/app/branding`

| Component | Storage | Multi-Replica Safe |
|-----------|---------|-------------------|
| Sessions | SQLite (`sessions` table) | ✅ Yes |
| CSRF Tokens | SQLite (`csrf_tokens` table) | ✅ Yes |
| Guest Upload Tracking | SQLite (`guest_uploads` table) | ✅ Yes |
| Download Tokens | SQLite (`download_tokens` table) | ✅ Yes |
| Job Queue | SQLite (`job_queue` table) | ✅ Yes |
| Rate Limiting | In-memory | ⚠️ Per-instance |

### Background Job Queue System

The application now includes a robust job queue for async processing:

**Features:**
- Persistent across restarts (SQLite-backed)
- Retry with exponential backoff
- Priority support
- Multi-replica safe (distributed locking)
- Dead letter queue for failed jobs

**Job Types:**
- `email`: Send emails with retry logic
- `cleanup_files`: Clean expired files
- `cleanup_chunks`: Clean orphaned upload chunks
- `branding_convert`: Convert SVG logos to PNG for emails

**Configuration:**
```javascript
initJobQueue(db, {
    processingIntervalMs: 5000,  // Check every 5 seconds
    maxRetries: 5,               // Retry up to 5 times
    retryDelayMs: 30000,         // 30s base delay (exponential backoff)
    jobTimeoutMs: 60000,         // 1 minute timeout per job
});
```

**Admin Endpoints:**
- `GET /api/admin/jobs/stats` - View queue statistics
- `POST /api/admin/jobs/cleanup` - Schedule cleanup jobs

### Database (better-sqlite3)

The application uses `better-sqlite3` (native SQLite) for durability and performance:

**Pros:**
- Real SQLite file on disk with WAL
- Synchronous, reliable writes
- Good performance for single-instance or shared-volume deployments

**Cons:**
- Requires native module compilation
- Multi-node shared storage needs careful setup

**Recommendations for high-load deployments:**
1. Use a shared storage volume for multi-replica deployments
2. For high write volume or multi-node HA, migrate to PostgreSQL/MySQL
3. Keep WAL enabled and monitor disk IO

### Security Improvements Made

1. **No plaintext passwords in meta.json** - Passwords are hashed immediately in `/upload/init`
2. **MIME type validation** - Allowlist-based validation with blocked dangerous extensions
3. **Filename sanitization** - Path traversal prevention
4. **File size verification** - Final size checked against expected
5. **SPA fallback** - Proper client-side routing support
6. **No secrets in build artifacts** - Generated at deployment time

---

## Proposed Refactoring Plan

### Phase 1: Route Modularization (Recommended)

Split `server.js` (~2100 lines) into focused modules:

```
backend/
├── server.js              # App setup, middleware, startup
├── routes/
│   ├── index.js          # Route aggregator
│   ├── auth.js           # /api/auth/* routes
│   ├── upload.js         # /api/upload/* routes
│   ├── download.js       # /api/download/* routes
│   ├── files.js          # /api/files/* routes
│   ├── admin.js          # /api/admin/* routes
│   └── settings.js       # /api/settings/* routes
├── middleware/
│   ├── auth.js           # requireAuth, requireAdmin
│   ├── session.js        # Session configuration
│   └── validation.js     # Request validation
├── services/
│   ├── email.js          # Email sending logic
│   ├── cleanup.js        # File cleanup logic
│   └── upload.js         # Upload processing logic
└── lib/                  # (existing utilities)
```

### Phase 2: Service Layer

Extract business logic from routes:

```javascript
// services/uploadService.js
export class UploadService {
    constructor(db, config) { ... }
    
    async initUpload(params) { ... }
    async processChunk(uploadId, chunk, index) { ... }
    async completeUpload(uploadId) { ... }
    async cancelUpload(uploadId) { ... }
}
```

### Phase 3: Database Abstraction

Create repository pattern for database access:

```javascript
// repositories/fileRepository.js
export class FileRepository {
    constructor(db) { ... }
    
    async findById(id) { ... }
    async findByUser(userId, options) { ... }
    async create(file) { ... }
    async delete(id) { ... }
    async updateDownloadCount(id) { ... }
}
```

### Phase 4: Consider Redis (Optional)

For high-availability deployments:

```javascript
// lib/redisStores.js
import Redis from 'ioredis';

export function createRedisSessionStore(session, redis) { ... }
export function createRedisRateLimitStore(redis) { ... }
export function createRedisCsrfStore(redis) { ... }
```

---

## Multi-Replica Deployment Guide

### Current Support

With the SQLite-based persistent stores, the application now supports multiple replicas:

1. **Shared Database Volume**
   ```yaml
   # docker-compose.yml (single host)
   services:
     app:
       volumes:
         - ./data:/app/data
         - ./uploads:/app/uploads
   ```

   For multi-node deployments, replace bind mounts with a shared volume (NFS/CSI) for `/app/data` and `/app/uploads`.

2. **Same SESSION_SECRET**
   All replicas must use the same `SESSION_SECRET` environment variable.

3. **Shared Uploads Volume**
   All replicas need access to the same `uploads/` directory.

### Limitations

- **Rate Limiting**: Each replica maintains its own counters (acceptable for most cases)
- **Database Writes**: SQLite has limited concurrent writers; use a real database for high write volume

### Recommendations for Scale

| Scale | Database | Session Store | Rate Limit |
|-------|----------|---------------|------------|
| 1 instance | SQLite (current) | SQLite | In-memory |
| 2-3 instances | SQLite + NFS | SQLite | In-memory (OK) |
| 4+ instances | PostgreSQL | Redis | Redis |
| High availability | PostgreSQL | Redis | Redis |

---

## Migration Notes

### From v1.x to v2.x

The following changes require attention:

1. **Session store changed**: Old MemoryStore sessions will be lost on upgrade
2. **New database tables**: `sessions`, `csrf_tokens`, `guest_uploads`, `download_tokens`
3. **Build process**: Secrets no longer embedded in build artifacts

### Database Schema Changes

```sql
-- New tables added by persistentStores.js
CREATE TABLE IF NOT EXISTS sessions (...);
CREATE TABLE IF NOT EXISTS csrf_tokens (...);
CREATE TABLE IF NOT EXISTS guest_uploads (...);
CREATE TABLE IF NOT EXISTS download_tokens (...);
CREATE TABLE IF NOT EXISTS rate_limits (...);
```

---

## Testing Recommendations

### Critical Paths to Test

1. **Session persistence**: Login, restart server, verify still logged in
2. **CSRF protection**: Verify forms work after restart
3. **Guest limits**: Upload as guest, restart, verify limit still applies
4. **Download tokens**: Request token, restart, verify download still works
5. **SPA routing**: Navigate to `/dashboard`, refresh, verify page loads

### Load Testing

For multi-replica testing:
```bash
# Start multiple instances
docker-compose up --scale app=3

# Run load test
k6 run loadtest.js
```
