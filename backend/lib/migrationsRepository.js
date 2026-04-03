import { ensureSqliteDurableStateObjects, SQLITE_DURABLE_STATE_GROUPS } from './durableStateSchema.js';

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const assertIdentifier = (value) => {
    if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
        throw new Error(`Invalid SQLite identifier: ${value}`);
    }

    return value;
};

export const createMigrationsRepository = ({ db }) => {
    let hasMigrationStmt = null;
    let recordMigrationStmt = null;
    const tableInfoStmtCache = new Map();

    const getHasMigrationStmt = () => {
        if (!hasMigrationStmt) {
            hasMigrationStmt = db.prepare('SELECT 1 as found FROM schema_migrations WHERE id = ?');
        }

        return hasMigrationStmt;
    };

    const getRecordMigrationStmt = () => {
        if (!recordMigrationStmt) {
            recordMigrationStmt = db.prepare('INSERT OR REPLACE INTO schema_migrations (id, applied_at) VALUES (?, ?)');
        }

        return recordMigrationStmt;
    };

    const getTableInfoStmt = (tableName) => {
        const normalizedTableName = assertIdentifier(tableName);

        if (!tableInfoStmtCache.has(normalizedTableName)) {
            tableInfoStmtCache.set(normalizedTableName, db.prepare(`PRAGMA table_info(${normalizedTableName})`));
        }

        return tableInfoStmtCache.get(normalizedTableName);
    };

    return {
        ensureSchemaMigrationsTable() {
            ensureSqliteDurableStateObjects(db, SQLITE_DURABLE_STATE_GROUPS.schemaMigrations);
        },

        hasMigration(id) {
            return !!getHasMigrationStmt().get(id);
        },

        recordMigration(id, appliedAt = Date.now()) {
            return getRecordMigrationStmt().run(id, appliedAt).changes || 0;
        },

        listTableColumns(tableName) {
            return getTableInfoStmt(tableName).all();
        },

        tableHasColumn(tableName, columnName) {
            return this.listTableColumns(tableName).some((column) => column.name === columnName);
        },
    };
};

export default createMigrationsRepository;