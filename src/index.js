import { fetchOvh } from './ovh.js';
import { fetchHetzner } from './hetzner.js';
import { fetchScaleway } from './scaleway.js';
import { sendMail, esc, confirmMail, confirmText, alertMail, alertText, testMail, testText, manageMail, manageText } from './mail.js';

// Fournisseurs surveilles. `needs` = champ de config requis (sinon le fournisseur est ignore).
const PROVIDERS = [
  { id: 'ovh', name: 'OVH VPS', order: 'https://www.ovhcloud.com/fr/vps/', run: () => fetchOvh() },
  { id: 'hetzner', name: 'Hetzner Cloud', order: 'https://console.hetzner.cloud/', needs: 'hcloud', run: (c) => fetchHetzner(c.hcloud) },
  { id: 'scaleway', name: 'Scaleway', order: 'https://console.scaleway.com/instance/servers/create', needs: 'scaleway', run: (c) => fetchScaleway(c.scaleway) },
];
const ORDER = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.order]));
const PNAME = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name]));
const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', ...h } });
const html = (title, msg, ok = true) => new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Radar serveurs</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&display=swap"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#05060f"><link rel="stylesheet" href="/site.css?v=9"></head><body><main class="wrap msgpage"><div class="msgcard"><img class="brand center" src="/logo.svg" width="56" height="56" alt="Logo Radar serveurs"><div class="ic${ok ? '' : ' ko'}">${ok ? '✓' : '!'}</div><h1>${esc(title)}</h1><p>${esc(msg)}</p><a class="cta" href="/">Retour au radar</a></div><footer class="credit">Fait avec <span class="hrt">♥</span> par <b class="who">Wallace</b> · <a href="/conditions">Conditions d'utilisation</a></footer></main></body></html>`, { status: ok ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8' } });

// ---------- config (KV : réglages et accès admin, qui changent rarement) ----------
const rawCfg = async (env) => (await env.KV.get('config', 'json')) || {};
async function getCfg(env) {
  const c = await rawCfg(env);
  return { brevoKey: c.brevoKey || env.BREVO_API_KEY, mailFrom: c.mailFrom || (/exemple\.com/.test(env.MAIL_FROM || '') ? '' : env.MAIL_FROM), hcloud: c.hcloud || env.HCLOUD_TOKEN, scaleway: c.scaleway || env.SCW_SECRET_KEY, replyTo: c.replyTo || '', mailName: c.mailName || '', discord: c.discord || '', publicUrl: c.publicUrl || (/TON-SOUS/.test(env.PUBLIC_URL || '') ? '' : env.PUBLIC_URL || ''), paused: !!c.paused };
}
const mask = (v) => (v ? '••••' + v.slice(-4) : '');

