export const renderRootHTML = (author: string, contact: string) => `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Shortener</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
	<div style="max-width:720px;margin:4rem auto;text-align:center">
		<h1>URL Shortener</h1>
		<p>這裡沒有內容。</p>
        <p>別在探索的時候遺失了自我。</p>
	</div>
	<footer style="position:fixed;bottom:1rem;left:0;right:0">
		<div style="max-width:720px;margin:0 auto;text-align:center;font-size:.75rem;color:#888">
			<p>${author ? author : ""}</p>
			<p>${contact ? contact : ""}</p>
		</div>
	</footer>
</body></html>`;
