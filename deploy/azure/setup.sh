#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu server (e.g. an Azure for Students free VM):
# adds swap, installs Docker, writes deploy/azure/.env and starts the stack.
#
#   git clone https://github.com/RishabhPR77/ai-interview.git && cd ai-interview
#   bash deploy/azure/setup.sh
#
# Re-running it is safe: existing swap, Docker and .env are kept. To skip the
# prompts, export DOMAIN, BREVO_API_KEY and EMAIL_FROM_ADDRESS first.
set -euo pipefail
cd "$(dirname "$0")"

# 1. Swap — a 1 GB server needs it for the image build and answer analysis.
if ! swapon --show | grep -q '^/swapfile'; then
  echo "==> Adding 4 GB swap"
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# Keep the app in RAM: by default Linux swaps it out in favour of cached video
# files, and the next answer then waits while it's read back from disk.
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-tejaskrit.conf >/dev/null
sudo sysctl -q -p /etc/sysctl.d/99-tejaskrit.conf

# 2. Docker (official convenience script).
if ! command -v docker >/dev/null; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi

# 3. Settings.
if [ ! -f .env ]; then
  DOMAIN=${DOMAIN:-}
  BREVO_API_KEY=${BREVO_API_KEY:-}
  EMAIL_FROM_ADDRESS=${EMAIL_FROM_ADDRESS:-}
  [ -n "$DOMAIN" ] || read -rp "Domain (e.g. tejaskrit.centralindia.cloudapp.azure.com): " DOMAIN
  [ -n "$BREVO_API_KEY" ] || { read -rsp "Brevo API key: " BREVO_API_KEY; echo; }
  [ -n "$EMAIL_FROM_ADDRESS" ] || read -rp "Brevo verified sender email: " EMAIL_FROM_ADDRESS
  secret() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(secret)
SECRET_KEY=$(secret)
ENCRYPTION_KEY=$(secret)
BREVO_API_KEY=$BREVO_API_KEY
EMAIL_FROM_ADDRESS=$EMAIL_FROM_ADDRESS
EMAIL_FROM_NAME=tejaskrit
EOF
  echo "==> Wrote deploy/azure/.env — copy ENCRYPTION_KEY from it into a password manager."
fi

# 4. Build and start (the first build takes 15-25 minutes on a small server).
echo "==> Building and starting the app"
sudo docker compose up -d --build
sudo docker compose ps
echo "==> Done. Open https://$(grep '^DOMAIN=' .env | cut -d= -f2) in a minute or two."
