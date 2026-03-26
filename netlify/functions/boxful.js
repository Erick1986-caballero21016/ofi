const https = require("https");
const http = require("http");

exports.handler = async function (event) {
  const shipment = event.queryStringParameters?.shipment;
  if (!shipment) {
    return { statusCode: 400, body: JSON.stringify({ error: "Falta shipment" }) };
  }
  const url = `https://tracking.goboxful.com?shipment=${shipment}`;
  try {
    const html = await fetchUrl(url);
    const steps = parseTracking(html);
    const fechaEstimada = parseFechaEstimada(html);
    const paqueteria = parsePaqueteria(html);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ steps, fechaEstimada, paqueteria }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseFechaEstimada(html) {
  const patterns = [
    /[Ff]echa estimada de entrega[\s\S]{0,100}?(\d{1,2}\s+de\s+\w+[,\s]+\d{4})/i,
    /[Ff]echa estimada[\s\S]{0,100}?(\d{1,2}\s+de\s+\w+[,\s]+\d{4})/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parsePaqueteria(html) {
  const patterns = [
    />([A-Z][a-zA-Z\s]{2,20})<\/[^>]*>\s*<[^>]*>[^<]*[Ee]nvío a cargo/i,
    /[Ee]nvío a cargo de esta paqueter[^<]{0,30}<\/[^>]*>\s*(?:<[^>]*>){0,3}([A-Z][a-zA-Z\s]{2,25})<\//i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1].trim().length > 1) return m[1].trim();
  }
  return null;
}

function parseTracking(html) {
  const ALL_STATES = ["Creado", "Registrado", "Recolectado", "Ruta a destino", "Entregado"];
  const steps = [];

  // Intentar extraer pasos de timeline con fecha/hora
  const timelineRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = timelineRegex.exec(html)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<[^>]*>([^<]*(?:Creado|Registrado|Recolectado|Ruta a destino|Ruta|Entregado)[^<]*)<\/[^>]*>/i);
    if (!titleMatch) continue;
    const dateMatch = block.match(/(\d{1,2}\s+\w+\s+\d{4}\s*[·•]\s*\d{1,2}:\d{2}\s*(?:am|pm)?)/i)
      || block.match(/(\d{1,2}\s+\w+\s+\d{4}[^<]{0,20}\d{1,2}:\d{2}[^<]*)/i);
    const isPending = /[Pp]endiente/.test(block);
    const completedMatch = /(?:completed|done|active|success|checked)/i.test(block);
    steps.push({
      title: titleMatch[1].trim(),
      date: dateMatch ? dateMatch[1].trim() : (isPending ? "Pendiente" : "Completado"),
      done: !isPending && completedMatch,
    });
  }

  // Fallback con divs
  if (steps.length === 0) {
    const divRegex = /<div[^>]*class="[^"]*(?:step|track|status|event)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    while ((match = divRegex.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/>([^<]+(?:Creado|Registrado|Recolectado|Ruta|Entregado)[^<]*)</i);
      if (!titleMatch) continue;
      const dateMatch = block.match(/(\d{1,2}\s+\w+\s+\d{4}[^<]*\d{1,2}:\d{2}[^<]*)/i);
      const isPending = /[Pp]endiente/.test(block);
      steps.push({
        title: titleMatch[1].trim(),
        date: dateMatch ? dateMatch[1].trim() : (isPending ? "Pendiente" : "Completado"),
        done: !isPending,
      });
    }
  }

  // Fallback texto plano — busca cada estado en el HTML
  if (steps.length === 0) {
    ALL_STATES.forEach((name) => {
      const regex = new RegExp(name + "[\\s\\S]{0,300}", "i");
      const m = html.match(regex);
      if (m) {
        const dateM = m[0].match(/(\d{1,2}\s+\w{3,}\s+\d{4}[^<\n]*\d{1,2}:\d{2}[^<\n]*)/);
        const isPending = /[Pp]endiente/.test(m[0].substring(0, 60));
        steps.push({
          title: name,
          date: dateM ? dateM[1].trim() : (isPending ? "Pendiente" : "Completado"),
          done: !isPending,
        });
      }
    });
  }

  // GARANTIZAR siempre los 5 pasos en orden correcto
  const foundTitles = steps.map(s => s.title.toLowerCase());
  ALL_STATES.forEach(name => {
    const key = name.toLowerCase().split(' ')[0];
    if (!foundTitles.some(t => t.includes(key))) {
      steps.push({ title: name, date: "Pendiente", done: false });
    }
  });

  // Ordenar en el orden correcto
  steps.sort((a, b) => {
    const ai = ALL_STATES.findIndex(o => a.title.toLowerCase().includes(o.toLowerCase().split(' ')[0]));
    const bi = ALL_STATES.findIndex(o => b.title.toLowerCase().includes(o.toLowerCase().split(' ')[0]));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return steps;
}
