export async function sendMail(cfg, { to, subject, html }) {
  if (!cfg.brevoKey || !cfg.mailFrom) throw new Error('Brevo non configuré (admin)');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cfg.brevoKey, 'content-type': 'application/json' },
    body: JSON.stringify({ sender: { email: cfg.mailFrom, name: 'Alertes serveurs' }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status} ${(await r.text()).slice(0, 200)}`);
}
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
