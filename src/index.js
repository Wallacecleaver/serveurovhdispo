import { fetchOvh } from './ovh.js';
import { fetchHetzner } from './hetzner.js';
import { fetchScaleway } from './scaleway.js';
import { sendMail, esc, confirmMail, confirmText, alertMail, alertText, testMail, testText } from './mail.js';

// Fournisseurs surveilles. `needs` = champ de config requis (sinon le fournisseur est ignore).
const PROVIDERS = [
  { id: 'ovh', name: 'OVH VPS', order: 'https://www.ovhcloud.com/fr/vps/', run: () => fetchOvh() },
  { id: 'hetzner', name: 'Hetzner Cloud', order: 'https://console.hetzner.cloud/', needs: 'hcloud', run: (c) => fetchHetzner(c.hcloud) },
  { id: 'scaleway', name: 'Scaleway', order: 'https://console.scaleway.com/instance/servers/create', needs: 'scaleway', run: (c) => fetchScaleway(c.scaleway) },
];
const ORDER = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.order]));
const PNAME = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name]));
const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', ...h } });
const html = (title, msg, ok = true) => new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Radar serveurs</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&display=swap"><link rel="stylesheet" href="/site.css?v=5"></head><body><main class="wrap msgpage"><div class="msgcard"><div class="ic${ok ? '' : ' ko'}">${ok ? '✓' : '!'}</div><h1>${esc(title)}</h1><p>${esc(msg)}</p><a class="cta" href="/">Retour au radar</a></div><footer class="credit">Fait avec <span class="hrt">♥</span> par <a href="https://github.com/Wallacecleaver" target="_blank" rel="noopener">Wallace</a> · <a href="/conditions">Conditions d'utilisation</a></footer></main></body></html>`, { status: ok ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8' } });

// ---------- config (KV d'abord, variables d'env en secours) ----------
const rawCfg = async (env) => (await env.KV.get('config', 'json')) || {};
async function getCfg(env) {
  const c = await rawCfg(env);
  return { brevoKey: c.brevoKey || env.BREVO_API_KEY, mailFrom: c.mailFrom || (/exemple\.com/.test(env.MAIL_FROM || '') ? '' : env.MAIL_FROM), hcloud: c.hcloud || env.HCLOUD_TOKEN, scaleway: c.scaleway || env.SCW_SECRET_KEY, replyTo: c.replyTo || '', mailName: c.mailName || '', discord: c.discord || '', publicUrl: c.publicUrl || (/TON-SOUS/.test(env.PUBLIC_URL || '') ? '' : env.PUBLIC_URL || ''), paused: !!c.paused };
}
const mask = (v) => (v ? '••••' + v.slice(-4) : '');
const getSubs = async (env) => (await env.KV.get('subs', 'json')) || [];
const putSubs = (env, s) => env.KV.put('subs', JSON.stringify(s));
async function log(env, level, msg) {
  try {
    const l = (await env.KV.get('logs', 'json')) || [];
    l.push({ t: Date.now(), l: level, m: String(msg).slice(0, 300) });
    await env.KV.put('logs', JSON.stringify(l.slice(-200)));
  } catch {}
}
const getOffers = async (env) => (await env.KV.get('offers', 'json')) || [];

// ---------- auth ----------
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256));
}
async function limited(env, key, max, ttl) {
  const n = +((await env.KV.get(key)) || 0);
  if (n >= max) return true;
  await env.KV.put(key, String(n + 1), { expirationTtl: ttl });
  return false;
}
async function newSession(env) {
  const sid = crypto.randomUUID() + crypto.randomUUID();
  await env.KV.put('sess:' + sid, '1', { expirationTtl: 7 * 86400 });
  return json({ ok: true }, 200, { 'set-cookie': `sid=${sid}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 86400}` });
}
const sidOf = (r) => (r.headers.get('cookie') || '').match(/(?:^|; )sid=([\w-]+)/)?.[1];
const authed = async (r, env) => { const s = sidOf(r); return !!s && !!(await env.KV.get('sess:' + s)); };

