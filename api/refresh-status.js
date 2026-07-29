// api/refresh-status.js — verifica o status da ultima execucao do workflow de atualizacao
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: "GITHUB_TOKEN nao configurado nas variaveis de ambiente da Vercel." });
  }

  try {
    const r = await fetch(
      "https://api.github.com/repos/MarcosBelomo/Gantt_Jira/actions/workflows/refresh-data.yml/runs?per_page=1",
      {
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "pmo-vivahcare",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `GitHub retornou ${r.status}: ${text}` });
    }

    const data = await r.json();
    const run = data.workflow_runs && data.workflow_runs[0];
    if (!run) return res.status(200).json({ status: "unknown" });

    return res.status(200).json({
      status: run.status,
      conclusion: run.conclusion,
      updatedAt: run.updated_at,
      htmlUrl: run.html_url,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