// ---------- base D1 : inscrits, état du scan, journal, sessions, jetons ----------
// Le KV gratuit n'autorise que 1 000 écritures par jour : tout ce qui change souvent vit dans D1 (100 000 par jour).
const SCHEMA_V = '1';
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS subs (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, confirmed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sub_offers (sub_id TEXT NOT NULL, offer_key TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sub_id, offer_key))',
  'CREATE INDEX IF NOT EXISTS idx_so_offer ON sub_offers(offer_key)',
  'CREATE INDEX IF NOT EXISTS idx_so_notified ON sub_offers(offer_key) WHERE notified = 1',
  'CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, l TEXT NOT NULL, m TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS tmp (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_tmp_exp ON tmp(exp)',
];
let ready = null;
function db(env) {
  ready ||= init(env).catch((e) => { ready = null; throw e; });
  return ready.then(() => env.DB);
}
async function init(env) {
  const st = {};
  try { ((await env.DB.prepare("SELECT k, v FROM state WHERE k IN ('schema','migrated')").all()).results || []).forEach((r) => (st[r.k] = r.v)); } catch {}
  if (st.schema !== SCHEMA_V) {
    await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
    await env.DB.prepare("INSERT INTO state(k, v) VALUES('schema', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(SCHEMA_V).run();
  }
  if (!st.migrated) await migrateFromKv(env);
}
// Reprise automatique des données de l'ancienne version (tout était dans le KV) : une seule fois.
async function migrateFromKv(env) {
  const d = env.DB, g = (k) => env.KV.get(k, 'json').catch(() => null);
  const [subs, offers, status, avail, logs] = await Promise.all(['subs', 'offers', 'status', 'avail', 'logs'].map(g));
  const now = Date.now();
  if (Array.isArray(subs) && subs.length) {
    const list = subs.filter((s) => s && s.id && s.email).map((s) => ({ id: s.id, email: String(s.email).toLowerCase(), c: s.confirmed ? 1 : 0 }));
    for (let i = 0; i < list.length; i += 500)
      await d.prepare("INSERT OR IGNORE INTO subs(id, email, confirmed, created) SELECT json_extract(value,'$.id'), json_extract(value,'$.email'), json_extract(value,'$.c'), ? FROM json_each(?)").bind(now, JSON.stringify(list.slice(i, i + 500))).run();
    const rows = subs.flatMap((s) => (s.offers || []).map((k) => ({ s: s.id, k, n: s.notified?.[k] ? 1 : 0 })));
    for (let i = 0; i < rows.length; i += 500)
      await d.prepare("INSERT OR IGNORE INTO sub_offers(sub_id, offer_key, notified) SELECT json_extract(value,'$.s'), json_extract(value,'$.k'), json_extract(value,'$.n') FROM json_each(?)").bind(JSON.stringify(rows.slice(i, i + 500))).run();
  }
  const lastRun = status?.lastRun; if (status) delete status.lastRun;
  const put = (k, v) => (v == null ? null : d.prepare('INSERT OR IGNORE INTO state(k, v) VALUES(?, ?)').bind(k, JSON.stringify(v)));
  const stmts = [put('offers', offers), put('status', status), put('avail', avail), put('lastRun', lastRun)].filter(Boolean);
  if (Array.isArray(logs) && logs.length) stmts.push(d.prepare("INSERT INTO logs(t, l, m) SELECT json_extract(value,'$.t'), json_extract(value,'$.l'), json_extract(value,'$.m') FROM json_each(?)").bind(JSON.stringify(logs.slice(-200))));
  stmts.push(d.prepare("INSERT OR REPLACE INTO state(k, v) VALUES('migrated', '1')"));
  await d.batch(stmts);
}

// état clé/valeur (JSON). L'écriture n'a lieu que si la valeur a changé : zéro écriture inutile.
async function sget(env, k, def = null) {
  const r = await (await db(env)).prepare('SELECT v FROM state WHERE k = ?').bind(k).first();
  return r ? JSON.parse(r.v) : def;
}
async function sput(env, k, val) {
  await (await db(env)).prepare('INSERT INTO state(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE state.v != excluded.v').bind(k, JSON.stringify(val)).run();
}
const getOffers = (env) => sget(env, 'offers', []);
async function getStatus(env) {
  const [s, lastRun] = await Promise.all([sget(env, 'status', {}), sget(env, 'lastRun', null)]);
  return lastRun ? { ...s, lastRun } : s;
}

// journal : les lignes d'un même passage sont écrites en une seule requête
async function flushLogs(env, list) {
  if (!list.length) return;
  try {
    await (await db(env)).prepare("INSERT INTO logs(t, l, m) SELECT json_extract(value,'$.t'), json_extract(value,'$.l'), json_extract(value,'$.m') FROM json_each(?)").bind(JSON.stringify(list)).run();
  } catch {}
}
const log = (env, level, msg) => flushLogs(env, [{ t: Date.now(), l: level, m: String(msg).slice(0, 300) }]);

// données temporaires avec expiration : sessions admin, liens de gestion, compteurs anti-abus
async function tget(env, k) {
  const r = await (await db(env)).prepare('SELECT v FROM tmp WHERE k = ? AND exp > ?').bind(k, Date.now()).first();
  return r ? r.v : null;
}
async function tput(env, k, v, ttl) {
  await (await db(env)).prepare('INSERT INTO tmp(k, v, exp) VALUES(?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp').bind(k, v, Date.now() + ttl * 1000).run();
}
const tdel = async (env, k) => { await (await db(env)).prepare('DELETE FROM tmp WHERE k = ?').bind(k).run(); };
// compteur atomique : vrai si la limite est dépassée
async function limited(env, key, max, ttl) {
  const t = Date.now();
  const r = await (await db(env)).prepare("INSERT INTO tmp(k, v, exp) VALUES(?, '1', ?) ON CONFLICT(k) DO UPDATE SET v = CASE WHEN tmp.exp <= ? THEN '1' ELSE CAST(tmp.v AS INTEGER) + 1 END, exp = CASE WHEN tmp.exp <= ? THEN excluded.exp ELSE tmp.exp END RETURNING v").bind(key, t + ttl * 1000, t, t).first();
  return Number(r.v) > max;
}

// inscrits : une ligne par personne, une ligne par offre suivie (chaque changement est atomique)
const subRow = async (env, col, val) => (await db(env)).prepare(`SELECT id, email, confirmed FROM subs WHERE ${col} = ?`).bind(val).first();
const subByEmail = (env, email) => subRow(env, 'email', email);
const subById = (env, id) => subRow(env, 'id', id);
const countSubs = async (env) => (await (await db(env)).prepare('SELECT COUNT(*) AS n FROM subs').first()).n;
const offersOf = async (env, id) => ((await (await db(env)).prepare('SELECT offer_key FROM sub_offers WHERE sub_id = ? ORDER BY offer_key').bind(id).all()).results || []).map((r) => r.offer_key);
async function setOffers(env, id, keys, reset) {
  const d = await db(env), js = JSON.stringify(keys);
  // reset = nouvelle demande : tout repart de zéro. Sinon on garde l'historique des offres conservées (pas de mail en double).
  await d.batch([
    reset ? d.prepare('DELETE FROM sub_offers WHERE sub_id = ?').bind(id) : d.prepare('DELETE FROM sub_offers WHERE sub_id = ? AND offer_key NOT IN (SELECT value FROM json_each(?))').bind(id, js),
    d.prepare('INSERT OR IGNORE INTO sub_offers(sub_id, offer_key, notified) SELECT ?, value, 0 FROM json_each(?)').bind(id, js),
  ]);
}
async function delSub(env, id) {
  const d = await db(env);
  await d.batch([d.prepare('DELETE FROM sub_offers WHERE sub_id = ?').bind(id), d.prepare('DELETE FROM subs WHERE id = ?').bind(id)]);
}
// ménage : données expirées, vieux journaux, inscriptions jamais confirmées (7 jours)
async function cleanup(env) {
  const d = await db(env), t = Date.now();
  await d.prepare('DELETE FROM tmp WHERE exp < ?').bind(t).run();
  await d.prepare('DELETE FROM logs WHERE id <= (SELECT MAX(id) FROM logs) - 200').run();
  if (new Date(t).getUTCMinutes() < 5) {
    const cut = t - 7 * 86400000;
    await d.batch([
      d.prepare('DELETE FROM sub_offers WHERE sub_id IN (SELECT id FROM subs WHERE confirmed = 0 AND created < ?)').bind(cut),
      d.prepare('DELETE FROM subs WHERE confirmed = 0 AND created < ?').bind(cut),
    ]);
  }
}

// ---------- auth ----------
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256));
}
async function newSession(env) {
  const sid = crypto.randomUUID() + crypto.randomUUID();
  await tput(env, 'sess:' + sid, '1', 7 * 86400);
  return json({ ok: true }, 200, { 'set-cookie': `sid=${sid}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 86400}` });
}
const sidOf = (r) => (r.headers.get('cookie') || '').match(/(?:^|; )sid=([\w-]+)/)?.[1];
const authed = async (r, env) => { const s = sidOf(r); return !!s && !!(await tget(env, 'sess:' + s)); };

