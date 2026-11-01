import { fetchOvh } from './ovh.js';
import { fetchHetzner } from './hetzner.js';
import { sendMail, esc } from './mail.js';

const MAX_SUBS = 200;
const MAX_OFFERS_PER_SUB = 30;
const ORDER_URL = {
  ovh: 'https://www.ovhcloud.com/fr/vps/',
  hetzner: 'https://console.hetzner.cloud/',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const page = (msg) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;max-width:480px;margin:4rem auto;padding:0 1rem"><p>${esc(msg)}</p><p><a href="/">Retour</a></p>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

const getSubs = async (env) => (await env.KV.get('subs', 'json')) || [];
const putSubs = (env, subs) => env.KV.put('subs', JSON.stringify(subs));
const getOffers = async (env) => (await env.KV.get('offers', 'json')) || [];

// ---------- Verification des disponibilites ----------
async function refreshOffers(env) {
  const old = await getOffers(env);
  const [ovh, het] = await Promise.allSettled([fetchOvh(), fetchHetzner(env.HCLOUD_TOKEN)]);
  const failed = new Set();
  const offers = [];
  for (const [name, res] of [['ovh', ovh], ['hetzner', het]]) {
    if (res.status === 'fulfilled') offers.push(...res.value);
    else {
      console.log(`${name} KO:`, res.reason?.message);
      failed.add(name);
      offers.push(...old.filter((o) => o.provider === name)); // on garde l'ancien etat
    }
  }
  await env.KV.put('offers', JSON.stringify(offers));
  return { offers, failed };
}

function alertHtml(env, hits, id) {
  const rows = hits
    .map(
      (o) =>
        `<li><b>${esc(o.label)}</b>${o.price ? ` - ${o.price} €/mois` : ''}<br>Disponible : ${esc(o.locations.join(', '))}<br><a href="${ORDER_URL[o.provider]}">Commander chez ${o.provider === 'ovh' ? 'OVH' : 'Hetzner'}</a></li>`,
    )
    .join('');
  return `<p>Bonne nouvelle, du stock est disponible :</p><ul>${rows}</ul><p style="color:#888;font-size:12px"><a href="${env.PUBLIC_URL}/unsubscribe/${id}">Se desinscrire</a></p>`;
}

async function runCheck(env) {
  const { offers, failed } = await refreshOffers(env);
  const byKey = Object.fromEntries(offers.map((o) => [o.key, o]));
  const subs = await getSubs(env);
  let changed = false;

  for (const sub of subs) {
    if (!sub.confirmed) continue;
    const hits = [];
    for (const key of sub.offers) {
      const o = byKey[key];
      if (!o || failed.has(o.provider)) continue; // pas d'info fiable, on ne touche a rien
      if (o.locations.length) {
        if (!sub.notified[key]) hits.push(o);
      } else if (sub.notified[key]) {
        delete sub.notified[key]; // de nouveau indispo : on pourra re-alerter
        changed = true;
      }
    }
    if (!hits.length) continue;
    try {
      await sendMail(env, {
        to: sub.email,
        subject: `Serveur dispo : ${hits.map((h) => h.label.split(' - ')[0]).join(', ')}`,
        html: alertHtml(env, hits, sub.id),
      });
      hits.forEach((h) => (sub.notified[h.key] = true));
      changed = true;
    } catch (e) {
      console.log('mail KO', sub.email, e.message); // on retentera au prochain passage
    }
  }
  if (changed) await putSubs(env, subs);
}

// ---------- Routes HTTP ----------
async function subscribe(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Requete invalide' }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: 'Email invalide' }, 400);

  const known = new Set((await getOffers(env)).map((o) => o.key));
  const wanted = [...new Set(body.offers || [])].filter((k) => known.has(k));
  if (!wanted.length) return json({ error: 'Choisis au moins une offre' }, 400);
  if (wanted.length > MAX_OFFERS_PER_SUB) return json({ error: `${MAX_OFFERS_PER_SUB} offres maximum` }, 400);

  const subs = await getSubs(env);
  let sub = subs.find((s) => s.email === email);
  if (!sub) {
    if (subs.length >= MAX_SUBS) return json({ error: 'Trop d\'inscrits pour le moment' }, 503);
    sub = { id: crypto.randomUUID(), email, confirmed: false, offers: [], notified: {} };
    subs.push(sub);
  }
  sub.offers = wanted;
  sub.notified = {};

  try {
    await sendMail(env, {
      to: email,
      subject: 'Confirme ton alerte serveur',
      html: `<p>Clique pour activer tes alertes :</p><p><a href="${env.PUBLIC_URL}/confirm/${sub.id}">Confirmer mon email</a></p><p style="color:#888;font-size:12px">Si ce n'est pas toi, ignore ce message.</p>`,
    });
  } catch (e) {
    console.log('confirm mail KO', e.message);
    return json({ error: "Impossible d'envoyer le mail de confirmation" }, 502);
  }
  await putSubs(env, subs);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/offers') {
      let offers = await getOffers(env);
      if (!offers.length) offers = (await refreshOffers(env)).offers; // premier lancement
      return json(offers);
    }
    if (pathname === '/api/subscribe' && request.method === 'POST') return subscribe(request, env);

    const m = pathname.match(/^\/(confirm|unsubscribe)\/([0-9a-f-]{36})$/);
    if (m) {
      const subs = await getSubs(env);
      const sub = subs.find((s) => s.id === m[2]);
      if (!sub) return page('Lien invalide ou deja utilise.');
      if (m[1] === 'confirm') {
        sub.confirmed = true;
        await putSubs(env, subs);
        return page('Email confirme, tu recevras un mail des qu\'un serveur est dispo.');
      }
      await putSubs(env, subs.filter((s) => s.id !== sub.id));
      return page('Tu es desinscrit.');
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  },
};
