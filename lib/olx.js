// OLX.uz dan egasi sotayotgan Chevrolet va elektromobil e'lonlarini yig'adi.
// Sayt (api/cars.js) ham, Telegram xabarnomasi (scripts/notify.js) ham shu moduldan foydalanadi.

const BASE = "https://www.olx.uz/api/v1/offers/";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "ru-RU,ru;q=0.9,uz;q=0.8",
  "Referer": "https://www.olx.uz/transport/legkovye-avtomobili/"
};

const SOURCES = {
  chev: "category_id=983&owner_type=private&sort_by=created_at:desc",
  ev: "category_id=108&owner_type=private&filter_enum_fuel_type[0]=546&sort_by=created_at:desc"
};
const PAGES = 2; // 2 x 50 e'lon har bir turdan

const BAD_WORDS = /kredit|кредит|nasiya|насия|рассроч|rassroch|avtosalon|автосалон|\bsalon|салон|выкуп|vikup|vыкуп|perekup|перекуп|комисс|komis|\bofis|офис|в наличии|katalog|lizing|лизинг/i;
const DEFECT = /[^.!,;|]{0,40}(kras|крас|покрас|pokras|zamen|замен|ремонт|remont|удар|udar|авар|avar|dtp|дтп|urilgan|урил|ishi bor|ishi yo|ишлари|без влож|toza|тоза|чист|kamchilig|камчил|скол|царап|сварк|chirish|ржав|rjav|petno|пятн)[^.!,;|]{0,40}/gi;
const BIZ_NAME = /admin|avto|auto|motors|rent|salon|trade|group|company|ooo|ооо|llc|установка|сервис|servis|shop|market/i;

export const COLORS = { "Белый": "Oq", "Черный": "Qora", "Серый": "Kulrang", "Серебристый": "Kumush", "Синий": "Ko'k", "Голубой": "Havorang", "Красный": "Qizil", "Зеленый": "Yashil", "Бежевый": "Bej", "Коричневый": "Jigarrang", "Желтый": "Sariq", "Асфальт": "Asfalt", "Бронзовый": "Bronza", "Вишнёвый": "Olcha", "Мокрый асфальт": "Asfalt", "Золотистый": "Tilla", "Оранжевый": "To'q sariq", "Фиолетовый": "Binafsha", "Хамелеон": "Xameleon" };
const COND = { "Отличное": "A'lo", "Хорошее": "Yaxshi", "Среднее": "O'rtacha", "Требует ремонта": "Ta'mir kerak", "Новое": "Yangi" };
const BRANDS = ["BYD", "Chery", "iCAR", "Geely", "Changan", "Honda", "Hyundai", "Kia", "Nissan", "Tesla", "Leapmotor", "Zeekr", "Volkswagen", "VW", "Chevrolet", "Toyota", "BAIC", "Wuling", "Dongfeng", "Neta", "MG", "GAC", "Aion", "Voyah", "Xpeng", "Haval", "JAC", "Jetour", "Li Auto", "Lixiang", "Avatr", "Deepal", "Hongqi", "Exeed", "Mercedes", "BMW", "Audi", "Skywell", "Hycan", "Weltmeister", "Ora", "Tank"];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch (e) { /* qayta urinish */ }
    await sleep(400);
  }
  return null;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

const param = (o, key) => {
  const p = (o.params || []).find(p => p.key === key);
  if (!p) return null;
  const v = p.value;
  return v && typeof v === "object" ? v : { label: v };
};

const strip = html => (html || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const group = (n, sep) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);

function modelName(o, kind) {
  const label = ((param(o, "model") || {}).label || "").trim();
  const title = (o.title || "").trim();
  const generic = !label || /^(Другая|Прочее|Другие)$/i.test(label);
  if (kind === "chev") {
    if (generic) return "Chevrolet (" + title.slice(0, 28) + ")";
    return label === "Lacetti / Gentra" ? "Gentra" : label;
  }
  const brand = BRANDS.find(b => new RegExp("\\b" + b + "\\b", "i").test(title + " " + label));
  if (generic) return title.slice(0, 40);
  if (brand && !label.toLowerCase().includes(brand.toLowerCase())) return brand + " " + label;
  return label;
}

async function fetchList(qs) {
  const urls = Array.from({ length: PAGES }, (_, p) => `${BASE}?offset=${p * 50}&limit=50&${qs}`);
  const pages = await Promise.all(urls.map(u => getJSON(u)));
  const seen = new Set(), list = [];
  let ok = false;
  for (const pg of pages) {
    if (!pg || !pg.data) continue;
    ok = true;
    for (const o of pg.data) if (!seen.has(o.id)) { seen.add(o.id); list.push(o); }
  }
  return { ok, list };
}

