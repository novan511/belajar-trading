#!/bin/bash
cd /home/ubuntu/hft-bot

# Check if the bot process is running
if pm2 show hft-bot > /dev/null 2>&1; then
    echo "Bot is running. Validating..."
    
    # Check if the process actually started (pm2 status)
    STATUS=$(pm2 jlist | grep -A1 '"hft-bot"' | grep 'status' | head -1)
    
    if echo "$STATUS" | grep -q "online"; then
        echo "=== ValidateService PASSED: Bot is online ==="
        exit 0
    else
        echo "=== ValidateService FAILED: Bot process not online ==="
        exit 1
    fi
else
    echo "=== ValidateService FAILED: Bot process not found ==="
    exit 1
fi
