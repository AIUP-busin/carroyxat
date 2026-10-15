// Har soatda GitHub Actions ishga tushiradi.
// Yangi chiqqan (egasidan) e'lonlarni Telegram guruhiga yuboradi.
// Yuborilganlar ro'yxati data/sent.json da saqlanadi, shuning uchun bir e'lon ikki marta yuborilmaydi.
import fs from "node:fs";
import path from "node:path";
import { collect, priceTelegram, kmText } from "../lib/olx.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-5217197029";
const SITE = (process.env.SITE_URL || "https://carroyxat.vercel.app").replace(/\/$/, "");
const SAMPLE = process.env.SEND_SAMPLE === "true"; // qo'lda ishga tushirishda namunaviy xabar yuborish
const STATE = path.join(process.cwd(), "data", "sent.json");
const MAX_AGE_MS = 3 * 864e5;   // 3 kundan eski e'lonlar "yangi" hisoblanmaydi
const KEEP = 3000;              // sent.json da saqlanadigan ID'lar soni

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN topilmadi. GitHub → Settings → Secrets and variables → Actions ga qo'shing.");
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function send(text, buttons) {
  const body = { chat_id: CHAT_ID, text, disable_web_page_preview: false };
  if (buttons) body.reply_markup = { inline_keyboard: buttons };
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (j.ok) return true;
    if (j.parameters && j.parameters.retry_after) { await sleep((j.parameters.retry_after + 1) * 1000); continue; }
    console.error("Telegram xatosi:", r.status, j.description || "");
    return false;
  }
  return false;
}

export const buttons = c => [[
  { text: "🔗 OLX'da ochish", url: c.url },
  { text: "🌐 Saytda ko'rish", url: SITE + "/#elon" }
]];

export function message(c) {
  return [
    c.kind === "ev" ? "⚡ Elektromobil" : "🚗 Chevrolet",
    c.url,
    c.model,
    (c.year || "?") + " yil",
    "rangi " + String(c.color).toLowerCase(),
    "narxi " + priceTelegram(c),
    "yurgan masofasi " + kmText(c.km)
  ].join("\n");
}

async function main() {
  const firstRun = !fs.existsSync(STATE);
  const sent = firstRun ? [] : JSON.parse(fs.readFileSync(STATE, "utf8"));
  const known = new Set(sent);

  const r = await collect();
  console.log(`OLX: ${r.seen.chev} Chevrolet, ${r.seen.ev} elektro ko'rildi; egasidan ${r.cars.length} ta`);

  const now = Date.now();
  const fresh = r.cars
    .filter(c => !known.has(c.id))
    .filter(c => !c.created || now - Date.parse(c.created) < MAX_AGE_MS)
    .sort((a, b) => Date.parse(a.created || 0) - Date.parse(b.created || 0)); // eskisidan yangisiga

  const nChev = r.cars.filter(c => c.kind === "chev").length;
  const nEv = r.cars.filter(c => c.kind === "ev").length;
  const counts = `🚗 Chevrolet: ${nChev} ta\n⚡ Elektromobil: ${nEv} ta\nJami: ${nChev + nEv} ta`;
  const siteBtn = [[{ text: "🌐 Saytni ochish", url: SITE }]];

  let delivered = 0;
  if (SAMPLE) {
    // Namuna: har turdan eng yangi bittadan e'lon (ro'yxatga yozilmaydi)
    await send(`🧪 Namunaviy xabar. Hozir OLX'da egasidan:\n${counts}`, siteBtn);
    for (const kind of ["chev", "ev"]) {
      const c = r.cars.find(x => x.kind === kind);
      if (c) { await send(message(c), buttons(c)); await sleep(1500); }
    }
  }
  if (firstRun) {
    // Birinchi ishga tushishda guruhni 80 ta xabar bilan to'ldirmaymiz: hozirgilarni "ko'rilgan" deb belgilaymiz
    await send(`✅ Kuzatuv yoqildi. Hozir OLX'da egasidan:\n${counts}\n\nEndi har soatda faqat yangi chiqqan e'lonlar shu yerga yuboriladi.`, siteBtn);
    r.cars.forEach(c => known.add(c.id));
  } else {
    for (const c of fresh) {
      if (await send(message(c), buttons(c))) { known.add(c.id); delivered++; }
      await sleep(3500); // Telegram guruh limiti: daqiqasiga 20 ta xabar
    }
  }

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify([...known].slice(-KEEP)));
  console.log(firstRun ? "Birinchi ishga tushish: ro'yxat saqlandi." : `Yuborildi: ${delivered} / ${fresh.length}`);
}

if (process.argv[1] && process.argv[1].endsWith("notify.js")) {
  main().catch(e => { console.error(e); process.exit(1); });
}
