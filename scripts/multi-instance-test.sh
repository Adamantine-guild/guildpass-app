#!/usr/bin/env bash
# ============================================================================
# Multi-Instance Test Script for Horizontally-Scalable Pub/Sub
# ============================================================================
#
# Prerequisites:
#   1. A running PostgreSQL instance (e.g., via `docker compose up postgres -d`)
#   2. The database schema migrated (run `pnpm --filter @guildpass/dashboard db:migrate`)
#   3. pnpm dependencies installed (`pnpm install`)
#
# This script starts TWO dashboard instances on different ports, both
# connected to the same Postgres backend. Instance A runs on port 3000,
# instance B runs on port 3001.
#
# To validate cross-instance delivery:
#   1. Open http://localhost:3000/activity in one browser tab
#   2. Open http://localhost:3001/activity in another browser tab
#   3. Send a webhook to instance A:
#      curl -X POST http://localhost:3000/api/webhooks \
#        -H "Content-Type: application/json" \
#        -H "x-guildpass-signature: v0=computed_signature" \
#        -d '{"id":"test_001","type":"membership.created","created":1700000000,"data":{"name":"Alice","wallet":"0x742d35cC6634c0532925a3B8879539d43374E290"}}'
#   4. Observe that the activity event appears in the browser tab connected
#      to instance B as well as instance A.
#
# ============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Multi-Instance Pub/Sub Test Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# ── Verify prerequisites ────────────────────────────────────────────────────

# Check that pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}Error: pnpm is not installed. Install it via 'npm install -g pnpm'${NC}"
    exit 1
fi

# Check that the database is accessible
if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}Warning: psql not found. Make sure PostgreSQL is running and accessible.${NC}"
fi

# ── Set environment for durable mode ─────────────────────────────────────────

# Default values — override via environment variables
export DASHBOARD_STORAGE_MODE="durable"
export DASHBOARD_API_MODE="${DASHBOARD_API_MODE:-mock}"
export DATABASE_URL="${DATABASE_URL:-postgresql://guildpass:guildpass_dev@localhost:5432/guildpass}"
export WEBHOOK_SECRET="${WEBHOOK_SECRET:-dev-multi-instance-test-secret}"
export ACTIVITY_STORAGE_MODE="file"
export ACTIVITY_STORAGE_DIR="${ACTIVITY_STORAGE_DIR:-$(pwd)/.guildpass-activity-test}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  DASHBOARD_STORAGE_MODE = $DASHBOARD_STORAGE_MODE"
echo "  DASHBOARD_API_MODE     = $DASHBOARD_API_MODE"
echo "  DATABASE_URL           = $DATABASE_URL"
echo "  WEBHOOK_SECRET         = $WEBHOOK_SECRET"
echo ""

# ── Cleanup function ────────────────────────────────────────────────────────

cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down instances...${NC}"
    
    # Kill background processes
    if [ -n "${PID_A:-}" ]; then
        kill "$PID_A" 2>/dev/null || true
        echo "  Instance A (PID $PID_A) stopped"
    fi
    if [ -n "${PID_B:-}" ]; then
        kill "$PID_B" 2>/dev/null || true
        echo "  Instance B (PID $PID_B) stopped"
    fi
    
    # Clean up temp dir
    if [ -n "${ACTIVITY_STORAGE_DIR:-}" ] && [ -d "$ACTIVITY_STORAGE_DIR" ]; then
        rm -rf "$ACTIVITY_STORAGE_DIR" 2>/dev/null || true
    fi
    
    echo -e "${GREEN}Cleanup complete.${NC}"
}
trap cleanup EXIT INT TERM

# ── Start instances ─────────────────────────────────────────────────────────

cd "$(dirname "$0")/.."

echo -e "${GREEN}Starting Instance A on port 3000...${NC}"
DASHBOARD_INSTANCE_ID="A" \
PORT=3000 \
ACTIVITY_STORAGE_DIR="$ACTIVITY_STORAGE_DIR/instance-a" \
pnpm --filter @guildpass/dashboard dev &
PID_A=$!

sleep 3

echo -e "${GREEN}Starting Instance B on port 3001...${NC}"
DASHBOARD_INSTANCE_ID="B" \
PORT=3001 \
ACTIVITY_STORAGE_DIR="$ACTIVITY_STORAGE_DIR/instance-b" \
pnpm --filter @guildpass/dashboard dev &
PID_B=$!

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Both instances are running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Instance A: http://localhost:3000"
echo "  Instance B: http://localhost:3001"
echo ""
echo "  To test cross-instance delivery:"
echo "  1. Open both URLs in separate browser tabs"
echo "  2. Send a webhook to Instance A:"
echo ""
echo "     curl -X POST http://localhost:3000/api/webhooks \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -H 'x-guildpass-signature: compute_this_with_the_secret' \\"
echo "       -d '{\"id\":\"test_$(date +%s)\",\"type\":\"membership.created\",\"created\":$(date +%s),\"data\":{\"name\":\"Alice\",\"wallet\":\"0x742d35cC6634c0532925a3B8879539d43374E290\"}}'"
echo ""
echo "  3. Watch both browser tabs — the event should appear on both."
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop both instances.${NC}"

# Wait for either process to exit
wait

