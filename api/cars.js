// Sayt uchun API: /api/cars
// Natija Vercel CDN'da 1 soat keshlanadi (OLX soatiga ko'pi bilan 1 marta so'raladi).
import { collect, priceShort } from "../lib/olx.js";

export default async function handler(req, res) {
  const started = Date.now();
  try {
    const r = await collect();
    const now = Date.now();
    const row = c => [c.code, c.model, c.year, c.km, c.color, c.cond, c.owners, priceShort(c), c.city,
      c.seller, c.defects, c.flags, c.created && now - Date.parse(c.created) < 864e5 ? 1 : 0];

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
    return res.status(200).json({
      updated: r.updated,
      tookMs: Date.now() - started,
      seen: r.seen,
      removed: r.removed,
      chev: r.cars.filter(c => c.kind === "chev").map(row),
      ev: r.cars.filter(c => c.kind === "ev").map(row)
    });
  } catch (e) {
    res.setHeader("Cache-Control", "s-maxage=120");
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
}
