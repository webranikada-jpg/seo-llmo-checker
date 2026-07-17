// 主要なAIクローラー(LLM学習・検索用)のUser-Agent一覧
module.exports = [
  { id: "gptbot", label: "GPTBot (OpenAI)", agent: "GPTBot" },
  { id: "chatgpt_user", label: "ChatGPT-User (OpenAI)", agent: "ChatGPT-User" },
  { id: "oai_searchbot", label: "OAI-SearchBot (OpenAI検索)", agent: "OAI-SearchBot" },
  { id: "google_extended", label: "Google-Extended (Gemini学習)", agent: "Google-Extended" },
  { id: "claudebot", label: "ClaudeBot (Anthropic)", agent: "ClaudeBot" },
  { id: "anthropic_ai", label: "anthropic-ai (Anthropic)", agent: "anthropic-ai" },
  { id: "perplexitybot", label: "PerplexityBot (Perplexity)", agent: "PerplexityBot" },
  { id: "ccbot", label: "CCBot (Common Crawl)", agent: "CCBot" },
  { id: "bytespider", label: "Bytespider (ByteDance)", agent: "Bytespider" },
  { id: "applebot_extended", label: "Applebot-Extended (Apple Intelligence)", agent: "Applebot-Extended" },
];
