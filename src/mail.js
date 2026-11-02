export async function sendMail(cfg, { to, subject, html, text }) {
  if (!cfg.brevoKey || !cfg.mailFrom) throw new Error('Brevo non configuré : colle la clé dans Réglages puis clique sur Enregistrer');
  const body = { sender: { email: cfg.mailFrom, name: cfg.mailName || 'Alertes serveurs' }, to: [{ email: to }], subject, htmlContent: html };
  if (text) body.textContent = text; // version texte : meilleure délivrabilité
  // Adresse de reponse dediee : evite que Brevo mette l'adresse perso en "repondre a"
  if (cfg.replyTo) body.replyTo = { email: cfg.replyTo, name: cfg.mailName || 'Alertes serveurs' };
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cfg.brevoKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status} ${(await r.text()).slice(0, 200)}`);
}
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ======================= gabarits de mails =======================
// HTML en tableaux + styles en ligne (compatible Gmail / Outlook / Apple Mail). Un fond de secours est
// toujours donné avant chaque dégradé pour les clients qui ne les gèrent pas.
const C = { bg: '#05060f', card: '#0d1020', card2: '#141838', line: '#252a55', fg: '#eef0ff', mut: '#9aa1cc', dim: '#6d739c', cy: '#3de7ff', vi: '#8a5cff', ok: '#3dffa8' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const YEAR = new Date().getFullYear();
const AUTHOR = 'Wallace';
const AUTHOR_URL = 'https://github.com/Wallacecleaver';
const price = (n) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

const TERMS = `Radar serveurs est un service gratuit et indépendant, créé par ${AUTHOR}. Il n’est affilié à aucun hébergeur (OVHcloud, Hetzner, Scaleway et les autres sont des marques de leurs propriétaires). Les stocks et les prix sont donnés à titre indicatif : ils peuvent changer sans préavis et un serveur affiché disponible peut être pris avant ta commande. Aucune alerte n’est garantie (retard, mail classé en spam, panne). Ton adresse sert uniquement à t’envoyer ces alertes et tu peux te désinscrire en un clic. En utilisant le service, tu acceptes les conditions d’utilisation.`;

function layout({ preheader, title, hero, body, publicUrl, unsubUrl }) {
  const site = publicUrl || '';
  const logo = /^https:\/\//.test(site) ? `<img src="${esc(site)}/mail/radar.png" width="44" height="44" alt="&#9673;" style="display:block;border:0;outline:none;width:44px;height:44px;">` : `<span style="font-size:34px;line-height:44px;color:${C.cy};">&#9673;</span>`;
  const link = (href, label) => `<a href="${esc(href)}" style="color:${C.mut};text-decoration:underline;">${label}</a>`;
  const links = [site && link(`${site}/conditions`, 'Conditions d&rsquo;utilisation'), site && link(site, 'Le site'), site && link(`${site}/manage`, 'G&eacute;rer mon alerte'), unsubUrl && link(unsubUrl, 'Se d&eacute;sinscrire')].filter(Boolean).join(`<span style="color:${C.dim};">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`);
  return `<!doctype html><html lang="fr" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};font-size:1px;line-height:1px;">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:32px 14px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

<tr><td style="padding:0 6px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="56" valign="middle">${logo}</td>
<td valign="middle" style="font-family:${FONT};"><div style="font-size:18px;font-weight:800;letter-spacing:-.01em;color:${C.fg};">Radar serveurs</div><div style="font-size:12px;color:${C.dim};margin-top:1px;">Alertes de stock VPS</div></td>
<td align="right" valign="middle" style="font-family:${FONT};font-size:12px;color:${C.dim};">by <a href="${AUTHOR_URL}" style="color:${C.cy};text-decoration:none;font-weight:700;">${AUTHOR}</a></td>
</tr></table></td></tr>

<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:20px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="height:4px;line-height:4px;font-size:0;background-color:${C.vi};background-image:linear-gradient(90deg,${C.cy},${C.vi});">&nbsp;</td></tr>
<tr><td style="padding:38px 34px 30px;background-color:#12163a;background-image:linear-gradient(160deg,#1d2260 0%,#12163a 45%,${C.card} 100%);font-family:${FONT};">${hero}</td></tr>
<tr><td style="padding:30px 34px 36px;font-family:${FONT};color:${C.fg};">${body}</td></tr>
</table></td></tr>

<tr><td style="padding:26px 12px 0;font-family:${FONT};text-align:center;">
<div style="font-size:13px;line-height:1.7;">${links}</div>
<div style="margin:18px auto 0;max-width:500px;font-size:11px;line-height:1.7;color:${C.dim};">${esc(TERMS)}</div>
<div style="margin-top:18px;font-size:12px;color:${C.mut};">Fait avec <span style="color:#ff6b86;">&hearts;</span> par <a href="${AUTHOR_URL}" style="color:${C.cy};text-decoration:none;font-weight:700;">${AUTHOR}</a> &nbsp;&middot;&nbsp; &copy; ${YEAR} Radar serveurs</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

const pill = (label, color) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr><td style="padding:5px 12px;border:1px solid ${color};border-radius:99px;font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${color};background-color:rgba(255,255,255,.04);">${label}</td></tr></table>`;
const h1 = (t) => `<h1 style="margin:0 0 12px;font-family:${FONT};font-size:32px;line-height:1.15;font-weight:800;letter-spacing:-.02em;color:${C.fg};">${t}</h1>`;
const lead = (t) => `<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:#b9bfe6;">${t}</p>`;
const button = (href, label, big = true) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:${big ? '28px 0 6px' : '16px 0 0'};"><tr><td style="border-radius:12px;background-color:${C.cy};background-image:linear-gradient(90deg,${C.cy},#7fb4ff);"><a href="${esc(href)}" style="display:inline-block;padding:${big ? '16px 34px' : '11px 22px'};font-family:${FONT};font-size:${big ? 16 : 14}px;font-weight:800;color:#04121a;text-decoration:none;border-radius:12px;">${label}</a></td></tr></table>`;
const chip = (t, color = C.mut, border = C.line) => `<span style="display:inline-block;margin:6px 6px 0 0;padding:4px 11px;border:1px solid ${border};border-radius:99px;font-family:${FONT};font-size:12px;font-weight:600;color:${color};">${t}</span>`;
const stat = (value, label) => `<td align="center" style="padding:14px 8px;font-family:${FONT};"><div style="font-size:22px;font-weight:800;color:${C.fg};">${value}</div><div style="margin-top:2px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${C.dim};">${label}</div></td>`;
const step = (n, title, sub, on) => `<tr><td width="40" valign="top" style="padding:0 0 16px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="width:30px;height:30px;border-radius:50%;font-family:${FONT};font-size:14px;font-weight:800;color:${on ? '#04121a' : C.mut};background-color:${on ? C.cy : C.card2};border:1px solid ${on ? C.cy : C.line};">${n}</td></tr></table></td><td valign="top" style="padding:3px 0 16px;font-family:${FONT};"><div style="font-size:15px;font-weight:700;color:${on ? C.fg : '#cdd2f3'};">${title}</div><div style="margin-top:2px;font-size:14px;line-height:1.5;color:${C.mut};">${sub}</div></td></tr>`;

// ---- Confirmation d'inscription ----
export function confirmMail({ url, names = [], publicUrl = '' }) {
  const n = names.length;
  const shown = names.slice(0, 6).map((x) => chip(`&#10003;&nbsp; ${esc(x)}`, C.fg, '#323880')).join('');
  const more = n > 6 ? chip(`+ ${n - 6} autre${n - 6 > 1 ? 's' : ''}`) : '';
  const hero = `${pill('Confirmation', C.cy)}${h1('Active tes alertes<br>en un clic')}${lead(`Tu as demandé à être prévenu dès que ${n > 1 ? 'ces serveurs reviennent' : 'ce serveur revient'} en stock. Il ne reste qu&rsquo;à confirmer ton adresse.`)}`;
  const body = `${n ? `<div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${C.dim};margin-bottom:4px;">Ta s&eacute;lection &middot; ${n} serveur${n > 1 ? 's' : ''}</div><div style="margin-bottom:6px;">${shown}${more}</div>` : ''}
${button(url, 'Confirmer mon adresse &rarr;')}
<div style="margin:10px 0 28px;font-family:${FONT};font-size:12px;color:${C.dim};">Le bouton ne marche pas ? Copie ce lien : <a href="${esc(url)}" style="color:${C.cy};word-break:break-all;">${esc(url)}</a></div>
<div style="height:1px;line-height:1px;font-size:0;background:${C.line};margin:0 0 24px;">&nbsp;</div>
<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${C.dim};margin-bottom:14px;">Ce qui se passe ensuite</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${step(1, 'Tu confirmes ton adresse', 'C&rsquo;est l&rsquo;&eacute;tape en cours : un seul clic.', true)}
${step(2, 'On surveille les stocks', 'Les offres sont relues toutes les 5 minutes, jour et nuit.')}
${step(3, 'Tu re&ccedil;ois un mail instantan&eacute;', 'D&egrave;s qu&rsquo;un serveur choisi est disponible, avec le bouton pour commander.')}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;background:${C.card2};border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:14px 16px;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.mut};">&#128274;&nbsp; <b style="color:${C.fg};">Tu n&rsquo;as rien demand&eacute; ?</b> Ignore simplement ce message : sans ton clic, rien n&rsquo;est activ&eacute; et ton adresse n&rsquo;est pas utilis&eacute;e.</td></tr></table>`;
  return layout({ title: 'Confirme ton alerte serveur', preheader: 'Un clic pour activer tes alertes de stock.', hero, body, publicUrl });
}
export const confirmText = ({ url, names = [], publicUrl = '' }) => `Active tes alertes en un clic

Tu as demandé à être prévenu dès que ${names.length > 1 ? 'ces serveurs reviennent' : 'ce serveur revient'} en stock :
${names.map((n) => '- ' + n).join('\n')}

Confirme ton adresse : ${url}

Tu n'as rien demandé ? Ignore ce message, rien ne sera activé.

--
Radar serveurs, par ${AUTHOR}${publicUrl ? `\nConditions d'utilisation : ${publicUrl}/conditions` : ''}
${TERMS}`;

// ---- Alerte de stock : hits = [{label, price, locations, order, providerName}] ----
export function alertMail({ hits, unsubUrl, publicUrl = '' }) {
  const n = hits.length;
  const prices = hits.map((h) => h.price).filter((x) => x != null);
  const when = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const hero = `${pill('<span style="color:' + C.ok + ';">&#9679;</span>&nbsp; En stock', C.ok)}${h1(n > 1 ? `${n} serveurs sont<br>de retour en stock` : 'Un serveur est<br>de retour en stock')}${lead(`D&eacute;tect&eacute; le ${esc(when)}. Les stocks partent vite : fonce avant qu&rsquo;il ne soit trop tard.`)}`;
  const cards = hits.map((o) => {
    const [name, ...rest] = o.label.split(' - ');
    const specs = rest.join(' - ').split(/,\s*/).filter(Boolean).map((s) => chip(esc(s))).join('');
    const where = o.locations.map((l) => chip(`&#9679;&nbsp; ${esc(l)}`, C.ok, '#1c6b4d')).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:${C.card2};border:1px solid ${C.line};border-left:3px solid ${C.ok};border-radius:14px;"><tr><td style="padding:20px 20px 18px;font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top"><div style="font-size:20px;font-weight:800;color:${C.fg};">${esc(name)}</div><div style="margin-top:3px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${C.dim};">${esc(o.providerName || '')}</div></td>