// ---------- verification ----------
async function runCheck(env, manual = false) {
  const cfg = await getCfg(env);
  const old = await getOffers(env);
  const st = { lastRun: Date.now() };
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
  await env.KV.put('offers', JSON.stringify(offers));
  const prev = (await env.KV.get('status', 'json')) || {};
  for (const { id: n } of PROVIDERS) {
    const a = prev[n], b = st[n];
    if (!b || b.skipped) continue;
    if (!b.ok) { if (a?.error !== b.error) await log(env, 'error', `${n.toUpperCase()} : ${b.error}`); }
    else if (!a?.ok || a.available !== b.available || manual) await log(env, b.available ? 'ok' : 'info', `${n.toUpperCase()} : ${b.count} offres, ${b.available} dispo`);
  }
  await env.KV.put('status', JSON.stringify(st));
  if (cfg.paused) return st;

  const byKey = Object.fromEntries(offers.map((o) => [o.key, o]));
  // Discord : alerte globale sur toute offre qui passe en dispo
  if (cfg.discord) {
    const prev = (await env.KV.get('avail', 'json')) || {};
    const now = {}, fresh = [];
    for (const o of offers) {
      now[o.key] = o.locations.length > 0;
      if (now[o.key] && !prev[o.key] && !failed.has(o.provider)) fresh.push(o);
    }
    for (const k of Object.keys(prev)) if (failed.has(byKey[k]?.provider)) now[k] = prev[k];
    if (fresh.length) {
      const content = '🚀 **Serveur dispo !**\n' + fresh.map((o) => `• **${o.label}**${o.price ? ` (${o.price} €/mois)` : ''} : ${o.locations.join(', ')}\n${ORDER[o.provider]}`).join('\n');
      await fetch(cfg.discord, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900) }) }).catch(() => {});
      await log(env, 'ok', `Discord : ${fresh.length} offre(s) dispo signalée(s)`);
    }
    await env.KV.put('avail', JSON.stringify(now));
  }
  // Mails
  const subs = await getSubs(env);
  let changed = false;
  for (const sub of subs) {
    if (!sub.confirmed) continue;
    const hits = [];
    for (const key of sub.offers) {
      const o = byKey[key];
      if (!o || failed.has(o.provider)) continue;
      if (o.locations.length) { if (!sub.notified[key]) hits.push(o); }
      else if (sub.notified[key]) { delete sub.notified[key]; changed = true; }
    }
    if (!hits.length) continue;
    try {
      const html = alertMail({ hits: hits.map((o) => ({ ...o, order: ORDER[o.provider], providerName: PNAME[o.provider] })), unsubUrl: `${cfg.publicUrl}/unsubscribe/${sub.id}`, publicUrl: cfg.publicUrl });
      const text = alertText({ hits: hits.map((o) => ({ ...o, order: ORDER[o.provider], providerName: PNAME[o.provider] })), unsubUrl: `${cfg.publicUrl}/unsubscribe/${sub.id}`, publicUrl: cfg.publicUrl });
      await sendMail(cfg, { to: sub.email, subject: `🚀 Serveur dispo : ${hits.map((h) => h.label.split(' - ')[0]).join(', ')}`, html, text });
      hits.forEach((h) => (sub.notified[h.key] = true));
      changed = true;
      await log(env, 'ok', `Alerte envoyée à ${sub.email} (${hits.length} offre(s))`);
    } catch (e) { await log(env, 'error', `Mail à ${sub.email} : ${e.message}`); st.mailError = e.message; await env.KV.put('status', JSON.stringify(st)); }
  }
  if (changed) await putSubs(env, subs);
  return st;
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
  const subs = await getSubs(env);
  let sub = subs.find((s) => s.email === email);
  if (!sub) {
    if (subs.length >= 300) return json({ error: 'Complet pour le moment' }, 503);
    sub = { id: crypto.randomUUID(), email, confirmed: false, offers: [], notified: {} };
    subs.push(sub);
  }
  sub.offers = wanted; sub.notified = {};
  try {
    await sendMail(cfg, { to: email, subject: '✅ Confirme ton alerte serveur', html: confirmMail({ url: `${cfg.publicUrl}/confirm/${sub.id}`, names: wanted.map((k) => labelOf[k] || k), publicUrl: cfg.publicUrl }), text: confirmText({ url: `${cfg.publicUrl}/confirm/${sub.id}`, names: wanted.map((k) => labelOf[k] || k), publicUrl: cfg.publicUrl }) });
  } catch (e) { return json({ error: "Envoi du mail impossible (l'admin doit configurer Brevo)" }, 502); }
  await putSubs(env, subs);
  await log(env, 'info', `Inscription en attente : ${email}`);
  return json({ ok: true });
}

