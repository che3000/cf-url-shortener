@echo off
rem Simple deploy script for cf-url-shortener (Windows)
rem Usage: set CF_API_TOKEN=yourtoken && scripts\deploy.bat

where node >nul 2>&1 || (
  echo Node.js not found. Please install Node v18+ and try again.
  exit /b 1
)

where npm >nul 2>&1 || (
  echo npm not found. Please install Node.js which includes npm.
  exit /b 1
)

if "%CF_API_TOKEN%"=="" (
  set /p CF_API_TOKEN=Enter Cloudflare API token (input will be visible): 
)

echo Installing dependencies...
npm ci || exit /b 1

echo Building (Tailwind CSS + typecheck)...
npm run build || exit /b 1

echo Deploying to Cloudflare...
if "%CF_API_TOKEN%"=="" (
  echo No CF_API_TOKEN provided; running interactive "wrangler deploy" (you may need to login).
  wrangler deploy || exit /b 1
) else (
  npx wrangler@latest deploy --api-token %CF_API_TOKEN% || exit /b 1
)

echo Done.