// ---------- verification ----------
async function runCheck(env, manual = false) {
  const logs = [];
  const L = (l, m) => logs.push({ t: Date.now(), l, m: String(m).slice(0, 300) });
  try { return await scan(env, manual, L); }
  finally { await flushLogs(env, logs); }
}
async function scan(env, manual, L) {
  const cfg = await getCfg(env);
  const old = await getOffers(env);
  const st = {};
  const results = await Promise.allSettled(PROVIDERS.map((p) => (p.needs && !cfg[p.needs] ? Promise.reject(new Error('NOCFG')) : p.run(cfg))));
  const failed = new Set(), offers = [];
  PROVIDERS.forEach((p, i) => {
    const res = results[i];
    if (res.status === 'fulfilled') {
      offers.push(...res.value);
      st[p.id] = { ok: true, count: res.value.length, available: res.value.filter((o) => o.locations.length).length };
    } else {
      failed.add(p.id);
      if (res.reason?.message === 'NOCFG') { st[p.id] = { ok: false, skipped: true, error: 'Non configuré' }; return; }
      st[p.id] = { ok: false, error: res.reason?.message || 'erreur' };
      offers.push(...old.filter((o) => o.provider === p.id));
    }
  });
  await sput(env, 'offers', offers);
  const prev = await sget(env, 'status', {});
  for (const { id: n } of PROVIDERS) {
    const a = prev[n], b = st[n];
    if (!b || b.skipped) continue;
    if (!b.ok) { if (a?.error !== b.error) L('error', `${n.toUpperCase()} : ${b.error}`); }
    else if (!a?.ok || a.available !== b.available || manual) L(b.available ? 'ok' : 'info', `${n.toUpperCase()} : ${b.count} offres, ${b.available} dispo`);
  }
  const lastRun = Date.now();
  await sput(env, 'status', st);
  await sput(env, 'lastRun', lastRun);
  const out = () => ({ ...st, lastRun });
  if (cfg.paused) return out();

  const byKey = Object.fromEntries(offers.map((o) => [o.key, o]));
  // Discord : alerte globale sur toute offre qui passe en dispo
  if (cfg.discord) {
    const pa = await sget(env, 'avail', {});
    const now = {}, fresh = [];
    for (const o of offers) {
      now[o.key] = o.locations.length > 0;
      if (now[o.key] && !pa[o.key] && !failed.has(o.provider)) fresh.push(o);
    }
    for (const k of Object.keys(pa)) if (failed.has(byKey[k]?.provider)) now[k] = pa[k];
    if (fresh.length) {
      const content = '🚀 **Serveur dispo !**\n' + fresh.map((o) => `• **${o.label}**${o.price ? ` (${o.price} €/mois)` : ''} : ${o.locations.join(', ')}\n${ORDER[o.provider]}`).join('\n');
      await fetch(cfg.discord, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900) }) }).catch(() => {});
      L('ok', `Discord : ${fresh.length} offre(s) dispo signalée(s)`);
    }
    await sput(env, 'avail', now);
  }

  // Mails : tout se décide en SQL, seules les lignes concernées sont lues ou modifiées
  const d = await db(env);
  const okOffers = offers.filter((o) => !failed.has(o.provider));
  const availKeys = okOffers.filter((o) => o.locations.length).map((o) => o.key);
  const downKeys = okOffers.filter((o) => !o.locations.length).map((o) => o.key);
  // offre repassée indispo : l'alerte se réarme
  if (downKeys.length) await d.prepare('UPDATE sub_offers SET notified = 0 WHERE notified = 1 AND offer_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(downKeys)).run();
  if (!availKeys.length) return out();
  const rows = ((await d.prepare('SELECT s.id AS id, s.email AS email, o.offer_key AS k FROM sub_offers o JOIN subs s ON s.id = o.sub_id WHERE s.confirmed = 1 AND o.notified = 0 AND o.offer_key IN (SELECT value FROM json_each(?)) ORDER BY s.id').bind(JSON.stringify(availKeys)).all()).results) || [];
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.id)) groups.set(r.id, { email: r.email, keys: [] }); groups.get(r.id).keys.push(r.k); }

  const sent = [];
  const flush = async () => {
    if (!sent.length) return;
    await d.prepare('UPDATE sub_offers SET notified = 1 WHERE (sub_id, offer_key) IN (SELECT json_extract(value,\'$.s\'), json_extract(value,\'$.k\') FROM json_each(?))').bind(JSON.stringify(sent.splice(0))).run();
  };
  let errs = 0;
  try {
    for (const [id, g] of groups) {
      const hits = g.keys.map((k) => byKey[k]).filter(Boolean).map((o) => ({ ...o, order: ORDER[o.provider], providerName: PNAME[o.provider] }));
      if (!hits.length) continue;
      const unsubUrl = `${cfg.publicUrl}/unsubscribe/${id}`;
      try {
        await sendMail(cfg, { to: g.email, subject: `🚀 Serveur dispo : ${hits.map((h) => h.label.split(' - ')[0]).join(', ')}`, html: alertMail({ hits, unsubUrl, publicUrl: cfg.publicUrl }), text: alertText({ hits, unsubUrl, publicUrl: cfg.publicUrl }) });
        hits.forEach((h) => sent.push({ s: id, k: h.key }));
        L('ok', `Alerte envoyée à ${g.email} (${hits.length} offre(s))`);
        if (sent.length >= 25) await flush();
      } catch (e) {
        errs++;
        if (errs === 1) { st.mailError = e.message; if (e.message !== prev.mailError) L('error', `Mail à ${g.email} : ${e.message}`); }
        if (errs >= 3) { L('warn', 'Envoi interrompu après 3 échecs : nouvelle tentative au prochain scan'); break; }
      }
    }
  } finally { await flush(); }
  // les offres non marquées (échec d'envoi) seront retentées au prochain passage
  if (st.mailError) await sput(env, 'status', st);
  return out();
}

