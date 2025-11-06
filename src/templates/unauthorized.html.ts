export const renderUnauthorizedHTML = (redirectUrl: string) => `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>未授權訪問</title>
<meta http-equiv="refresh" content="5;url=${redirectUrl}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{max-width:640px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.icon{font-size:48px;margin-bottom:12px}
h1{font-size:24px;margin:0 0 12px;font-weight:600}
p{margin:8px 0;color:#64748b}
.countdown{font-weight:bold;color:#0f172a}
</style>
</head>
<body>
<div class="card">
<div class="icon">⛔</div>
<h1>這裡不是你該來的地方</h1>
<p>即將在 <span class="countdown" id="count">5</span> 秒後返回首頁...</p>
</div>
<script>
let sec=5;
const el=document.getElementById('count');
const t=setInterval(()=>{
sec--;
if(el)el.textContent=String(sec);
if(sec<=0){clearInterval(t);location.href='${redirectUrl}';}
},1000);
</script>
</body>
</html>`;
