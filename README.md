# serveurovhdispo

Site d'alertes par mail : tu coches les serveurs qui t'intéressent (OVH VPS, Hetzner Cloud, Scaleway, en Europe), et tu reçois un mail dès qu'ils sont de nouveau en stock.

Cloudflare Worker (cron toutes les 5 min) + D1 (inscrits, état du scan, journal) + KV (réglages) + Brevo pour les mails.

## Installation

```bash
npm install
npx wrangler login
npx wrangler kv namespace create KV     # copie l'id dans wrangler.toml
npx wrangler d1 create serveurovhdispo  # copie le database_id dans wrangler.toml
```

Les tables D1 se créent toutes seules au premier lancement. Si tu viens d'une ancienne version (inscrits dans le KV), ils sont repris automatiquement dans D1, une seule fois. Les sessions admin sont réinitialisées : reconnecte-toi.

Édite `wrangler.toml` : `MAIL_FROM` et `PUBLIC_URL`.

### Secrets

```bash
npx wrangler secret put BREVO_API_KEY   # clé API Brevo (gratuit, 300 mails/jour)
npx wrangler secret put HCLOUD_TOKEN    # token Hetzner Cloud en LECTURE SEULE
```

- **Brevo** : crée un compte sur brevo.com, valide ton adresse expéditrice (`MAIL_FROM`), puis SMTP & API > clé API.
- **Hetzner** : console.hetzner.cloud > ton projet > Sécurité > Jetons API > « Lecture seule ». L'API Hetzner exige un token même pour lire les disponibilités. Sans lui, seul OVH est surveillé.

### Déploiement

```bash
npm run deploy
```

Le site est ensuite disponible sur l'URL `*.workers.dev` affichée par wrangler. Mets cette URL dans `PUBLIC_URL` puis redéploie.

## Fonctionnement

- OVH : catalogue public + règles de commande par datacenter, filtrés sur les datacenters européens (GRA, SBG, RBX, WAW, DE, UK...).
- Hetzner : `/datacenters` filtré sur la zone `eu-central` (Nuremberg, Falkenstein, Helsinki), types « shared ».
- Scaleway : types d'instances par zone (Paris, Amsterdam, Varsovie), clé secrète API requise (optionnelle).
- Un mail est envoyé quand une offre surveillée passe en dispo. Quand elle repasse indispo, l'alerte se réarme.
- Inscription avec confirmation par mail, lien de désinscription dans chaque alerte.

## Pourquoi D1 plutôt que le KV

Le KV gratuit autorise 1 000 écritures par jour, ce qu'un scan toutes les 5 minutes dépasse vite, et il ne gère pas bien les modifications simultanées. D1 (gratuit : 100 000 écritures et 5 millions de lectures par jour) stocke une ligne par inscrit et une par offre suivie : chaque changement est atomique, il n'y a plus de plafond d'inscrits à 300, et le scan n'écrit que ce qui a changé. Le KV ne garde que les réglages et l'accès admin.

Limites du plan gratuit à connaître : 50 requêtes D1 et 50 appels externes (dont chaque mail) par passage. Au-delà d'environ 40 mails dans un même scan, les suivants partent au scan d'après (5 minutes plus tard), rien n'est perdu.

## Modifier son alerte (côté inscrit)

Page `/manage` : l'inscrit entre son mail, reçoit un lien personnel (valable 1 h, sans mot de passe), et peut changer ses serveurs ou supprimer son alerte. Le lien est dans un `#` (jamais envoyé aux serveurs ni dans les logs). La réponse est identique que l'adresse existe ou non, avec limites de requêtes par IP et par adresse. Se réinscrire avec une adresse déjà active n'écrase plus rien : ça renvoie ce lien. Les inscriptions jamais confirmées sont supprimées au bout de 7 jours.

## Console admin

Va sur `/admin` juste après le déploiement : au premier accès, tu choisis ton mot de passe admin (fais-le tout de suite). Ensuite tout se règle depuis la console : clé Brevo, adresse expéditeur, token Hetzner, webhook Discord, pause des alertes, liste des inscrits, scan manuel et mail de test. Les valeurs sont stockées dans le KV, plus besoin de `wrangler secret`.

## Cacher ton adresse perso dans les mails

Si l'expéditeur est un Gmail, Brevo affiche `toi@12345.brevosend.com` et met ton Gmail en « répondre à ». Pour l'éviter : crée une adresse dédiée (ou utilise ton propre domaine, idéalement authentifié dans Brevo), valide-la comme expéditeur, puis renseigne-la dans Réglages. Le champ « Adresse de réponse » te permet aussi d'imposer un autre « répondre à ».
