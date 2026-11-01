# serveurovhdispo

Site d'alertes par mail : tu coches les VPS OVH (Europe) ou Hetzner Cloud (Europe) qui t'intéressent, et tu reçois un mail dès qu'ils sont de nouveau en stock.

Cloudflare Worker (cron toutes les 5 min) + KV pour stocker les inscrits + Brevo pour les mails.

## Installation

```bash
npm install
npx wrangler login
npx wrangler kv namespace create KV     # copie l'id dans wrangler.toml
```

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
- Un mail est envoyé quand une offre surveillée passe en dispo. Quand elle repasse indispo, l'alerte se réarme.
- Inscription avec confirmation par mail, lien de désinscription dans chaque alerte.
