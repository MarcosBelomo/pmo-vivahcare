// api/jira-proxy.js — Vercel Serverless Function
// Usa Cloud ID do Jira para autenticação correta
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { JIRA_EMAIL, JIRA_API_TOKEN, JIRA_BASE_URL, JIRA_CLOUD_ID } = process.env;

  if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
    return res.status(500).json({ error: "JIRA_EMAIL ou JIRA_API_TOKEN não configurados." });
  }

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };

  // Usa Cloud ID se disponível, senão usa BASE_URL
  const cloudId = JIRA_CLOUD_ID || "a4f5777e-2496-4956-b0f3-222d9c1fae0c";
  const baseUrl = JIRA_BASE_URL || "https://vivahcare.atlassian.net";

  // Usa URL direta com API v3
  const searchDirect = (params) => {
    const qs = new URLSearchParams({
      jql: params.jql,
      maxResults: String(params.maxResults),
      startAt: String(params.startAt || 0),
      fields: params.fields.join(","),
    }).toString();
    return httpsGet(`${baseUrl}/rest/api/3/search?${qs}`, headers);
  };
  const searchCloud = searchDirect;

  const FIELDS = [
    "summary", "status", "assignee", "issuetype", "parent",
    "customfield_10015", "duedate", "customfield_10020",
    "customfield_10021", "labels", "subtasks",
  ];

  try {
    // 1. Tenta via Cloud API primeiro
    let probe = await searchCloud({
      jql: "project = VVO AND sprint in openSprints() ORDER BY key ASC",
      maxResults: 1,
      fields: FIELDS,
    });

    // Fallback para API direta se Cloud API falhar
    if (probe.status !== 200) {
      probe = await searchDirect({
        jql: "project = VVO AND sprint in openSprints() ORDER BY key ASC",
        maxResults: 1,
        fields: FIELDS,
      });
    }

    if (probe.status !== 200) {
      return res.status(probe.status).json({
        error: `Jira retornou ${probe.status}`,
        detail: typeof probe.body === "string" ? probe.body.slice(0, 500) : JSON.stringify(probe.body).slice(0, 500),
        cloudId,
        baseUrl,
      });
    }

    const search = searchDirect;

    // 2. Info da sprint
    let sprintName = "Sprint Ativa", sprintStart = null, sprintEnd = null;
    if (probe.body.issues?.length > 0) {
      const sprints = probe.body.issues[0].fields?.customfield_10020 || [];
      const active = sprints.find(s => s.state === "active") || sprints[0];
      if (active) {
        sprintName = active.name;
        sprintStart = active.startDate?.slice(0, 10);
        sprintEnd = active.endDate?.slice(0, 10);
      }
    }

    // 3. Busca todos os itens
    const allIssues = [];
    let startAt = 0;
    while (true) {
      const r = await search({
        jql: "project = VVO AND sprint in openSprints() ORDER BY key ASC",
        maxResults: 100, startAt, fields: FIELDS,
      });
      if (r.status !== 200) break;
      const batch = r.body.issues || [];
      allIssues.push(...batch);
      if (batch.length < 100 || allIssues.length >= (r.body.total || 0)) break;
      startAt += 100;
    }

    // 4. Mapeia itens
    const GRUPOS = { Erikson:["Erikson"], Lucas:["Lucas"], Rafael:["Rafael"], Hamze:["Hamze"], Vivahcare:["Vivahcare"] };
    const today = new Date(); today.setHours(0,0,0,0);

    const itens = allIssues.map(issue => {
      const f = issue.fields;
      const assigneeName = f.assignee?.displayName || null;
      let assigneeGroup = "Sem Responsável";
      if (assigneeName) {
        for (const [g, kws] of Object.entries(GRUPOS)) {
          if (kws.some(k => assigneeName.toLowerCase().includes(k.toLowerCase()))) {
            assigneeGroup = g; break;
          }
        }
      }
      const dueDate = f.duedate || null;
      const daysRemaining = dueDate ? Math.ceil((new Date(dueDate) - today) / 86400000) : null;
      const labels = f.labels || [];
      const itemSprints = f.customfield_10020 || [];
      const activeSp = itemSprints.find(s => s.state === "active") || itemSprints[0];
      if (activeSp && !sprintStart) {
        sprintName = activeSp.name;
        sprintStart = activeSp.startDate?.slice(0, 10);
        sprintEnd = activeSp.endDate?.slice(0, 10);
      }
      return {
        key: issue.key,
        type: f.issuetype?.name || "",
        isSubtask: f.issuetype?.subtask || false,
        parentKey: f.parent?.key || null,
        parentSummary: f.parent?.fields?.summary || null,
        summary: f.summary || "",
        assignee: assigneeName,
        assigneeGroup,
        status: f.status?.name || "",
        startDate: f.customfield_10015 || null,
        dueDate,
        daysRemaining,
        flagged: !!f.customfield_10021,
        blocked: labels.includes("blocked") || labels.includes("impediment"),
        sprint: sprintName,
      };
    });

    // 5. KPIs
    const sm = (s, rx) => s && new RegExp(rx, "i").test(s);
    const kpis = {
      total: itens.length,
      emAndamento: itens.filter(i => sm(i.status, "andamento")).length,
      tarefasPendentes: itens.filter(i => sm(i.status, "tarefas pendentes")).length,
      concluido: itens.filter(i => sm(i.status, "conclu")).length,
      atrasados: itens.filter(i => i.daysRemaining !== null && i.daysRemaining < 0 && !sm(i.status, "conclu")).length,
      bloqueados: itens.filter(i => i.blocked).length,
      porResponsavel: ["Erikson","Lucas","Rafael","Hamze","Vivahcare"].map(nome => ({
        nome, total: itens.filter(i => i.assigneeGroup === nome).length,
      })),
    };
    const pctConcluido = kpis.total > 0 ? Math.round((kpis.concluido / kpis.total) * 100) : 0;

    return res.status(200).json({
      sprint: sprintName, sprintStart, sprintEnd,
      geradoEm: new Date().toISOString(),
      kpis, pctConcluido, itens,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
