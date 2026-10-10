#!/usr/bin/env bash
set -euo pipefail

printf "
Simple deploy script for cf-url-shortener
Usage: export CLOUDFLARE_API_TOKEN=token && ./scripts/deploy.sh
CF_API_TOKEN is also accepted for compatibility.
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

if [ -z "${CF_API_TOKEN-}" ] && [ -z "${CLOUDFLARE_API_TOKEN-}" ]; then
  read -rsp $'Enter Cloudflare API token (input hidden, press Enter when done): ' CF_API_TOKEN
  echo
fi

if [ -z "${CLOUDFLARE_API_TOKEN-}" ] && [ -n "${CF_API_TOKEN-}" ]; then
  export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
fi
unset CF_API_TOKEN

echo "Installing dependencies..."
npm ci

echo "Building (Tailwind CSS + typecheck)..."
npm run build

echo "Checking Cloudflare Access protection..."
npm run check:access

echo "Deploying to Cloudflare..."
npx wrangler deploy

echo "Done."
