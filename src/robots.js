// 簡易 robots.txt パーサー(RFC9309の主要部分のみをカバー)
function parseRobotsTxt(text) {
  const lines = text.split(/\r?\n/);
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastFieldWasRule = false;

  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || lastFieldWasRule) {
        current = { agents: [value.toLowerCase()], rules: [] };
        groups.push(current);
        lastFieldWasRule = false;
      } else {
        current.agents.push(value.toLowerCase());
      }
    } else if (field === "disallow" || field === "allow") {
      if (current) {
        current.rules.push({ type: field, path: value });
        lastFieldWasRule = true;
      }
    } else if (field === "sitemap") {
      sitemaps.push(value);
    }
  }
  return { groups, sitemaps };
}

// 指定したUser-Agentがルート("/")をブロックされているか判定
function isAgentBlocked(parsed, agentName) {
  const name = agentName.toLowerCase();
  let group = parsed.groups.find((g) => g.agents.includes(name));
  if (!group) group = parsed.groups.find((g) => g.agents.includes("*"));
  if (!group) return { found: false, blocked: false };

  const disallowRoot = group.rules.some(
    (r) => r.type === "disallow" && (r.path === "/" || r.path === "")
  );
  const allowRoot = group.rules.some(
    (r) => r.type === "allow" && (r.path === "/" || r.path === "")
  );
  return { found: true, blocked: disallowRoot && !allowRoot };
}

module.exports = { parseRobotsTxt, isAgentBlocked };