// ---------- public ----------
async function subscribe(request, env, cfg) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (await limited(env, 'rl:sub:' + ip, 8, 3600)) return json({ error: 'Trop de tentatives, réessaie plus tard' }, 429);
  let b; try { b = await request.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: 'Email invalide' }, 400);
  const offersList = await getOffers(env);
  const known = new Set(offersList.map((o) => o.key));
  const labelOf = Object.fromEntries(offersList.map((o) => [o.key, o.label.split(' - ')[0]]));
  const wanted = [...new Set(b.offers || [])].filter((k) => known.has(k)).slice(0, 150);
  if (!wanted.length) return json({ error: 'Choisis au moins une offre' }, 400);
  const existing = await subByEmail(env, email);
  // Déjà inscrit et confirmé : on n'écrase rien, on envoie un lien pour modifier (évite qu'un tiers change l'alerte d'autrui)
  if (existing?.confirmed) {
    try { await sendManage(env, cfg, existing); } catch (e) { return json({ error: "Envoi du mail impossible (l'admin doit configurer Brevo)" }, 502); }
    return json({ ok: true, existing: true });
  }
  if (!existing && (await countSubs(env)) >= 2000) return json({ error: 'Complet pour le moment' }, 503);
  const d = await db(env);
  // on enregistre d'abord (l'identifiant du lien de confirmation doit exister), puis on envoie le mail
  const { id } = await d.prepare('INSERT INTO subs(id, email, confirmed, created) VALUES(?, ?, 0, ?) ON CONFLICT(email) DO UPDATE SET created = excluded.created RETURNING id').bind(crypto.randomUUID(), email, Date.now()).first();
  await setOffers(env, id, wanted, true);
  const names = wanted.map((k) => labelOf[k] || k), url = `${cfg.publicUrl}/confirm/${id}`;
  try {
    await sendMail(cfg, { to: email, subject: '✅ Confirme ton alerte serveur', html: confirmMail({ url, names, publicUrl: cfg.publicUrl }), text: confirmText({ url, names, publicUrl: cfg.publicUrl }) });
  } catch (e) {
    if (!existing) await delSub(env, id);
    return json({ error: "Envoi du mail impossible (l'admin doit configurer Brevo)" }, 502);
  }
  await log(env, 'info', `Inscription en attente : ${email}`);
  return json({ ok: true });
}

