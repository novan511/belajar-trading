#!/bin/bash
cd /home/ubuntu/hft-bot

# Install any dependencies
npm install --production

# Build TypeScript
npm run build

# Create log file if not exists
touch hft_debug.log

# Create or update system_state.json with active=true
echo '{"isTradingActive": true}' > system_state.json

# Ensure scripts are executable
chmod +x scripts/*.sh

# Stop existing bot if running
pm2 stop hft-bot || true
pm2 delete hft-bot || true

echo "=== BeforeInstall completed ==="
