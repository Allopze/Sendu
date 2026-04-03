import {
    POSTGRES_DURABLE_STATE_OBJECT_SEQUENCE,
    getPostgresDurableStateStatements,
    quotePostgresIdentifier,
} from './durableStateSchema.js';

const POSTGRES_MIGRATIONS_TABLE = 'schema_migrations';

export const createPostgresMigrationsRepository = ({ client, schemaName = 'public' }) => {
    const qualifiedSchema = quotePostgresIdentifier(schemaName);
    const qualifiedTable = `${qualifiedSchema}.${quotePostgresIdentifier(POSTGRES_MIGRATIONS_TABLE)}`;

    return {
        async ensureSchemaMigrationsTable() {
            await client.query(`CREATE SCHEMA IF NOT EXISTS ${qualifiedSchema}`);
            await client.query(`
                CREATE TABLE IF NOT EXISTS ${qualifiedTable} (
                    id TEXT PRIMARY KEY,
                    applied_at BIGINT NOT NULL
                )
            `);
        },

        async hasMigration(id) {
            const result = await client.query(`SELECT 1 AS found FROM ${qualifiedTable} WHERE id = $1`, [id]);
            return result.rows.length > 0;
        },

        async recordMigration(id, appliedAt = Date.now()) {
            await client.query(
                `
                    INSERT INTO ${qualifiedTable} (id, applied_at)
                    VALUES ($1, $2)
                    ON CONFLICT (id) DO UPDATE SET applied_at = EXCLUDED.applied_at
                `,
                [id, appliedAt]
            );
        },
    };
};

export const POSTGRES_DURABLE_STATE_MIGRATIONS = [
    {
        id: '001_postgres_durable_state',
        objectNames: POSTGRES_DURABLE_STATE_OBJECT_SEQUENCE,
    },
];

export const renderPostgresDurableStateSchema = ({ schemaName = 'public' } = {}) => (
    `${getPostgresDurableStateStatements({ schemaName }).join(';\n\n')};\n`
);

export const runPostgresDurableStateMigrations = async ({ client, schemaName = 'public', logger } = {}) => {
    const migrationsRepository = createPostgresMigrationsRepository({ client, schemaName });
    await migrationsRepository.ensureSchemaMigrationsTable();

    for (const migration of POSTGRES_DURABLE_STATE_MIGRATIONS) {
        if (await migrationsRepository.hasMigration(migration.id)) {
            continue;
        }

        await client.query('BEGIN');
        try {
            const statements = getPostgresDurableStateStatements({
                objectNames: migration.objectNames,
                schemaName,
            });

            for (const statement of statements) {
                await client.query(statement);
            }

            await migrationsRepository.recordMigration(migration.id);
            await client.query('COMMIT');
            logger?.info?.('PostgreSQL durable state migration applied', { id: migration.id, schemaName });
        } catch (err) {
            await client.query('ROLLBACK');
            logger?.error?.('PostgreSQL durable state migration failed', { id: migration.id, schemaName, error: err.message });
            throw err;
        }
    }
};

export default {
    POSTGRES_DURABLE_STATE_MIGRATIONS,
    createPostgresMigrationsRepository,
    renderPostgresDurableStateSchema,
    runPostgresDurableStateMigrations,
};