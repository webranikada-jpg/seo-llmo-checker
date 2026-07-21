const path = require("path");
const cheerio = require("cheerio");
const kuromoji = require("kuromoji");
const { fetchWithTimeout } = require("./fetcher");
const { normalizeUrl } = require("./checker");

const STOPWORD_PHRASES = new Set([
  "こと", "もの", "これ", "それ", "あれ", "ため", "よう", "とき", "的",
  "様", "さん", "の", "や", "など", "ところ", "そこ", "ここ",
]);

// kuromojiは英語の機能語も名詞として拾ってしまうため、英語ページ用に別途除外する
const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "up", "about", "into", "over", "after", "is", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "must", "can",
  "this", "that", "these", "those", "it", "its", "as", "if", "then", "than",
  "so", "such", "not", "no", "nor", "too", "very", "just", "also", "more",
  "most", "some", "any", "all", "each", "other", "which", "who", "whom",
  "whose", "what", "when", "where", "why", "how", "you", "your", "we", "our",
  "they", "their", "he", "she", "his", "her", "i", "my", "read", "learn",
]);

function isLowValuePhrase(phrase) {
  // 文字(かな/漢字/英数字)を含まない記号だけの語句を除外
  if (!/[a-zA-Z0-9ぁ-んァ-ヶ一-龠]/.test(phrase)) return true;

  const isAsciiOnly = /^[a-zA-Z]+$/.test(phrase);
  if (isAsciiOnly && (phrase.length <= 2 || ENGLISH_STOPWORDS.has(phrase.toLowerCase()))) {
    return true;
  }
  return false;
}

let tokenizerPromise = null;
function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji
        .builder({ dicPath: path.join(__dirname, "..", "node_modules", "kuromoji", "dict") })
        .build((err, tokenizer) => {
          if (err) reject(err);
          else resolve(tokenizer);
        });
    });
  }
  return tokenizerPromise;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 連続する名詞を1つのフレーズとして結合し、頻出フレーズを抽出する
function extractKeyPhrases(tokenizer, text, excludeTerm) {
  const tokens = tokenizer.tokenize(text);
  const phraseCounts = new Map();
  let current = [];

  const flush = () => {
    if (current.length > 0) {
      const phrase = current.join("");
      if (phrase.length >= 2 && !STOPWORD_PHRASES.has(phrase)) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
      }
      current = [];
    }
  };

  for (const t of tokens) {
    const isNoun =
      t.pos === "名詞" &&
      !["非自立", "代名詞", "数", "接尾"].includes(t.pos_detail_1);
    if (isNoun) {
      current.push(t.surface_form);
    } else {
      flush();
    }
  }
  flush();

  const excludeLower = (excludeTerm || "").toLowerCase();
  return [...phraseCounts.entries()]
    .filter(
      ([phrase, count]) =>
        count >= 2 && phrase.toLowerCase() !== excludeLower && !isLowValuePhrase(phrase)
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([phrase, count]) => ({ phrase, count }));
}

function check(id, label, status, detail, suggestion) {
  return { id, label, status, detail, suggestion: status !== "pass" ? suggestion : null };
}

