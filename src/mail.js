export async function sendMail(cfg, { to, subject, html }) {
  if (!cfg.brevoKey || !cfg.mailFrom) throw new Error('Brevo non configuré : colle la clé dans Réglages puis clique sur Enregistrer');
  const body = { sender: { email: cfg.mailFrom, name: cfg.mailName || 'Alertes serveurs' }, to: [{ email: to }], subject, htmlContent: html };
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

// ---------- gabarits de mails (HTML en tableaux + styles en ligne, compatible Gmail/Outlook) ----------
const C = { bg: '#070812', card: '#0e1020', card2: '#141733', line: '#262a52', fg: '#e9ecff', mut: '#9aa0c7', cy: '#3de7ff', vi: '#8a5cff', ok: '#3dffa8' };
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function layout({ preheader, title, inner, footer }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};font-size:1px;line-height:1px;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 14px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${C.cy};">&#9673;&nbsp; Radar serveurs</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-top:3px solid ${C.vi};border-radius:16px;padding:32px 28px;font-family:${FONT};color:${C.fg};">${inner}</td></tr>
<tr><td style="padding:18px 10px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.mut};text-align:center;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;"><tr><td style="border-radius:10px;background:${C.cy};"><a href="${esc(href)}" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:#04121a;text-decoration:none;border-radius:10px;">${label}</a></td></tr></table>`;
const h1 = (t) => `<h1 style="margin:0 0 14px;font-family:${FONT};font-size:28px;line-height:1.2;font-weight:800;color:${C.fg};">${t}</h1>`;
const p = (t, extra = '') => `<p style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.mut};${extra}">${t}</p>`;

// Mail de confirmation d'inscription. names = noms des offres choisies.
export function confirmMail({ url, names = [], siteUrl = '' }) {
  const shown = names.slice(0, 5).map((n) => `<tr><td style="padding:7px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;color:${C.fg};"><span style="color:${C.ok};">&#10003;</span>&nbsp; ${esc(n)}</td></tr>`).join('');
  const more = names.length > 5 ? `<tr><td style="padding:8px 0 0;font-family:${FONT};font-size:14px;color:${C.mut};">+ ${names.length - 5} autre${names.length - 5 > 1 ? 's' : ''}</td></tr>` : '';
  const n = names.length;
  const inner = `${h1('Plus qu\u2019une étape &#128075;')}
${p(`Tu as choisi de surveiller <b style="color:${C.fg};">${n} serveur${n > 1 ? 's' : ''}</b>. Confirme ton adresse pour activer les alertes : on te prévient par mail dès que l\u2019un d\u2019eux est en stock.`)}
${n ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;background:${C.card2};border-radius:12px;padding:6px 16px;display:table;">${shown}${more}</table>` : ''}
${button(url, 'Confirmer mon adresse &rarr;')}
${p(`Le bouton ne marche pas ? Copie ce lien dans ton navigateur :<br><a href="${esc(url)}" style="color:${C.cy};word-break:break-all;font-size:13px;">${esc(url)}</a>`, 'font-size:13px;margin-top:14px;')}`;
  return layout({
    title: 'Confirme ton alerte serveur',
    preheader: 'Un clic pour activer tes alertes de stock.',
    inner,
    footer: `Tu n\u2019as rien demandé ? Ignore simplement ce message : rien ne sera activé.${siteUrl ? `<br><a href="${esc(siteUrl)}" style="color:${C.mut};">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>` : ''}`,
  });
}

// Mail d'alerte de stock. hits = [{label, price, locations, order, providerName}]
export function alertMail({ hits, unsubUrl, siteUrl = '' }) {
  const cards = hits.map((o) => {
    const [name, ...rest] = o.label.split(' - ');
    const specs = rest.join(' - ');
    const pills = o.locations.map((l) => `<span style="display:inline-block;margin:6px 6px 0 0;padding:3px 10px;border:1px solid ${C.ok};border-radius:99px;font-size:12px;font-weight:600;color:${C.ok};">${esc(l)}</span>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:${C.card2};border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:18px 18px 16px;font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:18px;font-weight:700;color:${C.fg};">${esc(name)}<span style="margin-left:8px;padding:2px 8px;border:1px solid ${C.line};border-radius:99px;font-size:11px;font-weight:600;color:${C.mut};">${esc(o.providerName || '')}</span></td>
<td align="right" style="font-size:18px;font-weight:700;color:${C.fg};white-space:nowrap;">${o.price ? `${esc(String(o.price).replace('.', ','))}&nbsp;&euro;<span style="font-size:12px;font-weight:400;color:${C.mut};">/mois</span>` : ''}</td></tr></table>
${specs ? `<div style="margin-top:4px;font-size:14px;color:${C.mut};">${esc(specs)}</div>` : ''}
<div>${pills}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr><td style="border-radius:8px;background:${C.cy};"><a href="${esc(o.order)}" style="display:inline-block;padding:10px 20px;font-size:14px;font-weight:700;color:#04121a;text-decoration:none;border-radius:8px;">Commander &rarr;</a></td></tr></table>
</td></tr></table>`;
  }).join('');
  const n = hits.length;
  const inner = `${h1(`&#128640; ${n > 1 ? `${n} serveurs sont dispo` : 'Un serveur est dispo'} !`)}
${p('Du stock vient de revenir. Ça part vite : commande sans tarder.')}
${cards}`;
  return layout({
    title: 'Serveur dispo',
    preheader: hits.map((h) => h.label.split(' - ')[0]).join(', ') + ' : de retour en stock.',
    inner,
    footer: `Tu reçois ce mail car tu as activé une alerte.<br><a href="${esc(unsubUrl)}" style="color:${C.mut};">Se désinscrire</a>${siteUrl ? ` &nbsp;&middot;&nbsp; <a href="${esc(siteUrl)}" style="color:${C.mut};">Modifier mes alertes</a>` : ''}`,
  });
}

export function testMail() {
  return layout({ title: 'Test', preheader: 'Brevo fonctionne.', inner: `${h1('&#9989; Brevo fonctionne')}${p('Ce mail de test confirme que l\u2019envoi est bien configuré.')}`, footer: 'Mail de test envoyé depuis la console admin.' });
}
