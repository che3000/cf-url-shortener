@echo off
setlocal
rem Simple deploy script for cf-url-shortener (Windows)
rem Usage: set CLOUDFLARE_API_TOKEN=yourtoken && scripts\deploy.bat

where node >nul 2>&1 || (
  echo Node.js not found. Please install Node v18+ and try again.
  exit /b 1
)

where npm >nul 2>&1 || (
  echo npm not found. Please install Node.js which includes npm.
  exit /b 1
)

if not defined CLOUDFLARE_API_TOKEN if defined CF_API_TOKEN set "CLOUDFLARE_API_TOKEN=%CF_API_TOKEN%"
set "CF_API_TOKEN="

echo Installing dependencies...
npm ci || exit /b 1

echo Building (Tailwind CSS + typecheck)...
npm run build || exit /b 1

echo Checking Cloudflare Access protection...
npm run check:access || exit /b 1

echo Deploying to Cloudflare...
npx wrangler deploy || exit /b 1

echo Done.
