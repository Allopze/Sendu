const ensureObjectNames = (registry, objectNames) => {
    for (const objectName of objectNames) {
        if (!Object.hasOwn(registry, objectName)) {
            throw new Error(`Unknown durable schema object: ${objectName}`);
        }
    }

    return objectNames;
};

export const quotePostgresIdentifier = (identifier) => {
    if (typeof identifier !== 'string' || identifier.length === 0) {
        throw new Error('PostgreSQL identifier is required');
    }

    return `"${identifier.replace(/"/g, '""')}"`;
};

const applySchemaName = (statement, schemaName) => {
    const qualifiedSchema = quotePostgresIdentifier(schemaName);
    return statement.replaceAll('{{schema}}', qualifiedSchema);
};

const SQLITE_DURABLE_STATE_OBJECTS = {
    schemaMigrationsTable: `
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        )
    `,
    usersTable: `
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            passwordHash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            isVerified INTEGER DEFAULT 0,
            verificationToken TEXT,
            verificationTokenExpires INTEGER,
            resetToken TEXT,
            resetTokenExpires INTEGER,
            createdAt INTEGER NOT NULL
        )
    `,
    filesTable: `
        CREATE TABLE IF NOT EXISTS files (
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
        )
    `,
    settingsTable: `
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `,
    reportsTable: `
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            fileId TEXT NOT NULL,
            reason TEXT NOT NULL,
            createdAt INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            FOREIGN KEY (fileId) REFERENCES files(id)
        )
    `,
    guestUploadsTable: `
        CREATE TABLE IF NOT EXISTS guest_uploads (
            fingerprint TEXT PRIMARY KEY,
            totalBytes INTEGER DEFAULT 0,
            uploadCount INTEGER DEFAULT 0,
            lastUpload INTEGER,
            createdAt INTEGER NOT NULL
        )
    `,
    uploadSessionsTable: `
        CREATE TABLE IF NOT EXISTS upload_sessions (
            uploadId TEXT PRIMARY KEY,
            userId TEXT,
            ipFingerprint TEXT,
            status TEXT DEFAULT 'initiated',
            fileId TEXT,
            bytesReceived INTEGER DEFAULT 0,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )
    `,
    settingsAuditLogTable: `
        CREATE TABLE IF NOT EXISTS settings_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            adminUserId TEXT NOT NULL,
            settingKey TEXT NOT NULL,
            oldValue TEXT,
            newValue TEXT,
            changedAt INTEGER NOT NULL
        )
    `,
    downloadTokensTable: `
        CREATE TABLE IF NOT EXISTS download_tokens (
            token TEXT PRIMARY KEY,
            file_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )
    `,
    jobQueueTable: `
        CREATE TABLE IF NOT EXISTS job_queue (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            priority INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 3,
            last_error TEXT,
            scheduled_at INTEGER NOT NULL,
            started_at INTEGER,
            completed_at INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            locked_by TEXT,
            locked_until INTEGER
        )
    `,
    idxUploadSessionsStatus: 'CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status)',
    idxFilesUserId: 'CREATE INDEX IF NOT EXISTS idx_files_userId ON files(userId)',
    idxFilesExpiresAt: 'CREATE INDEX IF NOT EXISTS idx_files_expiresAt ON files(expiresAt)',
    idxFilesCreatedAt: 'CREATE INDEX IF NOT EXISTS idx_files_createdAt ON files(createdAt)',
    idxSettingsAuditLogChangedAt: 'CREATE INDEX IF NOT EXISTS idx_settings_audit_log_changedAt ON settings_audit_log(changedAt DESC)',
    idxSettingsAuditLogAdminUserId: 'CREATE INDEX IF NOT EXISTS idx_settings_audit_log_adminUserId ON settings_audit_log(adminUserId)',
    idxSettingsAuditLogSettingKey: 'CREATE INDEX IF NOT EXISTS idx_settings_audit_log_settingKey ON settings_audit_log(settingKey)',
    idxGuestLastUpload: 'CREATE INDEX IF NOT EXISTS idx_guest_last_upload ON guest_uploads(lastUpload)',
    idxDownloadExpires: 'CREATE INDEX IF NOT EXISTS idx_download_expires ON download_tokens(expires_at)',
    idxJobStatus: 'CREATE INDEX IF NOT EXISTS idx_job_status ON job_queue(status)',
    idxJobScheduled: 'CREATE INDEX IF NOT EXISTS idx_job_scheduled ON job_queue(scheduled_at)',
    idxJobType: 'CREATE INDEX IF NOT EXISTS idx_job_type ON job_queue(type)',
    idxJobPriority: 'CREATE INDEX IF NOT EXISTS idx_job_priority ON job_queue(priority DESC, scheduled_at ASC)',
};

