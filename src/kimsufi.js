// Kimsufi / So you Start / Rise (serveurs dedies OVH) : API publique, sans authentification
const API = 'https://eu.api.ovh.com/v1';
const SUBSIDIARY = 'FR';
// Datacenters europeens (on exclut Canada, Singapour, Australie, US...)
const EU_DC = /^(gra|sbg|rbx|fra|lon|waw|lim|par|gsw|eri|dc)/i;
const MAX_OFFERS = 80;

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`OVH dédiés ${r.status}`);
  return r.json();
}

const monthly = (plan) => {
  const p = (plan?.pricings || []).find((x) => x.interval === 1 && (x.capacities || []).includes('renew'));
  return p ? Math.round(p.price / 1e6) / 100 : null; // prix OVH en 1e-8 EUR
};

export async function fetchKimsufi() {
  const [avail, catalog] = await Promise.all([
    getJson(`${API}/dedicated/server/datacenter/availabilities`),
    getJson(`${API}/order/catalog/public/eco?ovhSubsidiary=${SUBSIDIARY}`).catch(() => ({ plans: [] })),
  ]);
  const plans = Object.fromEntries((catalog.plans || []).map((p) => [p.planCode, p]));
  const offers = [];
  for (const a of avail || []) {
    const fqn = a.fqn || [a.planCode, a.memory, a.storage].filter(Boolean).join('.');
    if (!fqn || !a.planCode) continue;
    const plan = plans[a.planCode];
    // Sans entree dans le catalogue "eco" ce n'est pas une offre Kimsufi/So you Start/Rise
    if (!plan) continue;
    const locations = (a.datacenters || [])
      .filter((d) => EU_DC.test(String(d.datacenter || '')))
      .filter((d) => !['unavailable', 'unknown'].includes(String(d.availability)))
      .map((d) => String(d.datacenter).toUpperCase());
    const specs = fqn.split('.').slice(1).join(' · ');
    offers.push({
      key: `kimsufi:${fqn}`,
      provider: 'kimsufi',
      label: `${plan.invoiceName || a.planCode}${specs ? ' - ' + specs : ''}`,
      price: monthly(plan),
      locations: [...new Set(locations)],
    });
  }
  return offers.sort((x, y) => (x.price ?? 1e9) - (y.price ?? 1e9)).slice(0, MAX_OFFERS);
}
