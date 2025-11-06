// src/interstitial.ts
export type InterstitialOptions = {
  seconds?: number;
  title?: string;
  message?: string;
  naruto?: string;
  logoSvg?: string;
};

export function renderInterstitialHTML(targetUrl: string, opts: InterstitialOptions = {}) {
  const s = Math.max(0, Number(opts.seconds ?? 3));
  const title = opts.title ?? "即將為您跳轉…";
  const msg = opts.message ?? "請稍候，正在帶您前往目的地。";
  const naruto = opts.naruto ?? "木葉飛舞之處，火亦生生不息";
  const logo = opts.logoSvg ?? "🥷";

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<meta name="robots" content="noindex,nofollow" />
<script>
  const target = ${JSON.stringify(targetUrl)};
  let sec = ${s};
  const initialSec = ${s}; // 記錄初始秒數（用於百分比計算的基準）
  const originalSec = ${s}; // 記錄原始設定秒數（永不改變）
  let timer = null;
  let penaltyTimer = null; // 警告訊息的計時器
  let isPageVisible = !document.hidden;
  const baseTitle = ${JSON.stringify(title)};
  
  function go(){ location.href = target; }
  
  function updateTitle() {
    if (document.hidden) {
      document.title = "切回來才會繼續倒數喔 嘻嘻";
    } else {
      document.title = \`(\${sec}秒) \${baseTitle}\`;
    }
  }
  
  function startCountdown() {
    const el = document.getElementById('sec');
    if (sec === 0) return go();
    
    updateTitle(); // 初始化 title
    
    timer = setInterval(() => {
      // 只有當頁面可見時才倒數
      if (!document.hidden) {
        sec--;
        if (el) el.textContent = String(sec);
        updateTitle(); // 更新 title
        if (sec <= 0){ 
          clearInterval(timer); 
          go(); 
        }
      }
    }, 1000);
  }
  
  function stopCountdown() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  
  // 監聽頁面可見性變化
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // 頁面隱藏時停止倒數
      stopCountdown();
      updateTitle(); // 更新 title 顯示提示訊息
    } else {
      // 頁面可見時開始倒數
      if (!timer && sec > 0) {
        startCountdown();
      }
    }
  });
  
  window.addEventListener('DOMContentLoaded', () => {
    // 只有當頁面可見時才開始倒數
    if (!document.hidden) {
      startCountdown();
    }
    
    document.getElementById('skip')?.addEventListener('click', (e) => {
      e.preventDefault(); 
      
      // 檢查剩餘秒數是否超過原始秒數的 90%
      const remainingPercentage = (sec / originalSec) * 100;
      
      if (remainingPercentage > 80 && originalSec > 0) {
        // 加罰 10 秒
        sec += 10;
        
        // 顯示警告訊息
        const msgEl = document.getElementById('penalty-msg');
        if (msgEl) {
          msgEl.textContent = '沒耐心的人們，加罰10秒！';
          msgEl.style.display = 'block';
          
          // 清除舊的計時器
          if (penaltyTimer) {
            clearTimeout(penaltyTimer);
          }
          
          // 8 秒後隱藏訊息
          penaltyTimer = setTimeout(() => {
            msgEl.style.display = 'none';
            penaltyTimer = null;
          }, 8000);
        }
        
        // 更新顯示
        const el = document.getElementById('sec');
        if (el) el.textContent = String(sec);
        updateTitle();
        
        // 如果計時器已停止，重新啟動
        if (!timer && !document.hidden) {
          startCountdown();
        }
      } else {
        // 剩餘時間 <= 90%，允許跳過
        stopCountdown();
        go();
      }
    });
  });
</script>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         background:#f8fafc; color:#0f172a; }
  .card { max-width:640px; margin:14vh auto; background:#fff; border:1px solid #e2e8f0;
          border-radius:16px; padding:28px; text-align:center; box-shadow:0 1px 2px rgba(0,0,0,.05); }
  .logo { font-size:48px; margin-bottom:8px; }
  .btn { display:inline-block; border:1px solid #0f172a; padding:8px 14px; border-radius:10px; text-decoration:none; }
  .penalty-msg { display:none; color:#dc2626; font-weight:bold; font-size:18px; margin:12px 0; 
                 padding:10px; background:#fee2e2; border:1px solid #fca5a5; border-radius:8px; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">${logo}</div>
    <h1 style="margin:0 0 6px">${title}</h1>
    <p style="margin:0 0 10px">${msg}</p>
    <p style="margin:0 0 10px; font-style:italic; color:#6b7280;">${naruto}</p>
    <div id="penalty-msg" class="penalty-msg"></div>
    <p>剩餘 <b id="sec">${s}</b> 秒…</p>
    <p><a id="skip" class="btn" href="${targetUrl}">立即前往</a></p>
  </div>
</body>
</html>`;
}