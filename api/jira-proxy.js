// api/jira-proxy.js — Lê gantt-data.json do GitHub
// Não chama o Jira diretamente (Atlassian bloqueia IPs de data centers)
const https = require("https");

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // Lê o gantt-data.json diretamente do GitHub (funciona sem bloqueio)
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
    const headers = {
      "User-Agent": "pmo-vivahcare",
      "Accept": "application/vnd.github.v3.raw",
    };
    if (GITHUB_TOKEN) headers["Authorization"] = `token ${GITHUB_TOKEN}`;

    const r = await httpsGet(
      "https://raw.githubusercontent.com/MarcosBelomo/Gantt_Jira/main/data/gantt-data.json",
      headers
    );

    if (r.status !== 200) {
      return res.status(r.status).json({
        error: `GitHub retornou ${r.status}. Verifique se o arquivo gantt-data.json existe no repositório.`,
      });
    }

    const ganttData = r.body;

    // Adapta o formato do gantt-data.json para o formato esperado pelo relatório
    const today = new Date(); today.setHours(0,0,0,0);

    // gantt-data.json tem os itens em formato específico — adapta para o formato do relatório
    const itens = (ganttData.itens || ganttData.items || ganttData.tasks || ganttData.issues || []).map(item => {
      const dueDate = item.dueDate || item.due_date || item.endDate || null;
      const daysRemaining = dueDate
        ? Math.ceil((new Date(dueDate) - today) / 86400000)
        : null;
      return {
        key: item.key || item.id || "",
        type: item.type || item.issuetype || "Tarefa",
        isSubtask: item.isSubtask || false,
        parentKey: item.parentKey || null,
        parentSummary: item.parentSummary || null,
        summary: item.summary || item.title || item.name || "",
        assignee: item.assignee || null,
        assigneeGroup: item.assigneeGroup || item.assignee || "Sem Responsável",
        status: item.status || "",
        startDate: item.startDate || item.start_date || null,
        dueDate,
        daysRemaining,
        flagged: item.flagged || false,
        blocked: item.blocked || false,
        sprint: ganttData.sprint || ganttData.sprintName || "Sprint Ativa",
      };
    });

    // KPIs
    const sm = (s, rx) => s && new RegExp(rx, "i").test(s);
    const kpis = {
      total: itens.length,
      emAndamento: itens.filter(i => sm(i.status, "andamento")).length,
      tarefasPendentes: itens.filter(i => sm(i.status, "tarefas pendentes|pendente")).length,
      concluido: itens.filter(i => sm(i.status, "conclu")).length,
      atrasados: itens.filter(i => i.daysRemaining !== null && i.daysRemaining < 0 && !sm(i.status, "conclu")).length,
      bloqueados: itens.filter(i => i.blocked).length,
      porResponsavel: ["Erikson","Lucas","Rafael","Hamze","Vivahcare"].map(nome => ({
        nome, total: itens.filter(i => (i.assigneeGroup||"").includes(nome)).length,
      })),
    };
    const pctConcluido = kpis.total > 0 ? Math.round((kpis.concluido / kpis.total) * 100) : 0;

    return res.status(200).json({
      sprint: ganttData.sprint || ganttData.sprintName || "Sprint Ativa",
      sprintStart: ganttData.sprintStart || null,
      sprintEnd: ganttData.sprintEnd || null,
      geradoEm: ganttData.geradoEm || new Date().toISOString(),
      kpis, pctConcluido, itens,
      fonte: "gantt-data.json (GitHub)",
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
