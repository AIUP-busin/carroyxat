// Vaqtinchalik diagnostika: Vercel serveridan OLX qanday javob beradi
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const tests = {
  api_ua: ["https://www.olx.uz/api/v1/offers/?limit=1&category_id=983&owner_type=private", { "User-Agent": UA, "Accept": "application/json" }],
  api_plain: ["https://www.olx.uz/api/v1/offers/?limit=1&category_id=983&owner_type=private", {}],
  html: ["https://www.olx.uz/transport/legkovye-avtomobili/chevrolet/", { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "ru-RU,ru;q=0.9" }],
  ipinfo: ["https://ipinfo.io/json", {}]
};
export default async function handler(req, res) {
  const out = { region: process.env.VERCEL_REGION || null };
  await Promise.all(Object.entries(tests).map(async ([k, [u, h]]) => {
    const t0 = Date.now();
    try {
      const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(15000) });
      const body = await r.text();
      out[k] = { status: r.status, ms: Date.now() - t0, server: r.headers.get("server"), cfray: r.headers.get("cf-ray"), len: body.length, head: body.slice(0, 160) };
    } catch (e) {
      out[k] = { error: String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e), ms: Date.now() - t0 };
    }
  }));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(out);
}