const POSTGRES_DURABLE_STATE_REGISTRY = {
    usersTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.users (
            "id" TEXT PRIMARY KEY,
            "email" TEXT UNIQUE NOT NULL,
            "username" TEXT UNIQUE NOT NULL,
            "passwordHash" TEXT NOT NULL,
            "role" TEXT DEFAULT 'user',
            "isVerified" INTEGER DEFAULT 0,
            "verificationToken" TEXT,
            "verificationTokenExpires" BIGINT,
            "resetToken" TEXT,
            "resetTokenExpires" BIGINT,
            "createdAt" BIGINT NOT NULL
        )
    `,
    filesTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.files (
            "id" TEXT PRIMARY KEY,
            "originalName" TEXT NOT NULL,
            "serverPath" TEXT NOT NULL,
            "mimeType" TEXT NOT NULL,
            "size" BIGINT NOT NULL,
            "createdAt" BIGINT NOT NULL,
            "expiresAt" BIGINT,
            "maxDownloads" INTEGER,
            "downloadCount" INTEGER DEFAULT 0,
            "passwordHash" TEXT,
            "userId" TEXT REFERENCES {{schema}}.users("id")
        )
    `,
    settingsTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.settings (
            "key" TEXT PRIMARY KEY,
            "value" TEXT NOT NULL
        )
    `,
    reportsTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.reports (
            "id" TEXT PRIMARY KEY,
            "fileId" TEXT NOT NULL REFERENCES {{schema}}.files("id"),
            "reason" TEXT NOT NULL,
            "createdAt" BIGINT NOT NULL,
            "status" TEXT DEFAULT 'pending'
        )
    `,
    guestUploadsTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.guest_uploads (
            "fingerprint" TEXT PRIMARY KEY,
            "totalBytes" BIGINT DEFAULT 0,
            "uploadCount" INTEGER DEFAULT 0,
            "lastUpload" BIGINT,
            "createdAt" BIGINT NOT NULL
        )
    `,
    uploadSessionsTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.upload_sessions (
            "uploadId" TEXT PRIMARY KEY,
            "userId" TEXT,
            "ipFingerprint" TEXT,
            "status" TEXT DEFAULT 'initiated',
            "fileId" TEXT,
            "bytesReceived" BIGINT DEFAULT 0,
            "createdAt" BIGINT NOT NULL,
            "updatedAt" BIGINT NOT NULL
        )
    `,
    settingsAuditLogTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.settings_audit_log (
            "id" BIGSERIAL PRIMARY KEY,
            "adminUserId" TEXT NOT NULL,
            "settingKey" TEXT NOT NULL,
            "oldValue" TEXT,
            "newValue" TEXT,
            "changedAt" BIGINT NOT NULL
        )
    `,
    downloadTokensTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.download_tokens (
            "token" TEXT PRIMARY KEY,
            "file_id" TEXT NOT NULL,
            "expires_at" BIGINT NOT NULL,
            "created_at" BIGINT DEFAULT ((EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT)
        )
    `,
    jobQueueTable: `
        CREATE TABLE IF NOT EXISTS {{schema}}.job_queue (
            "id" TEXT PRIMARY KEY,
            "type" TEXT NOT NULL,
            "payload" TEXT NOT NULL,
            "status" TEXT DEFAULT 'pending',
            "priority" INTEGER DEFAULT 0,
            "attempts" INTEGER DEFAULT 0,
            "max_retries" INTEGER DEFAULT 3,
            "last_error" TEXT,
            "scheduled_at" BIGINT NOT NULL,
            "started_at" BIGINT,
            "completed_at" BIGINT,
            "created_at" BIGINT DEFAULT ((EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT),
            "locked_by" TEXT,
            "locked_until" BIGINT
        )
    `,
    idxUploadSessionsStatus: 'CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON {{schema}}.upload_sessions("status")',
    idxFilesUserId: 'CREATE INDEX IF NOT EXISTS idx_files_user_id ON {{schema}}.files("userId")',
    idxFilesExpiresAt: 'CREATE INDEX IF NOT EXISTS idx_files_expires_at ON {{schema}}.files("expiresAt")',
    idxFilesCreatedAt: 'CREATE INDEX IF NOT EXISTS idx_files_created_at ON {{schema}}.files("createdAt")',
    idxSettingsAuditLogChangedAt: 'CREATE INDEX IF NOT EXISTS idx_settings_audit_log_changed_at ON {{schema}}.settings_audit_log("changedAt" DESC)',
    idxSettingsAuditLogAdminUserId: 'CREATE INDEX IF NOT EXISTS idx_settings_audit_log_admin_user_id ON {{schema}}.settings_audit_log("adminUserId")',
    idxSettingsAuditLogSettingKey: 'CREATE INDEX IF NOT EXISTS idx_settings_audit_log_setting_key ON {{schema}}.settings_audit_log("settingKey")',
    idxGuestLastUpload: 'CREATE INDEX IF NOT EXISTS idx_guest_last_upload ON {{schema}}.guest_uploads("lastUpload")',
    idxDownloadExpires: 'CREATE INDEX IF NOT EXISTS idx_download_expires ON {{schema}}.download_tokens("expires_at")',
    idxJobStatus: 'CREATE INDEX IF NOT EXISTS idx_job_status ON {{schema}}.job_queue("status")',
    idxJobScheduled: 'CREATE INDEX IF NOT EXISTS idx_job_scheduled ON {{schema}}.job_queue("scheduled_at")',
    idxJobType: 'CREATE INDEX IF NOT EXISTS idx_job_type ON {{schema}}.job_queue("type")',
    idxJobPriority: 'CREATE INDEX IF NOT EXISTS idx_job_priority ON {{schema}}.job_queue("priority" DESC, "scheduled_at" ASC)',
};

