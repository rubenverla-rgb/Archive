# Archive

Een privé referentie-archief voor architecten: collecties met media, leeslijst, notities, quotes, tags, groepen en gedeelde collecties. De applicatie draait op **Vercel Functions**, gebruikt **Turso/libSQL** voor relationele gegevens en **Vercel Blob** voor privébestanden.

```
public/                    website (index.html, afbeeldingen en seed.json)
api/[...path].js           Vercel API-ingang voor alle /api/-routes
functions/api/[[path]].js  gedeelde API-logica (auth, gegevens, uploads, delen en previews)
functions/lib/turso.js     Turso/libSQL-adapter
functions/lib/blob.js      Vercel Blob-adapter
migrations/0001_init.sql   SQLite-schema voor Turso
tests/api.test.mjs         API-integratietests
```

## Functionaliteit

- Accounts, sessies, profiel en wachtwoordbeheer.
- Persoonlijke collecties, media, notities, quotes, leeslijst, groepen en tags.
- Privé uploads van afbeeldingen en PDF's via Vercel Blob.
- Bestanden worden alleen geleverd via de API na controle van de gebruiker en gedeelde-collectierechten.
- Gedeelde collecties met uitnodigingen en leden.
- Linkvoorbeelden voor ondersteunde websites.
- Optionele uitnodigingsmails via Resend.

## 1. Turso instellen

1. Maak een database aan in [Turso](https://turso.tech/) en kies bij voorkeur een Europese regio.
2. Maak een database auth token aan.
3. Voer de volledige inhoud van `migrations/0001_init.sql` uit in de Turso SQL-console.
4. Voeg in Vercel de volgende environment variables toe voor Production, Preview en Development:

| Naam | Waarde |
|---|---|
| `TURSO_DATABASE_URL` | Je Turso database URL (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | Je Turso auth token |

## 2. Vercel Blob instellen

1. Open je Vercel-team en ga naar **Storage**.
2. Maak een **Blob Store** aan met toegang **Private**.
3. Koppel de Blob Store aan het Vercel-project `archive`.
4. Controleer dat Vercel de variabelen `BLOB_READ_WRITE_TOKEN` en `BLOB_STORE_ID` aan het project beschikbaar maakt.
5. Zorg dat de store gekoppeld is aan zowel Preview als Production waar je de app wilt testen.

De applicatie uploadt bestanden als private blobs. De browser krijgt geen publieke opslaglink: bestanden worden via `/api/file/...` opgevraagd en de API controleert eerst de sessie en toegangsrechten.

## 3. Optionele e-mailinstellingen

Voeg eventueel deze variabelen toe voor uitnodigingsmails:

| Naam | Doel |
|---|---|
| `RESEND_API_KEY` | API-sleutel van Resend |
| `MAIL_FROM` | Geverifieerd afzenderadres |
| `APP_ORIGIN` | `https://archive-ruben26.vercel.app` |

## 4. Deploy en testen

Vercel deployt automatisch wanneer de gekoppelde GitHub-branch wordt bijgewerkt. Test na de deployment:

1. Open `/api/me`; zonder sessie hoort de API `{"user":null}` terug te geven.
2. Registreer een testaccount en log in.
3. Maak een collectie en upload een afbeelding.
4. Controleer dat de afbeelding na herladen nog zichtbaar is.
5. Test ook het delen van een collectie en de toegang tot gedeelde afbeeldingen.

Vercel server uploads hebben een limiet van ongeveer 4,5 MB per request. Archive houdt daarom een uploadlimiet van 4 MB aan.

## Privacy en back-ups

- Kies een Europese Turso-regio als je gegevens in Europa wilt bewaren.
- Blob-opslag staat op **Private**; maak de bestanden niet publiek toegankelijk.
- Maak regelmatig een export/back-up van Turso.
- Voeg een privacyverklaring toe als andere mensen Archive gebruiken.
- Instagram- en Pinterest-content blijft onder de voorwaarden en rechten van de oorspronkelijke platforms en makers vallen.

## Lokaal ontwikkelen

Installeer de dependencies met `npm install`, stel de Turso-variabelen in je lokale omgeving in en start met `npm run dev`. Voor lokale Blob-tests moet een Vercel Blob-store-token beschikbaar zijn.