// ---------- gestion de son alerte (lien magique par mail, sans mot de passe) ----------
async function sendManage(env, cfg, sub) {
  if (await limited(env, 'rl:mge:' + sub.email, 3, 3600)) return;
  const token = crypto.randomUUID() + crypto.randomUUID();
  await tput(env, 'mg:' + token, sub.id, 3600);
  const url = `${cfg.publicUrl}/manage#t=${token}`;
  await sendMail(cfg, { to: sub.email, subject: '🔧 Modifier mon alerte serveur', html: manageMail({ url, count: (await offersOf(env, sub.id)).length, publicUrl: cfg.publicUrl }), text: manageText({ url, publicUrl: cfg.publicUrl }) });
  await log(env, 'info', `Lien de gestion envoyé à ${sub.email}`);
}
async function manageSub(request, env) {
  const t = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!/^[0-9a-f-]{72}$/.test(t)) return null;
  const id = await tget(env, 'mg:' + t);
  if (!id) return null;
  const sub = await subById(env, id);
  return sub && sub.confirmed ? { sub, t } : null;
}
async function manage(request, env, cfg, path, ctx) {
  if (path === '/request' && request.method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    if (await limited(env, 'rl:mg:' + ip, 10, 3600)) return json({ error: 'Trop de tentatives, réessaie plus tard' }, 429);
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200) {
      // Réponse identique que l'adresse existe ou non (pas de fuite sur qui est inscrit)
      ctx.waitUntil((async () => {
        const sub = await subByEmail(env, email);
        if (sub?.confirmed) await sendManage(env, cfg, sub).catch((e) => log(env, 'error', `Lien de gestion à ${email} : ${e.message}`));
      })());
    }
    return json({ ok: true });
  }
  const s = await manageSub(request, env);
  if (!s) return json({ error: 'Lien expiré ou invalide : redemande-en un.' }, 401);
  if (path === '/me' && request.method === 'GET') return json({ email: s.sub.email, offers: await offersOf(env, s.sub.id) });
  if (path === '/save' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const known = new Set((await getOffers(env)).map((o) => o.key));
    const wanted = [...new Set(b.offers || [])].filter((k) => known.has(k)).slice(0, 150);
    if (!wanted.length) return json({ error: 'Choisis au moins une offre (ou supprime ton alerte)' }, 400);
    await setOffers(env, s.sub.id, wanted, false);
    await log(env, 'info', `Alerte modifiée par ${s.sub.email} (${wanted.length} offre(s))`);
    return json({ ok: true, count: wanted.length });
  }
  if (path === '/delete' && request.method === 'POST') {
    await delSub(env, s.sub.id);
    await tdel(env, 'mg:' + s.t);
    await log(env, 'info', `Alerte supprimée par ${s.sub.email}`);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- admin ----------
async function admin(request, env, path) {
  // le mot de passe admin vient de wrangler.toml ([vars] ADMIN_PASSWORD)
  const pw = String(env.ADMIN_PASSWORD || '');
  if (path === '/state') { const a = await authed(request, env); return json({ setup: true, configured: !!pw, authed: a, ...(a ? { weak: pw === 'CHANGE_MOI' || pw.length < 10 } : {}) }); }
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (path === '/login' && request.method === 'POST') {
    if (!pw) return json({ error: 'ADMIN_PASSWORD absent de wrangler.toml' }, 400);
    if (await limited(env, 'rl:login:' + ip, 6, 900)) return json({ error: 'Trop d\'essais, attends 15 min' }, 429);
    const salt = 'admin-login';
    if ((await hashPw(String(body.password || ''), salt)) !== (await hashPw(pw, salt))) { await log(env, 'warn', `Connexion admin refusée (${ip})`); return json({ error: 'Mot de passe incorrect' }, 401); }
    await log(env, 'info', 'Connexion admin');
    return newSession(env);
  }
  if (!(await authed(request, env))) return json({ error: 'Non connecté' }, 401);
  if (request.method === 'POST' && new URL(request.headers.get('origin') || 'http://x').host !== new URL(request.url).host) return json({ error: 'Origine refusée' }, 403);

  if (path === '/logout') { await tdel(env, 'sess:' + sidOf(request)); return json({ ok: true }, 200, { 'set-cookie': 'sid=; Max-Age=0; Path=/' }); }
  if (path === '/config' && request.method === 'GET') {
    const c = await getCfg(env);
    return json({ brevoKey: mask(c.brevoKey), hcloud: mask(c.hcloud), scaleway: mask(c.scaleway), discord: mask(c.discord), mailFrom: c.mailFrom || '', replyTo: c.replyTo || '', mailName: c.mailName || '', publicUrl: c.publicUrl, paused: c.paused });
  }
  if (path === '/config' && request.method === 'POST') {
    const c = await rawCfg(env);
    for (const k of ['brevoKey', 'hcloud', 'scaleway', 'discord']) {
      if (body[k] === null) delete c[k];
      else if (typeof body[k] === 'string' && body[k].trim()) c[k] = body[k].trim();
    }
    if (typeof body.mailFrom === 'string') c.mailFrom = body.mailFrom.trim();
    if (typeof body.replyTo === 'string') c.replyTo = body.replyTo.trim();
    if (typeof body.mailName === 'string') c.mailName = body.mailName.trim().slice(0, 60);
    if (typeof body.publicUrl === 'string') c.publicUrl = body.publicUrl.trim().replace(/\/$/, '');
    if (typeof body.paused === 'boolean') c.paused = body.paused;
    await env.KV.put('config', JSON.stringify(c));
    await log(env, 'info', 'Réglages modifiés : ' + Object.keys(body).join(', '));
    return json({ ok: true });
  }
  if (path === '/health') {
    const cfg = await getCfg(env), t0 = () => Date.now();
    const run = async (fn) => { const a = t0(); try { const r = await fn(); return { ...r, ms: t0() - a }; } catch (e) { return { state: 'ko', detail: e.message || 'Erreur', ms: t0() - a }; } };
    const [brevo, d1, kv] = await Promise.all([
      run(async () => {
        if (!cfg.brevoKey) return { state: 'ko', detail: 'Aucune clé API Brevo enregistrée' };
        const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': cfg.brevoKey, accept: 'application/json' } });
        if (r.status === 401) return { state: 'ko', detail: 'Clé refusée par Brevo (invalide)' };
        if (r.status === 403) return { state: 'warn', detail: 'Clé acceptée mais permissions limitées (compte non lisible)' };
        if (!r.ok) return { state: 'ko', detail: `Brevo a répondu ${r.status}` };
        const a = await r.json().catch(() => ({}));
        const credits = (a.plan || []).find((x) => /^(free|payAsYouGo|subscription)$/i.test(x.type || '') && typeof x.credits === 'number');
        const from = String(cfg.mailFrom || '').toLowerCase();
        if (!from) return { state: 'warn', detail: 'Clé valide, mais aucune adresse expéditeur renseignée' };
        const sr = await fetch('https://api.brevo.com/v3/senders', { headers: { 'api-key': cfg.brevoKey, accept: 'application/json' } });
        if (sr.ok) {
          const sd = ((await sr.json().catch(() => ({}))).senders || []).find((x) => String(x.email).toLowerCase() === from);
          if (!sd) return { state: 'ko', detail: `Clé valide, mais ${from} n'est pas un expéditeur Brevo` };
          if (sd.active === false) return { state: 'warn', detail: `Clé valide, mais l'expéditeur ${from} n'est pas encore validé` };
        }
        return { state: 'ok', detail: 'API joignable · clé valide · expéditeur ' + from + (credits ? ` · ${credits.credits} crédits` : '') };
      }),
      run(async () => {
        if (!env.DB) return { state: 'ko', detail: 'Binding D1 « DB » absent (wrangler.toml)' };
        const d = await db(env);
        const n = (await d.prepare('SELECT COUNT(*) AS n FROM subs').first())?.n ?? 0;
        return { state: 'ok', detail: `Base D1 reliée · tables prêtes · ${n} inscrit(s)` };
      }),
      run(async () => {
        if (!env.KV) return { state: 'ko', detail: 'Binding KV « KV » absent (wrangler.toml)' };
        await env.KV.get('config');
        return { state: 'ok', detail: 'KV relié · lecture OK' + (env.ADMIN_PASSWORD ? ' · mot de passe admin défini (wrangler.toml)' : ' · ADMIN_PASSWORD manquant') };
      }),
    ]);
    return json({ services: [{ id: 'brevo', name: 'API Brevo', ...brevo }, { id: 'd1', name: 'Base D1', ...d1 }, { id: 'kv', name: 'KV', ...kv }], t: Date.now() });
  }
  if (path === '/status') return json({ status: await getStatus(env), subs: await countSubs(env) });
  if (path === '/check' && request.method === 'POST') { await log(env, 'info', 'Scan manuel lancé'); return json(await runCheck(env, true)); }
  if (path === '/test-mail' && request.method === 'POST') {
    try { await sendMail(await getCfg(env), { to: String(body.to || ''), subject: 'Test alertes serveurs', html: testMail({ publicUrl: (await getCfg(env)).publicUrl }), text: testText() }); await log(env, 'ok', 'Mail de test envoyé à ' + body.to); return json({ ok: true }); }
    catch (e) { await log(env, 'error', 'Test mail : ' + e.message); return json({ error: e.message }, 502); }
  }
  if (path === '/subs' && request.method === 'GET') {
    const rows = ((await (await db(env)).prepare('SELECT s.id AS id, s.email AS email, s.confirmed AS confirmed, o.offer_key AS k FROM subs s LEFT JOIN sub_offers o ON o.sub_id = s.id ORDER BY s.created, s.rowid, o.offer_key').all()).results) || [];
    const m = new Map();
    for (const r of rows) {
      let s = m.get(r.id);
      if (!s) m.set(r.id, (s = { id: r.id, email: r.email, confirmed: !!r.confirmed, offers: 0, keys: [] }));
      if (r.k) { s.offers++; s.keys.push(r.k); }
    }
    return json([...m.values()]);
  }
  if (path.startsWith('/subs/') && request.method === 'POST') { await delSub(env, path.slice(6)); return json({ ok: true }); }
  if (path === '/verify' && request.method === 'POST') {
    const cfg = await getCfg(env), s = body.service, v = typeof body.value === 'string' && body.value.trim() ? body.value.trim() : null;
    const fail = async (m) => { await log(env, 'error', `Vérification ${s} : ${m}`); return json({ error: m }, 400); };
    const good = async (detail, warn = false, skip = false) => { if (!skip) await log(env, warn ? 'warn' : 'ok', `Vérification ${s} : ${detail}`); return json({ ok: true, detail, warn, skip }); };
    try {
      if (s === 'brevo') {
        const key = v || cfg.brevoKey;
        if (!key) return fail('Aucune clé saisie ni enregistrée');
        const r = await fetch('https://api.brevo.com/v3/senders', { headers: { 'api-key': key, accept: 'application/json' } });
        const txt = await r.text();
        if (r.status === 401 || r.status === 403) {
          if (/key not found|invalid|unrecognized/i.test(txt)) return fail('Clé refusée par Brevo (invalide)');
          return good('Clé acceptée, mais ses permissions sont limitées : impossible de vérifier l\'expéditeur. Utilise « Tester Brevo » (envoi réel).', true);
        }
        if (!r.ok) return fail(`Brevo a répondu ${r.status}`);
        const from = String(body.mailFrom || cfg.mailFrom || '').toLowerCase();
        if (!from) return good('Clé valide, mais aucune adresse expéditeur renseignée', true);
        const sd = (JSON.parse(txt).senders || []).find((x) => String(x.email).toLowerCase() === from);
        if (!sd) return fail(`Clé valide, mais ${from} n'est pas un expéditeur Brevo`);
        if (sd.active === false) return fail(`Clé valide, mais l'expéditeur ${from} n'est pas encore validé`);
        return good(`Clé valide · expéditeur ${from} validé`);
      }
      if (s === 'hetzner') {
        const t = v || cfg.hcloud;
        if (!t) return good('Non configuré (optionnel)', false, true);
        const r = await fetch('https://api.hetzner.cloud/v1/datacenters', { headers: { authorization: `Bearer ${t}` } });
        if (r.status === 401 || r.status === 403) return fail('Token refusé par Hetzner');
        if (!r.ok) return fail(`Hetzner a répondu ${r.status}`);
        return good(`Token valide · ${(await r.json()).datacenters.length} datacenters visibles`);
      }
      if (s === 'scaleway') {
        const t = v || cfg.scaleway;
        if (!t) return good('Non configuré (optionnel)', false, true);
        const r = await fetch('https://api.scaleway.com/instance/v1/zones/fr-par-1/products/servers/availability', { headers: { 'X-Auth-Token': t } });
        if (r.status === 401 || r.status === 403) return fail('Clé refusée par Scaleway');
        if (!r.ok) return fail(`Scaleway a répondu ${r.status}`);
        return good(`Clé valide · ${Object.keys((await r.json()).servers || {}).length} types de serveurs lisibles`);
      }
      if (s === 'discord') {
        const u = v || cfg.discord;
        if (!u) return good('Non configuré (optionnel)', false, true);
        if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(u)) return fail('URL de webhook Discord invalide');
        const r = await fetch(u);
        if (!r.ok) return fail(`Webhook refusé (${r.status}) : supprimé ou mal copié ?`);
        return good(`Webhook valide · « ${(await r.json()).name || 'sans nom'} »`);
      }
      if (s === 'ovh') {
        const r = await fetch('https://eu.api.ovh.com/v1/order/catalog/public/vps?ovhSubsidiary=FR');
        if (!r.ok) return fail(`API OVH a répondu ${r.status}`);
        return good(`API OVH joignable · ${((await r.json()).plans || []).length} plans au catalogue`);
      }
      return json({ error: 'Service inconnu' }, 400);
    } catch (e) { return fail(e.message); }
  }
  if (path === '/logs' && request.method === 'GET') return json(((await (await db(env)).prepare('SELECT t, l, m FROM logs ORDER BY id DESC LIMIT 200').all()).results) || []);
  if (path === '/logs/clear' && request.method === 'POST') { await (await db(env)).prepare('DELETE FROM logs').run(); return json({ ok: true }); }
  return json({ error: 'Not found' }, 404);
}

