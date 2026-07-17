const UA = "Mozilla/5.0 (compatible; SEO-LLMO-Checker/1.0; +https://example.com/bot)";

async function fetchWithTimeout(url, { timeoutMs = 10000, ...opts } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, ...(opts.headers || {}) },
      redirect: "follow",
      ...opts,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 補助リソース(robots.txt, sitemap.xml, llms.txt)取得。失敗してもエラーにせずnullを返す
async function fetchTextSafe(url, opts = {}) {
  try {
    const res = await fetchWithTimeout(url, opts);
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, text };
  } catch (err) {
    return { ok: false, status: null, url, text: null, error: err.message };
  }
}

module.exports = { fetchWithTimeout, fetchTextSafe, UA };
