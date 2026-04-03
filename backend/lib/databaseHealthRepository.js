export const createDatabaseHealthRepository = ({ db }) => {
    const pingStmt = db.prepare('SELECT 1');

    return {
        async ping() {
            return Boolean(pingStmt.get());
        },
    };
};

export default createDatabaseHealthRepository;