<td align="right" valign="top" style="white-space:nowrap;">${o.price != null ? `<div style="font-size:24px;font-weight:800;color:${C.fg};">${price(o.price)}&nbsp;&euro;</div><div style="font-size:12px;color:${C.dim};">par mois</div>` : ''}</td>
</tr></table>
<div style="margin-top:8px;">${specs}</div>
<div style="margin-top:2px;"><span style="display:inline-block;margin:10px 8px 0 0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.dim};">Disponible &agrave;</span>${where}</div>
${button(o.order, `Commander chez ${esc(o.providerName || 'l&rsquo;h&eacute;bergeur')} &rarr;`, false)}
</td></tr></table>`;
  }).join('');
  const stats = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:${C.card2};border:1px solid ${C.line};border-radius:14px;"><tr>${stat(n, n > 1 ? 'Serveurs dispo' : 'Serveur dispo')}${prices.length ? stat(`${price(Math.min(...prices))}&nbsp;&euro;`, '&Agrave; partir de') : ''}${stat(new Set(hits.map((h) => h.providerName)).size, 'H&eacute;bergeur' + (new Set(hits.map((h) => h.providerName)).size > 1 ? 's' : ''))}</tr></table>`;
  const tip = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;background:${C.card2};border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:14px 16px;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.mut};">&#9889;&nbsp; <b style="color:${C.fg};">Astuce :</b> les stocks sont relus toutes les 5 minutes et restent indicatifs. Si l&rsquo;offre est d&eacute;j&agrave; partie, tu seras pr&eacute;venu d&egrave;s qu&rsquo;elle revient.</td></tr></table>`;
  return layout({ title: 'Serveur dispo', preheader: hits.map((h) => h.label.split(' - ')[0]).join(', ') + ' : de retour en stock, commande vite.', hero, body: `${stats}${cards}${tip}`, publicUrl, unsubUrl });
}
export const alertText = ({ hits, unsubUrl, publicUrl = '' }) => `Du stock est de retour !

${hits.map((o) => `${o.label}${o.price != null ? ` - ${price(o.price)} EUR/mois` : ''}\nDisponible : ${o.locations.join(', ')}\nCommander : ${o.order}`).join('\n\n')}

Les stocks sont indicatifs : commande vite.

--
Radar serveurs, par ${AUTHOR}
Se désinscrire : ${unsubUrl}${publicUrl ? `\nConditions d'utilisation : ${publicUrl}/conditions` : ''}
${TERMS}`;

// ---- Mail de test ----
export function testMail({ publicUrl = '' } = {}) {
  const hero = `${pill('Test', C.cy)}${h1('Brevo fonctionne &#9989;')}${lead('Ce mail confirme que l&rsquo;envoi est bien configur&eacute;. Voil&agrave; &agrave; quoi ressembleront tes alertes.')}`;
  return layout({ title: 'Test', preheader: 'L’envoi des mails est bien configuré.', hero, body: `<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.mut};">Mail de test envoy&eacute; depuis la console admin.</p>`, publicUrl });
}
export const testText = () => `Brevo fonctionne. Ce mail de test confirme que l'envoi est bien configuré.\n\n--\nRadar serveurs, par ${AUTHOR}`;

