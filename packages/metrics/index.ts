import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();

export const httpRequestsTotal = new Counter({
name: 'http_requests_total',
help: 'Total number of HTTP requests',
labelNames: ['method', 'route', 'status_code'],
registers: [registry],
});

export const httpRequestDuration = new Histogram({
name: 'http_request_duration_seconds',
help: 'HTTP request latency in seconds',
labelNames: ['method', 'route'],
registers: [registry],
});

export const indexerLagBlocks = new Gauge({
name: 'indexer_lag_blocks',
help: 'Number of blocks the indexer is behind the chain tip',
labelNames: ['contract'],
registers: [registry],
});

export const indexerPollCount = new Counter({
name: 'indexer_poll_total',
help: 'Total indexer poll operations',
labelNames: ['contract', 'status'],
registers: [registry],
});