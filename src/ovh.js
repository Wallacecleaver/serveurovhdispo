// OVH VPS : catalogue public + regles de commande (API publique, sans authentification)
const API = 'https://eu.api.ovh.com/v1';
const SUBSIDIARY = 'FR';
// Datacenters situes en Europe
const EU_DC = /^(GRA|SBG|RBX|WAW|LIM|FRA|DE|UK|FR|PL)/i;
const MAX_PLANS = 40;

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`OVH ${r.status} ${url}`);
  return r.json();
}

function monthlyPrice(plan) {
  const p = (plan.pricings || []).find(
    (x) => x.interval === 1 && (x.capacities || []).includes('renew'),
  );
  return p ? Math.round(p.price / 1e6) / 100 : null; // prix OVH en 1e-8 EUR
}

export async function fetchOvh() {
  const catalog = await getJson(`${API}/order/catalog/public/vps?ovhSubsidiary=${SUBSIDIARY}`);
  let plans = (catalog.plans || []).filter((p) => /^vps-/.test(p.planCode));
  // Par defaut : uniquement les gammes recentes (vps-2025-..., vps-2027-...), sinon tout
  const recent = plans.filter((p) => /^vps-\d{4}-/.test(p.planCode));
  if (recent.length) plans = recent;
  plans = plans.slice(0, MAX_PLANS);

  const results = await Promise.all(
    plans.map(async (p) => {
      try {
        const rule = await getJson(
          `${API}/vps/order/rule/datacenter?ovhSubsidiary=${SUBSIDIARY}&planCode=${encodeURIComponent(p.planCode)}`,
        );
        const dcs = Array.isArray(rule) ? rule : rule.datacenters || [];
        const locations = dcs
          .filter((d) => EU_DC.test(String(d.datacenter || d.name || '')))
          .filter((d) => (d.linuxStatus || d.status) === 'available')
          .map((d) => String(d.datacenter || d.name).toUpperCase());
        return {
          key: `ovh:${p.planCode}`,
          provider: 'ovh',
          label: p.invoiceName || p.planCode,
          price: monthlyPrice(p),
          locations,
        };
      } catch (e) {
        console.log('ovh plan error', p.planCode, e.message);
        return null;
      }
    }),
  );
  return results.filter(Boolean);
}