export const SQLITE_DURABLE_STATE_GROUPS = {
    schemaMigrations: ['schemaMigrationsTable'],
    initialCore: [
        'usersTable',
        'filesTable',
        'settingsTable',
        'reportsTable',
        'guestUploadsTable',
        'uploadSessionsTable',
        'idxUploadSessionsStatus',
    ],
    filesIndexes: ['idxFilesUserId', 'idxFilesExpiresAt', 'idxFilesCreatedAt'],
    settingsAudit: [
        'settingsAuditLogTable',
        'idxSettingsAuditLogChangedAt',
        'idxSettingsAuditLogAdminUserId',
        'idxSettingsAuditLogSettingKey',
    ],
    durableStateExpansion: [
        'guestUploadsTable',
        'downloadTokensTable',
        'idxDownloadExpires',
        'jobQueueTable',
        'idxJobStatus',
        'idxJobScheduled',
        'idxJobType',
        'idxJobPriority',
        'idxGuestLastUpload',
    ],
};

export const POSTGRES_DURABLE_STATE_OBJECT_SEQUENCE = [
    'usersTable',
    'filesTable',
    'settingsTable',
    'reportsTable',
    'guestUploadsTable',
    'uploadSessionsTable',
    'settingsAuditLogTable',
    'downloadTokensTable',
    'jobQueueTable',
    'idxUploadSessionsStatus',
    'idxFilesUserId',
    'idxFilesExpiresAt',
    'idxFilesCreatedAt',
    'idxSettingsAuditLogChangedAt',
    'idxSettingsAuditLogAdminUserId',
    'idxSettingsAuditLogSettingKey',
    'idxGuestLastUpload',
    'idxDownloadExpires',
    'idxJobStatus',
    'idxJobScheduled',
    'idxJobType',
    'idxJobPriority',
];

export const DURABLE_STATE_CUTOVER_TABLES = [
    'settings',
    'users',
    'files',
    'reports',
    'guest_uploads',
    'upload_sessions',
    'settings_audit_log',
    'download_tokens',
    'job_queue',
];

export const DURABLE_STATE_SNAPSHOT_ORDER_BY = {
    settings: 'key ASC',
    users: 'id ASC',
    files: 'id ASC',
    reports: 'id ASC',
    guest_uploads: 'fingerprint ASC',
    upload_sessions: 'uploadId ASC',
    settings_audit_log: 'id ASC',
    download_tokens: 'token ASC',
    job_queue: 'id ASC',
};

export const ensureSqliteDurableStateObjects = (db, objectNames) => {
    const validatedNames = ensureObjectNames(SQLITE_DURABLE_STATE_OBJECTS, objectNames);
    for (const objectName of validatedNames) {
        db.exec(SQLITE_DURABLE_STATE_OBJECTS[objectName]);
    }
};

export const getSqliteDurableStateStatements = (objectNames) => {
    const validatedNames = ensureObjectNames(SQLITE_DURABLE_STATE_OBJECTS, objectNames);
    return validatedNames.map((objectName) => SQLITE_DURABLE_STATE_OBJECTS[objectName]);
};

export const getPostgresDurableStateStatements = ({ objectNames = POSTGRES_DURABLE_STATE_OBJECT_SEQUENCE, schemaName = 'public' } = {}) => {
    const validatedNames = ensureObjectNames(POSTGRES_DURABLE_STATE_REGISTRY, objectNames);

    return [
        `CREATE SCHEMA IF NOT EXISTS ${quotePostgresIdentifier(schemaName)}`,
        ...validatedNames.map((objectName) => applySchemaName(POSTGRES_DURABLE_STATE_REGISTRY[objectName], schemaName)),
    ];
};

export default {
    DURABLE_STATE_CUTOVER_TABLES,
    DURABLE_STATE_SNAPSHOT_ORDER_BY,
    POSTGRES_DURABLE_STATE_OBJECT_SEQUENCE,
    SQLITE_DURABLE_STATE_GROUPS,
    ensureSqliteDurableStateObjects,
    getPostgresDurableStateStatements,
    getSqliteDurableStateStatements,
    quotePostgresIdentifier,
};