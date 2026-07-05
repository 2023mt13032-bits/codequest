#!/usr/bin/env bash
# One-shot deploy for a fresh Ubuntu 22.04 / 24.04 DigitalOcean droplet.
# Usage: copy the project folder to the droplet, cd into it, then: bash deploy.sh
set -e

echo "==> Installing Docker (if missing)..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Preparing .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  # generate random secrets automatically
  sed -i "s/pick-a-strong-db-password/$(openssl rand -hex 16)/" .env
  sed -i "s/pick-another-password/$(openssl rand -hex 16)/" .env
  sed -i "s/pick-a-long-random-string-for-jwt-signing/$(openssl rand -hex 32)/" .env
  echo ""
  echo "  !! A .env file was created with random DB secrets."
  echo "  !! Now edit .env and set ADMIN_PASSWORD to something you'll remember:"
  echo "  !!    nano .env"
  echo "  Then run this script again."
  exit 0
fi

echo "==> Building and starting all services (first build takes a few minutes)..."
docker compose up -d --build

echo ""
echo "==> Done! Open http://$(curl -s ifconfig.me 2>/dev/null || echo '<your-droplet-ip>')"
echo "    Log in as the admin user from your .env file."
