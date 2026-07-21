const form = document.getElementById("check-form");
const submitBtn = document.getElementById("submit-btn");
const statusMsg = document.getElementById("status-msg");
const resultSection = document.getElementById("result-section");
const historyList = document.getElementById("history-list");

const kwForm = document.getElementById("keyword-form");
const kwSubmitBtn = document.getElementById("kw-submit-btn");
const kwStatusMsg = document.getElementById("kw-status-msg");
const kwResultSection = document.getElementById("kw-result-section");

const STATUS_LABEL = { pass: "OK", warn: "要改善", fail: "NG" };
const CATEGORY_LABEL = { seo: "SEO", llmo: "LLMO(生成AI最適化)" };

function scoreClass(score) {
  if (score === null || score === undefined) return "";
  if (score >= 80) return "pass";
  if (score >= 50) return "warn";
  return "fail";
}

function pill(status) {
  return `<span class="status-pill ${status}">${STATUS_LABEL[status] || status}</span>`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderScoreGrid(scores, prefix) {
  return `
    <div class="score-grid">
      <div class="score-box">
        <div class="label">${prefix}SEOスコア</div>
        <div class="value" style="color:var(--${scoreClass(scores.seo)})">${scores.seo ?? "-"}</div>
      </div>
      <div class="score-box">
        <div class="label">${prefix}LLMOスコア</div>
        <div class="value" style="color:var(--${scoreClass(scores.llmo)})">${scores.llmo ?? "-"}</div>
      </div>
      <div class="score-box overall">
        <div class="label">${prefix}総合スコア</div>
        <div class="value" style="color:var(--${scoreClass(scores.overall)})">${scores.overall ?? "-"}</div>
      </div>
    </div>
  `;
}

function renderChecklistTable(mainChecks, competitorChecks, category) {
  const mainItems = mainChecks.filter((c) => c.category === category);
  const compMap = new Map((competitorChecks || []).map((c) => [c.id, c]));
  const hasCompetitor = !!competitorChecks;

  const rows = mainItems
    .map((item) => {
      const comp = compMap.get(item.id);
      const suggestionCell =
        item.status !== "pass"
          ? `<td class="suggestion-text">${escapeHtml(item.suggestion || "")}</td>`
          : `<td class="suggestion-text">-</td>`;
      if (hasCompetitor) {
        return `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td>${pill(item.status)}</td>
            <td>${comp ? pill(comp.status) : "-"}</td>
            <td class="detail-text">
              自社: ${escapeHtml(item.detail)}<br/>
              競合: ${comp ? escapeHtml(comp.detail) : "取得なし"}
            </td>
            ${suggestionCell}
          </tr>
        `;
      }
      return `
        <tr>
          <td>${escapeHtml(item.label)}</td>
          <td>${pill(item.status)}</td>
          <td class="detail-text">${escapeHtml(item.detail)}</td>
          ${suggestionCell}
        </tr>
      `;
    })
    .join("");

  const headerCols = hasCompetitor
    ? `<th>項目</th><th>自社</th><th>競合</th><th>詳細</th><th>自社の改善方法</th>`
    : `<th>項目</th><th>判定</th><th>詳細</th><th>改善方法</th>`;

  return `
    <div class="category-block">
      <h3>${CATEGORY_LABEL[category]}</h3>
      <table class="checklist">
        <thead><tr>${headerCols}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderResult(data) {
  const { main, competitor } = data;

  if (main.error) {
    resultSection.innerHTML = `<section class="card"><p class="status-msg error">${escapeHtml(main.error)}</p></section>`;
    resultSection.classList.remove("hidden");
    return;
  }

  let html = `<section class="card">`;
  if (competitor) {
    html += `
      <div class="compare-header">
        <div>
          <h3>自社サイト</h3>
          <div class="url">${escapeHtml(main.finalUrl)}</div>
        </div>
        <div>
          <h3>競合サイト</h3>
          <div class="url">${escapeHtml(competitor.finalUrl || competitor.input)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>${renderScoreGrid(main.scores, "")}</div>
        <div>${renderScoreGrid(competitor.error ? { seo: null, llmo: null, overall: null } : competitor.scores, "")}</div>
      </div>
      ${competitor.error ? `<p class="status-msg error">競合サイト取得エラー: ${escapeHtml(competitor.error)}</p>` : ""}
    `;
  } else {
    html += `
      <div class="url" style="margin-bottom:10px;">${escapeHtml(main.finalUrl)}</div>
      ${renderScoreGrid(main.scores, "")}
    `;
  }
  html += `</section>`;

  html += `<section class="card">`;
  html += renderChecklistTable(main.checks, competitor && !competitor.error ? competitor.checks : null, "seo");
  html += renderChecklistTable(main.checks, competitor && !competitor.error ? competitor.checks : null, "llmo");
  html += `</section>`;

  resultSection.innerHTML = html;
  resultSection.classList.remove("hidden");
}

async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const items = await res.json();
    if (items.length === 0) {
      historyList.innerHTML = `<p class="detail-text">まだチェック履歴がありません</p>`;
      return;
    }
    historyList.innerHTML = items
      .map(
        (item) => `
        <div class="history-item" data-id="${item.id}">
          <div>
            <div class="main-url">${escapeHtml(item.url)}${item.competitorUrl ? ` <span class="detail-text">vs ${escapeHtml(item.competitorUrl)}</span>` : ""}</div>
            <div class="meta">${new Date(item.createdAt).toLocaleString("ja-JP")}</div>
          </div>
          <div class="scores">総合 ${item.overallScore ?? "-"}${item.competitorOverallScore !== null ? ` / 競合 ${item.competitorOverallScore}` : ""}</div>
        </div>
      `
      )
      .join("");

    historyList.querySelectorAll(".history-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const id = el.getAttribute("data-id");
        const res = await fetch(`/api/history/${id}`);
        const record = await res.json();
        renderResult(record.result);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  } catch (err) {
    historyList.innerHTML = `<p class="status-msg error">履歴の読み込みに失敗しました</p>`;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = document.getElementById("url").value.trim();
  const competitorUrl = document.getElementById("competitorUrl").value.trim();

  submitBtn.disabled = true;
  statusMsg.textContent = "チェック中です。ページを取得して解析しています...";
  statusMsg.classList.remove("error");
  resultSection.classList.add("hidden");

  try {
    const res = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, competitorUrl: competitorUrl || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "チェックに失敗しました");

    statusMsg.textContent = "";
    renderResult(data);
    loadHistory();
  } catch (err) {
    statusMsg.textContent = err.message;
    statusMsg.classList.add("error");
  } finally {
    submitBtn.disabled = false;
  }
});

function renderKeywordResult(data) {
  if (data.error) {
    kwResultSection.innerHTML = `<section class="card"><p class="status-msg error">${escapeHtml(data.error)}</p></section>`;
    kwResultSection.classList.remove("hidden");
    return;
  }

  const rows = data.checks
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.label)}</td>
        <td>${pill(item.status)}</td>
        <td class="detail-text">${escapeHtml(item.detail)}</td>
        <td class="suggestion-text">${item.status !== "pass" ? escapeHtml(item.suggestion || "") : "-"}</td>
      </tr>
    `
    )
    .join("");

  const termCloud = data.topTerms.length
    ? `
      <div class="term-cloud">
        ${data.topTerms
          .map(
            (t) =>
              `<span class="term-chip">${escapeHtml(t.phrase)}<span class="count">${t.count}回</span></span>`
          )
          .join("")}
      </div>
    `
    : `<p class="detail-text">頻出語を抽出できませんでした</p>`;

  kwResultSection.innerHTML = `
    <section class="card">
      <div class="url" style="margin-bottom:4px;">${escapeHtml(data.finalUrl)}</div>
      <div class="detail-text" style="margin-bottom:10px;">対象キーワード: 「${escapeHtml(data.keyword)}」</div>
      <div class="score-grid" style="grid-template-columns: 1fr;">
        <div class="score-box overall">
          <div class="label">キーワード対策スコア</div>
          <div class="value" style="color:var(--${scoreClass(data.score)})">${data.score}</div>
        </div>
      </div>
    </section>
    <section class="card">
      <div class="category-block" style="margin-top:0;">
        <h3>キーワード使用状況</h3>
        <table class="checklist">
          <thead><tr><th>項目</th><th>判定</th><th>詳細</th><th>改善方法</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="category-block">
        <h3>ページ内でよく使われている語句(対策キーワードのヒント)</h3>
        <p class="section-desc" style="margin-bottom:6px;">「${escapeHtml(
          data.keyword
        )}」以外に、このページが実際にカバーしている話題です。関連キーワードとして対策できていない語句がないか確認してください。</p>
        ${termCloud}
      </div>
    </section>
  `;
  kwResultSection.classList.remove("hidden");
}

kwForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = document.getElementById("kwUrl").value.trim();
  const keyword = document.getElementById("keyword").value.trim();

  kwSubmitBtn.disabled = true;
  kwStatusMsg.textContent = "分析中です。ページを取得して形態素解析しています...";
  kwStatusMsg.classList.remove("error");
  kwResultSection.classList.add("hidden");

  try {
    const res = await fetch("/api/keyword-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, keyword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "分析に失敗しました");

    kwStatusMsg.textContent = "";
    renderKeywordResult(data);
  } catch (err) {
    kwStatusMsg.textContent = err.message;
    kwStatusMsg.classList.add("error");
  } finally {
    kwSubmitBtn.disabled = false;
  }
});

loadHistory();
