// Scaleway Instances : necessite une cle secrete API (Scaleway exige un token meme en lecture)
const API = 'https://api.scaleway.com/instance/v1/zones';
// Zones europeennes
const ZONES = ['fr-par-1', 'fr-par-2', 'fr-par-3', 'nl-ams-1', 'nl-ams-2', 'nl-ams-3', 'pl-waw-1', 'pl-waw-2', 'pl-waw-3'];
// Gammes classiques (on ignore GPU, bare metal, etc.)
const KEEP = /^(DEV1|GP1|PLAY2|PRO2|STARDUST1|ENT1|POP2)/;

async function sc(path, token) {
  const r = await fetch(`${API}/${path}`, { headers: { 'X-Auth-Token': token, accept: 'application/json' } });
  if (!r.ok) throw new Error(`Scaleway ${r.status} ${path.split('/')[0]}`);
  return r.json();
}

export async function fetchScaleway(token) {
  if (!token) throw new Error('Clé Scaleway manquante');
  const [specs, ...zones] = await Promise.all([
    sc('fr-par-1/products/servers', token),
    ...ZONES.map((z) => sc(`${z}/products/servers/availability`, token).then((d) => [z, d.servers || {}]).catch(() => [z, null])),
  ]);
  const ok = zones.filter(([, d]) => d);
  if (!ok.length) throw new Error('Scaleway : aucune zone lisible');
  return Object.entries(specs.servers || {})
    .filter(([name]) => KEEP.test(name))
    .map(([name, s]) => {
      const locations = ok
        .filter(([, d]) => ['available', 'scarce'].includes(d[name]?.availability))
        .map(([z]) => z.toUpperCase());
      const ram = s.ram ? Math.round(s.ram / 1024 ** 3) : null;
      return {
        key: `scaleway:${name}`,
        provider: 'scaleway',
        label: `${name} - ${s.ncpus} vCPU${ram ? `, ${ram} Go RAM` : ''}`,
        price: s.monthly_price ? Math.round(s.monthly_price * 100) / 100 : null,
        locations,
      };
    })
    .sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
}