async function route(request, env, ctx) {
  const url = new URL(request.url), p = url.pathname;
  if (p.startsWith('/api/admin/')) return admin(request, env, p.slice(10));
  const cfg = await getCfg(env);
  if (!cfg.publicUrl) { const c = await rawCfg(env); c.publicUrl = url.origin; await env.KV.put('config', JSON.stringify(c)); cfg.publicUrl = url.origin; }
  if (p.startsWith('/api/manage/')) return manage(request, env, cfg, p.slice(11), ctx);
  if (p === '/api/offers') {
    let offers = (await getOffers(env)).filter((o) => ORDER[o.provider]);
    if (!offers.length) await runCheck(env), (offers = (await getOffers(env)).filter((o) => ORDER[o.provider]));
    return json({ providers: PROVIDERS.filter((p) => offers.some((o) => o.provider === p.id)).map(({ id, name, order }) => ({ id, name, order })), offers, lastRun: (await sget(env, 'lastRun', null)) });
  }
  if (p === '/api/subscribe' && request.method === 'POST') return subscribe(request, env, cfg);
  const m = p.match(/^\/(confirm|unsubscribe)\/([0-9a-f-]{36})$/);
  if (m) {
    const sub = await subById(env, m[2]);
    if (!sub) return html('Lien invalide', 'Ce lien est invalide ou a déjà été utilisé.', false);
    if (m[1] === 'confirm') {
      await (await db(env)).prepare('UPDATE subs SET confirmed = 1 WHERE id = ?').bind(sub.id).run();
      await log(env, 'ok', `Email confirmé : ${sub.email}`);
      return html('Adresse confirmée', 'Tes alertes sont activées : tu recevras un mail dès qu\'un des serveurs choisis est de retour en stock.');
    }
    await delSub(env, sub.id);
    await log(env, 'info', `Désinscription : ${sub.email}`);
    return html('Tu es désinscrit', 'Ton adresse a été supprimée, tu ne recevras plus aucun mail. Tu peux te réinscrire à tout moment.');
  }
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    if (!env.DB) return new Response('Base D1 non configurée : crée-la avec « npx wrangler d1 create serveurovhdispo », colle son database_id dans wrangler.toml puis redéploie (voir README).', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    try { return await route(request, env, ctx); }
    catch (e) { console.error(e); return json({ error: 'Erreur serveur, réessaie dans un instant' }, 500); }
  },
  async scheduled(_e, env, ctx) {
    if (!env.DB) return console.error('D1 non configurée (voir README)');
    ctx.waitUntil((async () => {
      await runCheck(env).catch((e) => console.error('scan', e));
      await cleanup(env).catch((e) => console.error('cleanup', e));
    })());
  },
};
