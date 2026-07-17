const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dbPath = path.join(__dirname, "..", "data", "history.sqlite");
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    competitor_url TEXT,
    created_at TEXT NOT NULL,
    seo_score INTEGER,
    llmo_score INTEGER,
    overall_score INTEGER,
    competitor_overall_score INTEGER,
    result_json TEXT NOT NULL
  )
`);

function insertCheck({ url, competitorUrl, createdAt, scores, competitorScores, resultJson }) {
  const stmt = db.prepare(`
    INSERT INTO checks (url, competitor_url, created_at, seo_score, llmo_score, overall_score, competitor_overall_score, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    url,
    competitorUrl || null,
    createdAt,
    scores.seo,
    scores.llmo,
    scores.overall,
    competitorScores ? competitorScores.overall : null,
    resultJson
  );
  return Number(info.lastInsertRowid);
}

function listChecks(limit = 50) {
  const stmt = db.prepare(`
    SELECT id, url, competitor_url as competitorUrl, created_at as createdAt,
           seo_score as seoScore, llmo_score as llmoScore, overall_score as overallScore,
           competitor_overall_score as competitorOverallScore
    FROM checks
    ORDER BY id DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

function getCheck(id) {
  const stmt = db.prepare(`SELECT * FROM checks WHERE id = ?`);
  const row = stmt.get(id);
  if (!row) return null;
  return { ...row, result: JSON.parse(row.result_json) };
}

module.exports = { insertCheck, listChecks, getCheck };