// ---------- admin ----------
async function admin(request, env, path) {
  const ad = await env.KV.get('admin', 'json');
  if (path === '/state') return json({ setup: !!ad, authed: await authed(request, env) });
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (path === '/setup' && request.method === 'POST') {
    if (ad) return json({ error: 'Déjà configuré' }, 403);
    if (String(body.password || '').length < 10) return json({ error: '10 caractères minimum' }, 400);
    const salt = crypto.randomUUID();
    await env.KV.put('admin', JSON.stringify({ salt, hash: await hashPw(body.password, salt) }));
    await log(env, 'info', 'Compte admin créé');
    return newSession(env);
  }
  if (path === '/login' && request.method === 'POST') {
    if (!ad) return json({ error: 'Pas encore configuré' }, 400);
    if (await limited(env, 'rl:login:' + ip, 6, 900)) return json({ error: 'Trop d\'essais, attends 15 min' }, 429);
    if ((await hashPw(String(body.password || ''), ad.salt)) !== ad.hash) { await log(env, 'warn', `Connexion admin refusée (${ip})`); return json({ error: 'Mot de passe incorrect' }, 401); }
    await log(env, 'info', 'Connexion admin');
    return newSession(env);
  }
  if (!(await authed(request, env))) return json({ error: 'Non connecté' }, 401);
  if (request.method === 'POST' && new URL(request.headers.get('origin') || 'http://x').host !== new URL(request.url).host) return json({ error: 'Origine refusée' }, 403);

  if (path === '/logout') { await env.KV.delete('sess:' + sidOf(request)); return json({ ok: true }, 200, { 'set-cookie': 'sid=; Max-Age=0; Path=/' }); }
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
  if (path === '/status') return json({ status: (await env.KV.get('status', 'json')) || {}, subs: (await getSubs(env)).length });
  if (path === '/check' && request.method === 'POST') { await log(env, 'info', 'Scan manuel lancé'); return json(await runCheck(env, true)); }
  if (path === '/test-mail' && request.method === 'POST') {
    try { await sendMail(await getCfg(env), { to: String(body.to || ''), subject: 'Test alertes serveurs', html: testMail({ publicUrl: (await getCfg(env)).publicUrl }), text: testText() }); await log(env, 'ok', 'Mail de test envoyé à ' + body.to); return json({ ok: true }); }
    catch (e) { await log(env, 'error', 'Test mail : ' + e.message); return json({ error: e.message }, 502); }
  }
  if (path === '/subs' && request.method === 'GET') return json((await getSubs(env)).map(({ id, email, confirmed, offers }) => ({ id, email, confirmed, offers: offers.length, keys: offers })));
  if (path.startsWith('/subs/') && request.method === 'POST') { await putSubs(env, (await getSubs(env)).filter((s) => s.id !== path.slice(6))); return json({ ok: true }); }
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
  if (path === '/logs' && request.method === 'GET') return json(((await env.KV.get('logs', 'json')) || []).reverse());
  if (path === '/logs/clear' && request.method === 'POST') { await env.KV.delete('logs'); return json({ ok: true }); }
  if (path === '/password' && request.method === 'POST') {
    if ((await hashPw(String(body.current || ''), ad.salt)) !== ad.hash) return json({ error: 'Mot de passe actuel incorrect' }, 401);
    if (String(body.next || '').length < 10) return json({ error: '10 caractères minimum' }, 400);
    const salt = crypto.randomUUID();
    await env.KV.put('admin', JSON.stringify({ salt, hash: await hashPw(body.next, salt) }));
    await log(env, 'info', 'Mot de passe admin changé');
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname;
    if (p.startsWith('/api/admin/')) return admin(request, env, p.slice(10));
    const cfg = await getCfg(env);
    if (!cfg.publicUrl) { const c = await rawCfg(env); c.publicUrl = url.origin; await env.KV.put('config', JSON.stringify(c)); cfg.publicUrl = url.origin; }
    if (p === '/api/offers') {
      let offers = (await getOffers(env)).filter((o) => ORDER[o.provider]);
      if (!offers.length) await runCheck(env), (offers = (await getOffers(env)).filter((o) => ORDER[o.provider]));
      return json({ providers: PROVIDERS.filter((p) => offers.some((o) => o.provider === p.id)).map(({ id, name, order }) => ({ id, name, order })), offers, lastRun: ((await env.KV.get('status', 'json')) || {}).lastRun || null });
    }
    if (p === '/api/subscribe' && request.method === 'POST') return subscribe(request, env, cfg);
    const m = p.match(/^\/(confirm|unsubscribe)\/([0-9a-f-]{36})$/);
    if (m) {
      const subs = await getSubs(env), sub = subs.find((s) => s.id === m[2]);
      if (!sub) return html('Lien invalide', 'Ce lien est invalide ou a déjà été utilisé.', false);
      if (m[1] === 'confirm') { sub.confirmed = true; await putSubs(env, subs); await log(env, 'ok', `Email confirmé : ${sub.email}`); return html('Adresse confirmée', 'Tes alertes sont activées : tu recevras un mail dès qu\'un des serveurs choisis est de retour en stock.'); }
      await putSubs(env, subs.filter((s) => s.id !== sub.id));
      await log(env, 'info', `Désinscription : ${sub.email}`);
      return html('Tu es désinscrit', 'Ton adresse a été supprimée, tu ne recevras plus aucun mail. Tu peux te réinscrire à tout moment.');
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(runCheck(env)); },
};
