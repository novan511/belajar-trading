#!/bin/bash
cd /home/ubuntu/hft-bot

# Gracefully stop the bot if it's running
pm2 stop hft-bot || true

echo "=== ApplicationStop completed ==="
