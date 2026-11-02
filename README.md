# serveurovhdispo

Site d'alertes par mail : tu coches les serveurs qui t'intéressent (OVH VPS, Hetzner Cloud, Scaleway, en Europe), et tu reçois un mail dès qu'ils sont de nouveau en stock.

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
- Scaleway : types d'instances par zone (Paris, Amsterdam, Varsovie), clé secrète API requise (optionnelle).
- Un mail est envoyé quand une offre surveillée passe en dispo. Quand elle repasse indispo, l'alerte se réarme.
- Inscription avec confirmation par mail, lien de désinscription dans chaque alerte.

## Console admin

Va sur `/admin` juste après le déploiement : au premier accès, tu choisis ton mot de passe admin (fais-le tout de suite). Ensuite tout se règle depuis la console : clé Brevo, adresse expéditeur, token Hetzner, webhook Discord, pause des alertes, liste des inscrits, scan manuel et mail de test. Les valeurs sont stockées dans le KV, plus besoin de `wrangler secret`.

## Cacher ton adresse perso dans les mails

Si l'expéditeur est un Gmail, Brevo affiche `toi@12345.brevosend.com` et met ton Gmail en « répondre à ». Pour l'éviter : crée une adresse dédiée (ou utilise ton propre domaine, idéalement authentifié dans Brevo), valide-la comme expéditeur, puis renseigne-la dans Réglages. Le champ « Adresse de réponse » te permet aussi d'imposer un autre « répondre à ».
