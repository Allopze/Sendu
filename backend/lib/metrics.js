/**
 * Minimal in-memory metrics collector
 * Intended for operational visibility (non-persistent)
 */

const counters = new Map();
const startedAt = Date.now();

const increment = (name, value = 1) => {
    const current = counters.get(name) || 0;
    counters.set(name, current + value);
};

const getSnapshot = () => {
    const data = {};
    for (const [key, value] of counters.entries()) {
        data[key] = value;
    }
    return {
        startedAt,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: Date.now(),
        counters: data
    };
};

export const metrics = {
    increment,
    getSnapshot
};

export default metrics;