// ---- Lien magique pour modifier son alerte ----
export function manageMail({ url, count = 0, publicUrl = '' }) {
  const hero = `${pill('Gestion', C.cy)}${h1('Modifie ton alerte<br>en un clic')}${lead(`Tu as demand&eacute; &agrave; changer les serveurs que tu surveilles${count ? ` (${count} actuellement)` : ''}. Ce lien t&rsquo;ouvre directement ta page, sans mot de passe.`)}`;
  const body = `${button(url, 'Modifier mon alerte &rarr;')}
<div style="margin:10px 0 28px;font-family:${FONT};font-size:12px;color:${C.dim};">Le bouton ne marche pas ? Copie ce lien : <a href="${esc(url)}" style="color:${C.cy};word-break:break-all;">${esc(url)}</a></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card2};border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:14px 16px;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.mut};">&#128274;&nbsp; <b style="color:${C.fg};">Lien personnel, valable 1 heure.</b> Ne le transmets &agrave; personne. Tu n&rsquo;as rien demand&eacute; ? Ignore ce message, rien ne change.</td></tr></table>`;
  return layout({ title: 'Modifier mon alerte', preheader: 'Ton lien personnel pour changer tes serveurs surveillés.', hero, body, publicUrl });
}
export const manageText = ({ url, publicUrl = '' }) => `Modifie ton alerte en un clic

Ouvre ce lien personnel (valable 1 heure, sans mot de passe) pour changer les serveurs que tu surveilles :
${url}

Tu n'as rien demandé ? Ignore ce message, rien ne change.

--
Radar serveurs, par ${AUTHOR}${publicUrl ? `\nConditions d'utilisation : ${publicUrl}/conditions` : ''}
${TERMS}`;
