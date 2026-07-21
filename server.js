const express = require("express");
const path = require("path");
const { analyzeUrl } = require("./src/checker");
const { analyzeKeyword, getTokenizer } = require("./src/keywordAnalyzer");
const { insertCheck, listChecks, getCheck } = require("./src/db");

// 初回リクエストが遅くならないよう起動時に形態素解析辞書を読み込んでおく
getTokenizer().catch((err) => console.error("kuromoji init failed:", err.message));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/check", async (req, res) => {
  const { url, competitorUrl } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "urlを指定してください" });
  }

  try {
    const main = await analyzeUrl(url);
    const competitor = competitorUrl ? await analyzeUrl(competitorUrl) : null;

    const createdAt = new Date().toISOString();
    const id = insertCheck({
      url: main.finalUrl || url,
      competitorUrl: competitor ? competitor.finalUrl || competitorUrl : null,
      createdAt,
      scores: main.scores,
      competitorScores: competitor ? competitor.scores : null,
      resultJson: JSON.stringify({ main, competitor }),
    });

    res.json({ id, main, competitor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/keyword-analysis", async (req, res) => {
  const { url, keyword } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "urlを指定してください" });
  }
  if (!keyword || typeof keyword !== "string") {
    return res.status(400).json({ error: "keywordを指定してください" });
  }

  try {
    const result = await analyzeKeyword(url, keyword);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(listChecks(limit));
});

app.get("/api/history/:id", (req, res) => {
  const record = getCheck(Number(req.params.id));
  if (!record) return res.status(404).json({ error: "見つかりません" });
  res.json(record);
});

app.listen(PORT, () => {
  console.log(`SEO/LLMO Checker running at http://localhost:${PORT}`);
});
