#!/usr/bin/env bash
set -euo pipefail

printf "
Simple deploy script for cf-url-shortener
Usage: export CF_API_TOKEN=token && ./scripts/deploy.sh
Or run and paste token when prompted.
\n"

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed. Please install Node.js v18+"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not available. Please install Node.js which includes npm."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found. Please ensure npm is correctly installed."
  exit 1
fi

if [ -z "${CF_API_TOKEN-}" ]; then
  read -rsp $'Enter Cloudflare API token (input hidden, press Enter when done): ' CF_API_TOKEN
  echo
fi

echo "Installing dependencies..."
npm ci

echo "Building (Tailwind CSS + typecheck)..."
npm run build

echo "Deploying to Cloudflare..."
if [ -n "${CF_API_TOKEN-}" ]; then
  npx wrangler@latest deploy --api-token "$CF_API_TOKEN"
else
  echo "No CF_API_TOKEN provided; running interactive 'wrangler deploy' (you may need to login)."
  wrangler deploy
fi

echo "Done."