// Asosiy funksiya: egasidan e'lonlarni qaytaradi
export async function collect() {
  const [chev, ev] = await Promise.all([fetchList(SOURCES.chev), fetchList(SOURCES.ev)]);
  if (!chev.ok && !ev.ok) throw new Error("OLX javob bermadi");
  const evList = ev.list.filter(o => ((param(o, "fuel_type") || {}).label || "") === "Электро");

  // Sotuvchining profilidagi boshqa mashina e'lonlarini sanash (perekupni ajratish)
  const userIds = [...new Set([...chev.list, ...evList].map(o => o.user && o.user.id).filter(Boolean))];
  const carCount = {};
  await pool(userIds, 10, async id => {
    const j = await getJSON(`${BASE}?user_id=${id}&limit=50`, 1);
    carCount[id] = j && j.data ? j.data.filter(x => (x.params || []).some(p => p.key === "motor_year")).length : null;
  });

  const now = Date.now();
  const removed = { perekup: 0, words: 0, business: 0 };
  const build = (list, kind) => list.flatMap(o => {
    const text = (o.title || "") + ". " + strip(o.description);
    if (o.business) { removed.business++; return []; }
    const cc = carCount[o.user && o.user.id];
    if (cc != null && cc > 1) { removed.perekup++; return []; }
    if (BAD_WORDS.test(text)) { removed.words++; return []; }

    const year = parseInt((param(o, "motor_year") || {}).label) || null;
    const kmRaw = ((param(o, "motor_mileage") || {}).label || "").replace(/\D/g, "");
    const km = kmRaw === "" ? null : +kmRaw;
    const ownersRaw = ((param(o, "owners") || {}).label || "").trim();
    const colorRu = ((param(o, "color") || {}).label || "").trim();
    const condRu = ((param(o, "condition") || {}).label || "").trim();
    const name = (o.user && o.user.name) || "—";
    const userCreated = o.user && o.user.created ? Date.parse(o.user.created) : null;
    const pr = param(o, "price") || {};
    const isUzs = pr.currency === "UZS" || pr.currency === "UZ";

    const flags = [];
    if (km != null && km < 1000 && year && year < 2024) flags.push("Probeg real emas");
    if (BIZ_NAME.test(name)) flags.push("Profil nomi biznesga o'xshaydi");
    if (userCreated && now - userCreated < 3 * 864e5) flags.push("Profil yangi ochilgan");
    if (cc == null) flags.push("Profil tekshirilmadi");
    if (kind === "ev" && /DM-?i|PHEV|гибрид|gibrid/i.test(text)) flags.push("Gibrid bo'lishi mumkin");

    const defects = [...text.matchAll(DEFECT)].map(m => m[0].trim()).slice(0, 2).join(" / ");
    return [{
      id: o.id,
      code: ((o.url || "").match(/-(ID\w+)\.html/) || [])[1] || String(o.id),
      url: (o.url || "").split("?")[0],
      kind,
      model: modelName(o, kind),
      year, km,
      color: COLORS[colorRu] || colorRu || "—",
      cond: COND[condRu] || condRu || "—",
      owners: ownersRaw ? (parseInt(ownersRaw) || ownersRaw) : "—",
      price: pr.value ?? null,
      currency: isUzs ? "UZS" : "USD",
      city: (o.location && o.location.city && o.location.city.name) || "—",
      seller: name.slice(0, 30),
      defects: defects ? defects.slice(0, 120) : "—",
      flags: flags.join("; "),
      created: o.created_time || null
    }];
  });

  return {
    updated: new Date().toISOString(),
    seen: { chev: chev.list.length, ev: evList.length },
    removed,
    cars: [...build(chev.list, "chev"), ...build(evList, "ev")]
  };
}

// Saytdagi jadval uchun narx: "$10 500" yoki "150 mln so'm"
export function priceShort(c) {
  if (c.price == null) return "—";
  if (c.currency === "UZS") {
    const m = c.price / 1e6;
    return (m >= 100 ? Math.round(m) : Math.round(m * 10) / 10) + " mln so'm";
  }
  return "$" + group(c.price, " ");
}

// Telegram xabari uchun narx: "10.500$" yoki "150.000.000 so'm"
export function priceTelegram(c) {
  if (c.price == null) return "kelishiladi";
  return c.currency === "UZS" ? group(c.price, ".") + " so'm" : group(c.price, ".") + "$";
}

export const kmText = km => km == null ? "ko'rsatilmagan" : group(km, " ");
