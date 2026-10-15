// Telegram bot (webhook): /start menyusi, Chevrolet va Elektro bo'yicha e'lonlar soni, saytga o'tish tugmasi.
// Bir marta sozlash: https://carroyxat.vercel.app/api/telegram?setup=1 ni brauzerda oching.
// Token Vercel → Settings → Environment Variables → TELEGRAM_BOT_TOKEN da saqlanadi (kodda emas).
import crypto from "node:crypto";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SITE = (process.env.SITE_URL || "https://carroyxat.vercel.app").replace(/\/$/, "");
const LIST_LIMIT = 10;

const secret = () => crypto.createHash("sha256").update(String(TOKEN)).digest("hex").slice(0, 32);
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json().catch(() => ({ ok: false }));
}

async function getCars() {
  const r = await fetch(SITE + "/api/cars");
  if (!r.ok) throw new Error("api/cars " + r.status);
  return r.json();
}

function timeTashkent(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function menu(d) {
  const c = d.chev.length, e = d.ev.length;
  const text =
    `🚘 <b>Egasidan mashinalar</b> (OLX.uz)\n\n` +
    `🚗 Chevrolet: <b>${c} ta</b>\n` +
    `⚡ Elektromobil: <b>${e} ta</b>\n` +
    `Jami: <b>${c + e} ta</b>\n\n` +
    `Perekup, salon va kredit e'lonlari chiqarib tashlangan.\n` +
    `Yangilandi: ${timeTashkent(d.updated)} (Toshkent)`;
  const keyboard = [
    [{ text: `🚗 Chevrolet (${c})`, callback_data: "chev" }, { text: `⚡ Elektro (${e})`, callback_data: "ev" }],
    [{ text: "🌐 Saytni ochish", url: SITE }]
  ];
  return { text, keyboard };
}

function list(d, kind) {
  const rows = kind === "ev" ? d.ev : d.chev;
  const title = kind === "ev" ? "⚡ <b>Elektromobillar</b>" : "🚗 <b>Chevrolet</b>";
  // r = [code, model, year, km, color, cond, owners, price, city, seller, defects, flags, isNew]
  const lines = rows.slice(0, LIST_LIMIT).map((r, i) => {
    const km = r[3] == null ? "probeg ko'rsatilmagan" : Number(r[3]).toLocaleString("ru-RU").replace(/ /g, " ") + " km";
    const url = `https://www.olx.uz/d/obyavlenie/e-${r[0]}.html`;
    return `${i + 1}. <a href="${url}">${esc(r[1])}</a>${r[12] ? " 🆕" : ""}\n    ${r[2] || "?"} yil · ${esc(String(r[4]).toLowerCase())} · ${esc(r[7])} · ${km}`;
  });
  const text = `${title} — egasidan ${rows.length} ta e'lon\nEng yangi ${Math.min(LIST_LIMIT, rows.length)} tasi:\n\n${lines.join("\n\n") || "Hozircha e'lon yo'q."}`;
  const keyboard = [
    [{ text: "🌐 Hammasini saytda ko'rish", url: SITE + "/#elon" }],
    [{ text: "◀️ Orqaga", callback_data: "menu" }]
  ];
  return { text, keyboard };
}

async function show(chatId, view, editMessageId) {
  const body = {
    chat_id: chatId,
    text: view.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: view.keyboard }
  };
  if (editMessageId) {
    const r = await tg("editMessageText", { ...body, message_id: editMessageId });
    if (r.ok || /not modified/.test(r.description || "")) return;
  }
  await tg("sendMessage", body);
}

async function setup(req, res) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const hook = `https://${host}/api/telegram`;
  const results = {
    webhook: await tg("setWebhook", { url: hook, secret_token: secret(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
    commands: await tg("setMyCommands", { commands: [
      { command: "start", description: "Menyu: e'lonlar soni va sayt" },
      { command: "chevrolet", description: "Chevrolet e'lonlari" },
      { command: "elektro", description: "Elektromobil e'lonlari" }
    ] }),
    menuButton: await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Sayt", web_app: { url: SITE } } }),
    me: await tg("getMe", {})
  };
  const ok = results.webhook.ok;
  res.status(ok ? 200 : 500).json({
    ok,
    bot: results.me.result && results.me.result.username,
    webhook: hook,
    message: ok ? "Bot ulandi. Telegram'da botga /start yozing." : "Xato: tokenni tekshiring",
    details: { webhook: results.webhook.description, commands: results.commands.ok, menuButton: results.menuButton.ok }
  });
}

export default async function handler(req, res) {
  if (!TOKEN) return res.status(500).json({ ok: false, message: "Vercel'da TELEGRAM_BOT_TOKEN o'rnatilmagan" });
  if (req.method === "GET") {
    if (req.query && req.query.setup) return setup(req, res);
    return res.status(200).json({ ok: true, message: "Telegram bot ishlayapti. Sozlash uchun ?setup=1" });
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret()) return res.status(401).end();

  const u = req.body || {};
  try {
    if (u.callback_query) {
      const q = u.callback_query;
      await tg("answerCallbackQuery", { callback_query_id: q.id });
      const d = await getCars();
      const view = q.data === "menu" ? menu(d) : list(d, q.data === "ev" ? "ev" : "chev");
      await show(q.message.chat.id, view, q.message.message_id);
    } else if (u.message && typeof u.message.text === "string") {
      const cmd = u.message.text.trim().split(/[\s@]/)[0].toLowerCase();
      const chatId = u.message.chat.id;
      if (["/start", "/menu", "/stat"].includes(cmd)) await show(chatId, menu(await getCars()));
      else if (cmd === "/chevrolet") await show(chatId, list(await getCars(), "chev"));
      else if (cmd === "/elektro") await show(chatId, list(await getCars(), "ev"));
    }
  } catch (e) {
    console.error(e);
    const chatId = (u.message && u.message.chat.id) || (u.callback_query && u.callback_query.message.chat.id);
    if (chatId) await tg("sendMessage", { chat_id: chatId, text: "Hozir OLX'dan ma'lumot olib bo'lmadi, birozdan keyin qayta urinib ko'ring." });
  }
  res.status(200).json({ ok: true });
}
