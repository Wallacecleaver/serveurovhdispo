// Hetzner Cloud : necessite un token API en lecture seule (gratuit, cree dans un projet Cloud)
const API = 'https://api.hetzner.cloud/v1';

async function hc(path, token) {
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Hetzner ${r.status} ${path}`);
  return r.json();
}

export async function fetchHetzner(token) {
  if (!token) throw new Error('HCLOUD_TOKEN manquant');
  const [dcs, types] = await Promise.all([
    hc('/datacenters', token),
    hc('/server_types?per_page=50', token),
  ]);

  // Datacenters europeens uniquement (Allemagne, Finlande)
  const eu = dcs.datacenters.filter((d) => d.location.network_zone === 'eu-central');
  const now = Date.now();

  return types.server_types
    .filter((t) => t.cpu_type === 'shared')
    .filter((t) => !t.deprecation || new Date(t.deprecation.unavailable_after).getTime() > now)
    .map((t) => {
      const locations = eu
        .filter((d) => d.server_types.available.includes(t.id))
        .map((d) => d.location.name.toUpperCase());
      const price = t.prices?.find((p) => p.location.startsWith('nbg') || p.location.startsWith('fsn'));
      return {
        key: `hetzner:${t.name}`,
        provider: 'hetzner',
        label: `${t.name.toUpperCase()} - ${t.cores} vCPU, ${t.memory} Go RAM, ${t.disk} Go`,
        price: price ? Math.round(parseFloat(price.price_monthly.gross) * 100) / 100 : null,
        locations: [...new Set(locations)],
      };
    })
    .sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
}
