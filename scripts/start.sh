#!/bin/bash
cd /home/ubuntu/hft-bot

# Start or restart the bot using pm2
pm2 start dist/main.js --name hft-bot

# Save pm2 config so it survives reboots
pm2 save

echo "=== ApplicationStart completed ==="
