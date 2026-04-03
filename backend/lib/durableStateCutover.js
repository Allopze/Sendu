import {
    DURABLE_STATE_CUTOVER_TABLES,
    DURABLE_STATE_SNAPSHOT_ORDER_BY,
    quotePostgresIdentifier,
} from './durableStateSchema.js';

const SQLITE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quoteSqliteIdentifier = (identifier) => {
    if (typeof identifier !== 'string' || !SQLITE_IDENTIFIER_PATTERN.test(identifier)) {
        throw new Error(`Invalid SQLite identifier: ${identifier}`);
    }

    return `"${identifier}"`;
};

const getSnapshotOrderBy = (tableName) => {
    if (!Object.hasOwn(DURABLE_STATE_SNAPSHOT_ORDER_BY, tableName)) {
        throw new Error(`No snapshot order defined for durable table: ${tableName}`);
    }

    return DURABLE_STATE_SNAPSHOT_ORDER_BY[tableName];
};

const escapePostgresLiteral = (value) => {
    if (value === null || value === undefined) {
        return 'NULL';
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
    }

    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }

    return `'${String(value).replace(/'/g, "''")}'`;
};

const buildParameterizedInsert = (tableName, row, schemaName) => {
    const columns = Object.keys(row);
    const qualifiedTable = `${quotePostgresIdentifier(schemaName)}.${quotePostgresIdentifier(tableName)}`;
    const quotedColumns = columns.map((column) => quotePostgresIdentifier(column));
    const placeholders = columns.map((_, index) => `$${index + 1}`);

    return {
        text: `INSERT INTO ${qualifiedTable} (${quotedColumns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values: columns.map((column) => row[column]),
    };
};

export const exportSqliteDurableStateSnapshot = ({ db, exportedAt = Date.now() } = {}) => {
    const snapshot = {
        format: 'sendu-durable-state-snapshot/v1',
        exportedAt,
        counts: {},
        sourceMigrations: [],
        tables: {},
    };

    for (const tableName of DURABLE_STATE_CUTOVER_TABLES) {
        const statement = db.prepare(`
            SELECT *
            FROM ${quoteSqliteIdentifier(tableName)}
            ORDER BY ${getSnapshotOrderBy(tableName)}
        `);
        const rows = statement.all();
        snapshot.tables[tableName] = rows;
        snapshot.counts[tableName] = rows.length;
    }

    const migrationsTableExists = db.prepare(`
        SELECT 1 AS found
        FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
    `).get();

    if (migrationsTableExists) {
        snapshot.sourceMigrations = db.prepare(`
            SELECT id
            FROM schema_migrations
            ORDER BY applied_at ASC, id ASC
        `).all().map((row) => row.id);
    }

    return snapshot;
};

export const renderPostgresDurableStateImportSql = ({ snapshot, schemaName = 'public', includeTruncate = false } = {}) => {
    const qualifiedSchema = quotePostgresIdentifier(schemaName);
    const lines = ['BEGIN;'];

    if (includeTruncate) {
        for (const tableName of [...DURABLE_STATE_CUTOVER_TABLES].reverse()) {
            lines.push(`DELETE FROM ${qualifiedSchema}.${quotePostgresIdentifier(tableName)};`);
        }
    }

    for (const tableName of DURABLE_STATE_CUTOVER_TABLES) {
        const rows = snapshot?.tables?.[tableName] || [];
        for (const row of rows) {
            const columns = Object.keys(row);
            const qualifiedTable = `${qualifiedSchema}.${quotePostgresIdentifier(tableName)}`;
            const quotedColumns = columns.map((column) => quotePostgresIdentifier(column)).join(', ');
            const values = columns.map((column) => escapePostgresLiteral(row[column])).join(', ');
            lines.push(`INSERT INTO ${qualifiedTable} (${quotedColumns}) VALUES (${values});`);
        }
    }

    const auditRows = snapshot?.tables?.settings_audit_log || [];
    if (auditRows.length > 0) {
        const maxAuditId = Math.max(...auditRows.map((row) => Number(row.id) || 0));
        lines.push(
            `SELECT setval(pg_get_serial_sequence('${schemaName}.settings_audit_log', 'id'), ${maxAuditId}, true);`
        );
    }

    lines.push('COMMIT;');
    return `${lines.join('\n')}\n`;
};

export const importDurableStateSnapshot = async ({ client, snapshot, schemaName = 'public', truncateFirst = false } = {}) => {
    await client.query('BEGIN');

    try {
        if (truncateFirst) {
            for (const tableName of [...DURABLE_STATE_CUTOVER_TABLES].reverse()) {
                await client.query(`DELETE FROM ${quotePostgresIdentifier(schemaName)}.${quotePostgresIdentifier(tableName)}`);
            }
        }

        for (const tableName of DURABLE_STATE_CUTOVER_TABLES) {
            const rows = snapshot?.tables?.[tableName] || [];
            for (const row of rows) {
                const statement = buildParameterizedInsert(tableName, row, schemaName);
                await client.query(statement.text, statement.values);
            }
        }

        const auditRows = snapshot?.tables?.settings_audit_log || [];
        if (auditRows.length > 0) {
            const maxAuditId = Math.max(...auditRows.map((row) => Number(row.id) || 0));
            await client.query(
                'SELECT setval(pg_get_serial_sequence($1, $2), $3, true)',
                [`${schemaName}.settings_audit_log`, 'id', maxAuditId]
            );
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
};

export default {
    exportSqliteDurableStateSnapshot,
    importDurableStateSnapshot,
    renderPostgresDurableStateImportSql,
};