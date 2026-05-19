#!/bin/bash
# Clean GCP setup helper for Ubuntu 22.04 LTS
echo -e "\e[32m\e[1m[GCP SETUP] Starting Automated HFT Bot Deployment Setup...\e[0m"

# 1. Update OS Packages
echo -e "\e[34m[1/5] Updating Linux system packages...\e[0m"
sudo apt-get update -y

# 2. Install Node.js v20 LTS
echo -e "\e[34m[2/5] Installing Node.js v20 LTS Runtime...\e[0m"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node versions
echo -e "\e[32mNode version: $(node -v)\e[0m"
echo -e "\e[32mNPM version: $(npm -v)\e[0m"

# 3. Install PM2 Globally
echo -e "\e[34m[3/5] Installing PM2 Global Process Manager...\e[0m"
sudo npm install pm2 -g

# 4. Install Dependencies
echo -e "\e[34m[4/5] Installing project dependencies...\e[0m"
npm install

# 5. Build TypeScript Code
echo -e "\e[34m[5/5] Compiling TypeScript source files...\e[0m"
npm run build

# Make sure logs directory exists
mkdir -p logs

echo -e "\e[32m\e[1m[GCP SETUP] Setup Completed Successfully!\e[0m"
echo -e "========================================================="
echo -e "Untuk menjalankan bot 24/7 secara background, ketik:"
echo -e "  \e[36mpm2 start ecosystem.config.cjs\e[0m"
echo -e ""
echo -e "Untuk memantau aktivitas proses log secara real-time:"
echo -e "  \e[36mpm2 logs\e[0m"
echo -e "========================================================="
