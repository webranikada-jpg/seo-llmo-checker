const cheerio = require("cheerio");
const { fetchWithTimeout, fetchTextSafe } = require("./fetcher");
const { parseRobotsTxt, isAgentBlocked } = require("./robots");
const AI_BOTS = require("./aiBots");

function normalizeUrl(input) {
  let u = String(input || "").trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

function extractJsonLdTypes(obj, types) {
  if (Array.isArray(obj)) {
    obj.forEach((o) => extractJsonLdTypes(o, types));
    return;
  }
  if (obj && typeof obj === "object") {
    if (obj["@type"]) {
      const t = obj["@type"];
      if (Array.isArray(t)) types.push(...t);
      else types.push(t);
    }
    if (obj["@graph"]) extractJsonLdTypes(obj["@graph"], types);
  }
}

// pass以外のときに表示する改善提案(id別、statusごとに文言を出し分け)
const SUGGESTIONS = {
  https_used: { fail: "SSL証明書を導入し、HTTPからHTTPSへのリダイレクト設定を行ってください。" },
  status_ok: {
    fail: "ページが200以外のステータスを返しています。URLの誤り、リダイレクト設定、サーバーエラーの原因を確認してください。",
  },
  title_exists: {
    fail: "<title>タグを追加し、ページ内容を表す10〜60文字程度のタイトルを設定してください。",
    warn: "titleの文字数を10〜60文字程度に調整してください(短すぎ/長すぎると検索結果で見切れたり評価が下がる場合があります)。",
  },
  meta_description: {
    fail: '<meta name="description" content="...">をhead内に追加し、ページ内容を要約した50〜160文字程度の説明文を設定してください。',
    warn: "meta descriptionの文字数を50〜160文字程度に調整してください。",
  },
  h1_count: {
    fail: "ページ内に<h1>タグを1つ追加し、ページの主題を明確に示してください。",
    warn: "h1タグが複数存在します。h1は1ページに1つにまとめ、他はh2以降の見出しに変更してください。",
  },
  heading_hierarchy: {
    warn: "見出しレベルを飛ばさず、h1→h2→h3の順に階層を意識して使用してください。",
  },
  img_alt: {
    warn: "alt属性が未設定の画像があります。画像の内容を説明する代替テキストを追加してください。",
    fail: '多くの画像にalt属性が設定されていません。装飾目的の画像はalt=""、内容のある画像には具体的な説明文を設定してください。',
  },
  canonical: {
    warn: '<link rel="canonical" href="...">をhead内に追加し、正規URLを明示してください。',
  },
  ogp: {
    fail: "og:title, og:description, og:imageのメタタグをhead内に追加し、SNSでシェアされた際の表示を最適化してください。",
    warn: "不足しているOGPタグ(og:title/og:description/og:image)を追加してください。",
  },
  structured_data: {
    fail: "JSON-LD形式で構造化データ(Organization, WebSite, Article等)を追加し、検索エンジンやAIにページ内容を伝えてください。",
    warn: "JSON-LDの記述内容を見直し、@typeが正しく設定されているか確認してください。",
  },
  robots_txt_exists: {
    fail: "サイトのルート直下(/robots.txt)にrobots.txtを設置してください。",
  },
  robots_txt_sitemap_ref: {
    warn: "robots.txtに`Sitemap: https://your-domain/sitemap.xml`の行を追加してください。",
  },
  sitemap_exists: {
    fail: "sitemap.xmlを生成し、サイトルート直下に設置してください(CMSのプラグイン等で自動生成できる場合があります)。",
    warn: "取得したsitemapの中身がurlset/sitemapindex形式になっているか確認してください。",
  },
  lang_attribute: {
    warn: '<html lang="ja">のようにlang属性を設定し、ページの言語を明示してください。',
  },
  viewport_meta: {
    fail: '<meta name="viewport" content="width=device-width, initial-scale=1">をhead内に追加し、モバイル表示に対応してください。',
  },
  llms_txt: {
    warn: "サイトルート直下にllms.txtを設置し、AIに参照してほしいページの要約やリンクを記載することを検討してください(必須の規格ではありません)。",
  },
  faq_schema: {
    warn: "よくある質問ページなどにFAQPage構造化データ(JSON-LD)を追加すると、AIが質問と回答のペアを認識しやすくなります。",
  },
  qa_style_heading: {
    warn: "見出しを「〜とは?」「〜する方法は?」のような質問形式にすると、AIが検索意図への回答として引用しやすくなります。",
  },
  list_table_usage: {
    warn: "重要な情報を箇条書き(ul/ol)や表(table)にまとめると、AIが情報を抽出・引用しやすくなります。",
  },
  author_date_signals: {
    warn: "著者名(meta name=\"author\"や執筆者表記)と公開日・更新日(datePublished等)を明記し、情報の信頼性(E-E-A-T)を示してください。",
  },
  direct_answer_lead: {
    warn: "本文冒頭の段落で結論・要点を40〜400文字程度で簡潔に述べると、AIが要約・引用しやすくなります。",
  },
};

function check(id, category, label, status, detail) {
  let suggestion = null;
  if (status !== "pass") {
    if (id.startsWith("ai_bot_")) {
      suggestion =
        status === "fail"
          ? `AIに引用・参照されることを重視する場合は、robots.txtで「${label}」に対するアクセスブロックを解除してください。学習目的のクロールを意図的に拒否している場合はそのままで問題ありません。`
          : "robots.txtを取得できるようにし、AIクローラーのアクセス許可状況を確認・管理できるようにしてください。";
    } else {
      const s = SUGGESTIONS[id];
      suggestion = (s && s[status]) || null;
    }
  }
  return { id, category, label, status, detail, suggestion };
}

async function analyzeUrl(inputUrl) {
  const targetUrl = normalizeUrl(inputUrl);
  const checks = [];

  let mainRes;
  let html;
  try {
    mainRes = await fetchWithTimeout(targetUrl, { timeoutMs: 15000 });
    html = await mainRes.text();
  } catch (err) {
    return {
      input: inputUrl,
      finalUrl: targetUrl,
      fetchedAt: new Date().toISOString(),
      httpStatus: null,
      error: `ページを取得できませんでした: ${err.message}`,
      checks: [
        check(
          "site_reachable",
          "seo",
          "サイトへの到達性",
          "fail",
          `取得エラー: ${err.message}`
        ),
      ],
      scores: { seo: 0, llmo: 0, overall: 0 },
    };
  }

  const finalUrl = mainRes.url || targetUrl;
  const httpStatus = mainRes.status;
  const $ = cheerio.load(html);
  const origin = new URL(finalUrl).origin;

  // ---- 補助リソース取得 ----
  const robotsRes = await fetchTextSafe(origin + "/robots.txt");
  const parsedRobots = robotsRes.ok
    ? parseRobotsTxt(robotsRes.text)
    : { groups: [], sitemaps: [] };

  const sitemapUrl = parsedRobots.sitemaps[0] || origin + "/sitemap.xml";
  const sitemapRes = await fetchTextSafe(sitemapUrl);

  const llmsRes = await fetchTextSafe(origin + "/llms.txt");

  // ================= SEO チェック =================
  checks.push(
    check(
      "https_used",
      "seo",
      "HTTPS通信",
      finalUrl.startsWith("https://") ? "pass" : "fail",
      finalUrl.startsWith("https://")
        ? "HTTPSで配信されています"
        : "HTTPSが使用されていません"
    )
  );

  checks.push(
    check(
      "status_ok",
      "seo",
      "HTTPステータス",
      httpStatus >= 200 && httpStatus < 300 ? "pass" : "fail",
      `ステータスコード: ${httpStatus}`
    )
  );

  const title = $("title").first().text().trim();
  if (!title) {
    checks.push(check("title_exists", "seo", "titleタグ", "fail", "titleタグが見つかりません"));
  } else {
    const len = title.length;
    const status = len >= 10 && len <= 60 ? "pass" : "warn";
    checks.push(
      check(
        "title_exists",
        "seo",
        "titleタグ",
        status,
        `"${title}" (${len}文字)${status === "warn" ? " — 推奨は10〜60文字" : ""}`
      )
    );
  }

  const metaDesc = $('meta[name="description"]').attr("content")?.trim();
  if (!metaDesc) {
    checks.push(
      check("meta_description", "seo", "meta description", "fail", "meta descriptionが見つかりません")
    );
  } else {
    const len = metaDesc.length;
    const status = len >= 50 && len <= 160 ? "pass" : "warn";
    checks.push(
      check(
        "meta_description",
        "seo",
        "meta description",
        status,
        `"${metaDesc.slice(0, 80)}${metaDesc.length > 80 ? "..." : ""}" (${len}文字)${
          status === "warn" ? " — 推奨は50〜160文字" : ""
        }`
      )
    );
  }

  const h1s = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  if (h1s.length === 0) {
    checks.push(check("h1_count", "seo", "h1見出し", "fail", "h1が見つかりません"));
  } else if (h1s.length === 1) {
    checks.push(check("h1_count", "seo", "h1見出し", "pass", `h1: "${h1s[0]}"`));
  } else {
    checks.push(
      check("h1_count", "seo", "h1見出し", "warn", `h1が${h1s.length}個あります(1個が推奨)`)
    );
  }

  const levelsPresent = new Set();
  $("h1,h2,h3,h4,h5,h6").each((_, el) => levelsPresent.add(Number(el.tagName[1])));
  let hierarchyOk = true;
  let maxSeen = 0;
  const sortedLevels = [...levelsPresent].sort((a, b) => a - b);
  for (const lvl of sortedLevels) {
    if (maxSeen > 0 && lvl - maxSeen > 1) hierarchyOk = false;
    maxSeen = Math.max(maxSeen, lvl);
  }
  checks.push(
    check(
      "heading_hierarchy",
      "seo",
      "見出し階層",
      sortedLevels.length === 0 ? "warn" : hierarchyOk ? "pass" : "warn",
      sortedLevels.length === 0
        ? "見出しタグが見つかりません"
        : hierarchyOk
        ? "見出しレベルの飛びはありません"
        : `見出しレベルに飛びがあります (使用レベル: h${sortedLevels.join(", h")})`
    )
  );

  const imgs = $("img");
  const totalImgs = imgs.length;
  const missingAlt = imgs.filter((_, el) => !$(el).attr("alt")?.trim()).length;
  if (totalImgs === 0) {
    checks.push(check("img_alt", "seo", "画像のalt属性", "pass", "画像はありません"));
  } else {
    const ratio = (totalImgs - missingAlt) / totalImgs;
    const status = ratio >= 0.9 ? "pass" : ratio >= 0.5 ? "warn" : "fail";
    checks.push(
      check(
        "img_alt",
        "seo",
        "画像のalt属性",
        status,
        `${totalImgs}枚中${totalImgs - missingAlt}枚にalt設定あり (${Math.round(ratio * 100)}%)`
      )
    );
  }

  const canonical = $('link[rel="canonical"]').attr("href");
  checks.push(
    check(
      "canonical",
      "seo",
      "canonicalタグ",
      canonical ? "pass" : "warn",
      canonical ? `canonical: ${canonical}` : "canonicalタグが見つかりません"
    )
  );

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDesc = $('meta[property="og:description"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
  checks.push(
    check(
      "ogp",
      "seo",
      "OGPタグ",
      ogCount === 3 ? "pass" : ogCount > 0 ? "warn" : "fail",
      `og:title=${!!ogTitle} og:description=${!!ogDesc} og:image=${!!ogImage}`
    )
  );

  const jsonLdScripts = $('script[type="application/ld+json"]');
  const structuredTypes = [];
  let jsonLdParseError = false;
  jsonLdScripts.each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      extractJsonLdTypes(data, structuredTypes);
    } catch {
      jsonLdParseError = true;
    }
  });
  if (jsonLdScripts.length === 0) {
    checks.push(check("structured_data", "seo", "構造化データ(JSON-LD)", "fail", "JSON-LDが見つかりません"));
  } else if (structuredTypes.length === 0) {
    checks.push(
      check(
        "structured_data",
        "seo",
        "構造化データ(JSON-LD)",
        "warn",
        jsonLdParseError ? "JSON-LDの解析に失敗しました" : "@typeが見つかりません"
      )
    );
  } else {
    checks.push(
      check(
        "structured_data",
        "seo",
        "構造化データ(JSON-LD)",
        "pass",
        `検出された型: ${[...new Set(structuredTypes)].join(", ")}`
      )
    );
  }

  checks.push(
    check(
      "robots_txt_exists",
      "seo",
      "robots.txt",
      robotsRes.ok ? "pass" : "fail",
      robotsRes.ok ? "robots.txtが存在します" : "robots.txtが取得できません"
    )
  );

  checks.push(
    check(
      "robots_txt_sitemap_ref",
      "seo",
      "robots.txt内のsitemap記載",
      parsedRobots.sitemaps.length > 0 ? "pass" : "warn",
      parsedRobots.sitemaps.length > 0
        ? `記載あり: ${parsedRobots.sitemaps[0]}`
        : "robots.txtにSitemap記載がありません"
    )
  );

  const sitemapValid =
    sitemapRes.ok &&
    sitemapRes.text &&
    (sitemapRes.text.includes("<urlset") || sitemapRes.text.includes("<sitemapindex"));
  checks.push(
    check(
      "sitemap_exists",
      "seo",
      "sitemap.xml",
      sitemapValid ? "pass" : sitemapRes.ok ? "warn" : "fail",
      sitemapValid
        ? `sitemapを確認しました: ${sitemapRes.url}`
        : sitemapRes.ok
        ? "sitemapは取得できましたが形式が確認できません"
        : "sitemap.xmlが取得できません"
    )
  );

  const htmlLang = $("html").attr("lang");
  checks.push(
    check(
      "lang_attribute",
      "seo",
      "html lang属性",
      htmlLang ? "pass" : "warn",
      htmlLang ? `lang="${htmlLang}"` : "html要素にlang属性がありません"
    )
  );

  const viewport = $('meta[name="viewport"]').attr("content");
  checks.push(
    check(
      "viewport_meta",
      "seo",
      "viewportメタタグ(モバイル対応)",
      viewport ? "pass" : "fail",
      viewport ? `viewport: ${viewport}` : "viewportメタタグが見つかりません"
    )
  );

  // ================= LLMO チェック =================
  checks.push(
    check(
      "llms_txt",
      "llmo",
      "llms.txt",
      llmsRes.ok ? "pass" : "warn",
      llmsRes.ok ? "llms.txtが存在します" : "llms.txtが見つかりません(新しい規格のため未対応でも致命的ではありません)"
    )
  );

  if (!robotsRes.ok) {
    for (const bot of AI_BOTS) {
      checks.push(
        check(`ai_bot_${bot.id}`, "llmo", bot.label, "warn", "robots.txtが取得できないため判定できません")
      );
    }
  } else {
    for (const bot of AI_BOTS) {
      const result = isAgentBlocked(parsedRobots, bot.agent);
      checks.push(
        check(
          `ai_bot_${bot.id}`,
          "llmo",
          bot.label,
          result.blocked ? "fail" : "pass",
          result.blocked
            ? `robots.txtでアクセスがブロックされています`
            : "アクセスがブロックされていません"
        )
      );
    }
  }

  const faqSchema = structuredTypes.some((t) => String(t).toLowerCase() === "faqpage");
  checks.push(
    check(
      "faq_schema",
      "llmo",
      "FAQ構造化データ",
      faqSchema ? "pass" : "warn",
      faqSchema ? "FAQPageが検出されました" : "FAQPage構造化データが見つかりません"
    )
  );

  const headingTexts = $("h2,h3,h4")
    .map((_, el) => $(el).text().trim())
    .get();
  const hasQuestionHeading = headingTexts.some((t) => /[??]/.test(t));
  checks.push(
    check(
      "qa_style_heading",
      "llmo",
      "質問形式の見出し",
      hasQuestionHeading ? "pass" : "warn",
      hasQuestionHeading
        ? "質問形式の見出しが見つかりました"
        : "質問形式(〜とは?/〜ですか?)の見出しが見つかりません"
    )
  );

  const listTableCount = $("ul,ol,table").length;
  checks.push(
    check(
      "list_table_usage",
      "llmo",
      "箇条書き・表の使用",
      listTableCount > 0 ? "pass" : "warn",
      listTableCount > 0
        ? `箇条書き/表が${listTableCount}件あります`
        : "箇条書きや表がなく、AIが情報を抽出しにくい可能性があります"
    )
  );

  const hasAuthorMeta =
    !!$('meta[name="author"]').attr("content") ||
    $('[rel="author"]').length > 0 ||
    structuredTypes.length > 0 && html.includes('"author"');
  const hasDateSignal =
    !!$('meta[property="article:published_time"]').attr("content") ||
    $("time").length > 0 ||
    html.includes('"datePublished"');
  const authorDateStatus = hasAuthorMeta && hasDateSignal ? "pass" : hasAuthorMeta || hasDateSignal ? "warn" : "warn";
  checks.push(
    check(
      "author_date_signals",
      "llmo",
      "著者・更新日時情報(E-E-A-T)",
      hasAuthorMeta && hasDateSignal ? "pass" : "warn",
      `著者情報: ${hasAuthorMeta ? "あり" : "なし"} / 日時情報: ${hasDateSignal ? "あり" : "なし"}`
    )
  );

  const firstParagraph = $("p")
    .map((_, el) => $(el).text().trim())
    .get()
    .find((t) => t.length > 0);
  const paraLen = firstParagraph ? firstParagraph.length : 0;
  checks.push(
    check(
      "direct_answer_lead",
      "llmo",
      "冒頭での要点提示",
      paraLen >= 40 && paraLen <= 400 ? "pass" : "warn",
      firstParagraph
        ? `冒頭の段落: "${firstParagraph.slice(0, 60)}${firstParagraph.length > 60 ? "..." : ""}" (${paraLen}文字)`
        : "本文冒頭の段落が見つかりません"
    )
  );

  // ================= スコア集計 =================
  function scoreOf(category) {
    const items = checks.filter((c) => c.category === category);
    if (items.length === 0) return null;
    const earned = items.reduce(
      (sum, c) => sum + (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0),
      0
    );
    return Math.round((earned / items.length) * 100);
  }

  const seoScore = scoreOf("seo");
  const llmoScore = scoreOf("llmo");
  const overall = Math.round((seoScore + llmoScore) / 2);

  return {
    input: inputUrl,
    finalUrl,
    fetchedAt: new Date().toISOString(),
    httpStatus,
    checks,
    scores: { seo: seoScore, llmo: llmoScore, overall },
  };
}

module.exports = { analyzeUrl, normalizeUrl };