async function analyzeKeyword(inputUrl, keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) {
    return { input: inputUrl, keyword: kw, error: "キーワードを入力してください" };
  }

  const targetUrl = normalizeUrl(inputUrl);
  let mainRes;
  let html;
  try {
    mainRes = await fetchWithTimeout(targetUrl, { timeoutMs: 15000 });
    html = await mainRes.text();
  } catch (err) {
    return { input: inputUrl, keyword: kw, error: `ページを取得できませんでした: ${err.message}` };
  }

  const finalUrl = mainRes.url || targetUrl;
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  // ブロック要素の境界にスペースを入れておかないと、隣接タグのテキストが
  // "announcementRead" のように連結されてしまい語句抽出の質が落ちる
  $("br").replaceWith(" ");
  $(
    "p, div, li, h1, h2, h3, h4, h5, h6, td, th, tr, table, section, article, " +
      "header, footer, nav, ul, ol, blockquote, pre, figure, figcaption, dt, dd"
  ).append(" ");

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const title = $("title").first().text().trim();
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() || "";
  const h1Text = $("h1").map((_, el) => $(el).text().trim()).get().join(" ");
  const subHeadingTexts = $("h2,h3").map((_, el) => $(el).text().trim()).get();
  const imgAltJoined = $("img").map((_, el) => $(el).attr("alt") || "").get().join(" ");
  const urlSlug = decodeURIComponent(new URL(finalUrl).pathname);

  const kwLower = kw.toLowerCase();
  const includesKw = (text) => text.toLowerCase().includes(kwLower);

  const checks = [];

  checks.push(
    check(
      "kw_title",
      "titleタグ",
      includesKw(title) ? "pass" : "fail",
      includesKw(title) ? `titleに含まれています: "${title}"` : `titleに含まれていません: "${title || "(titleなし)"}"`,
      `titleタグに「${kw}」を含めることを検討してください(例:「${kw} | サイト名」のような形)。`
    )
  );

  checks.push(
    check(
      "kw_meta",
      "meta description",
      includesKw(metaDesc) ? "pass" : "warn",
      includesKw(metaDesc) ? "meta descriptionに含まれています" : "meta descriptionに含まれていません",
      `meta descriptionの説明文に自然な形で「${kw}」を含めてください。`
    )
  );

  checks.push(
    check(
      "kw_h1",
      "h1見出し",
      includesKw(h1Text) ? "pass" : "fail",
      includesKw(h1Text) ? `h1に含まれています: "${h1Text}"` : `h1に含まれていません: "${h1Text || "(h1なし)"}"`,
      `h1見出しに「${kw}」を含め、ページの主題であることを明確にしてください。`
    )
  );

  const subHeadingHitCount = subHeadingTexts.filter((t) => includesKw(t)).length;
  checks.push(
    check(
      "kw_subheadings",
      "h2/h3見出し",
      subHeadingHitCount > 0 ? "pass" : "warn",
      subHeadingHitCount > 0
        ? `${subHeadingHitCount}個の見出しに含まれています`
        : "見出し(h2/h3)に含まれていません",
      `h2やh3の見出しにも「${kw}」やその関連語を含め、内容の網羅性を示してください。`
    )
  );

  checks.push(
    check(
      "kw_url",
      "URL",
      includesKw(urlSlug) ? "pass" : "warn",
      includesKw(urlSlug) ? `URLに含まれています: ${urlSlug}` : `URLに含まれていません: ${urlSlug}`,
      "可能であればURLのスラッグにキーワード(ローマ字表記など)を含めることを検討してください。"
    )
  );

  checks.push(
    check(
      "kw_alt",
      "画像alt属性",
      includesKw(imgAltJoined) ? "pass" : "warn",
      includesKw(imgAltJoined) ? "alt属性に含まれる画像があります" : "alt属性にキーワードを含む画像がありません",
      "関連する画像のalt属性に、自然な形でキーワードを含めることを検討してください。"
    )
  );

  const leadText = bodyText.slice(0, 300);
  checks.push(
    check(
      "kw_lead",
      "本文冒頭での言及",
      includesKw(leadText) ? "pass" : "warn",
      includesKw(leadText) ? "本文冒頭(300文字以内)で言及されています" : "本文冒頭(300文字以内)で言及されていません",
      "記事の冒頭でキーワードに触れ、何についてのページかを早い段階で示してください。"
    )
  );

  const kwCount = (bodyText.match(new RegExp(escapeRegExp(kw), "gi")) || []).length;
  const totalChars = bodyText.length || 1;
  const density = ((kwCount * kw.length) / totalChars) * 100;
  let densityStatus;
  let densitySuggestion;
  if (kwCount === 0) {
    densityStatus = "fail";
    densitySuggestion = `本文中に「${kw}」が一度も出てきていません。自然な文章の中に適度に含めてください。`;
  } else if (density > 3.5) {
    densityStatus = "warn";
    densitySuggestion = "出現頻度が高すぎる可能性があります。不自然なキーワードの詰め込みは避けてください。";
  } else if (density < 0.3) {
    densityStatus = "warn";
    densitySuggestion = "本文中での言及が少なめです。関連する文脈の中で自然に増やすことを検討してください。";
  } else {
    densityStatus = "pass";
  }
  checks.push(
    check(
      "kw_density",
      "出現回数・密度",
      densityStatus,
      `本文中に${kwCount}回出現(密度 約${density.toFixed(2)}%)`,
      densitySuggestion
    )
  );

  const earned = checks.reduce(
    (sum, c) => sum + (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0),
    0
  );
  const score = Math.round((earned / checks.length) * 100);

  let topTerms = [];
  try {
    const tokenizer = await getTokenizer();
    topTerms = extractKeyPhrases(tokenizer, bodyText, kw);
  } catch {
    topTerms = [];
  }

  return {
    input: inputUrl,
    finalUrl,
    keyword: kw,
    fetchedAt: new Date().toISOString(),
    checks,
    score,
    topTerms,
  };
}

module.exports = { analyzeKeyword, getTokenizer };
