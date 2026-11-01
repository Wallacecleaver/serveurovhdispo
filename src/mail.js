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
