# Observability

This project exposes Prometheus-compatible metrics for operational monitoring.

## Endpoint
`GET /metrics`

## Metrics Reference

| Metric Name | Type | Description |
| :--- | :--- | :--- |
| `http_requests_total` | Counter | Total HTTP requests categorized by route and status code. |
| `http_request_duration_seconds` | Histogram | Request latency histogram. |
| `indexer_lag_blocks` | Gauge | Current block difference between indexer and chain tip. |
| `indexer_poll_total` | Counter | Success/Failure counts for poll operations. |

## Sample Prometheus Config
```yaml
scrape_configs:
  - job_name: 'guildpass-dashboard'
    static_configs:
      - targets: ['dashboard:3000']
    metrics_path: '/api/metrics'
```