// api/trigger-refresh.js — dispara o workflow "Atualizar dados do Jira" no repo Gantt_Jira
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: "GITHUB_TOKEN nao configurado nas variaveis de ambiente da Vercel." });
  }

  try {
    const r = await fetch(
      "https://api.github.com/repos/MarcosBelomo/Gantt_Jira/actions/workflows/refresh-data.yml/dispatches",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "pmo-vivahcare",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (r.status !== 204) {
      const text = await r.text();
      return res.status(r.status).json({ error: `GitHub retornou ${r.status}: ${text}` });
    }

    return res.status(200).json({ ok: true, dispatchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
