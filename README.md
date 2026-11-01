# Archive

Een privé referentie-archief voor architecten: collecties met media, leeslijst, notities, quotes, tags, groepen en gedeelde collecties. Draait op **Cloudflare Pages + Functions**, **Turso/libSQL** voor relationele data en **Cloudflare R2** voor bestanden en wordt vanuit **GitHub** automatisch gepubliceerd.

```
public/                 de website (index.html, afbeeldingen, seed.json met voorbeeldgegevens)
functions/api/[[path]].js   de server (alle /api/-routes: inloggen, gegevens, uploads, delen, link-voorbeeld)
migrations/0001_init.sql    het SQLite-databaseschema voor Turso (en D1-fallback)
tests/api.test.mjs          integratietest voor de server
wrangler.toml.example       alleen nodig voor lokaal ontwikkelen
```

## Wat is er allemaal in gebouwd

- **Accounts:** registreren, inloggen, uitloggen, profiel, wachtwoord wijzigen, account verwijderen. Wachtwoorden worden op de server met PBKDF2 (SHA-256, 100.000 iteraties, eigen salt) opgeslagen, de sessie zit in een HttpOnly-cookie en pogingen worden beperkt.
- **Gegevens:** collecties, media, notities, quotes, leeslijst, groepen en tags worden automatisch bewaard in Turso/libSQL (per gebruiker, met versiecontrole zodat een oud tabblad niets overschrijft).
- **Afbeeldingen:** elke upload, plak- of sleepactie gaat naar R2 (max. 6 MB per bestand; jpg, png, webp, gif, avif of pdf). Bestanden zijn alleen zichtbaar voor de eigenaar en voor leden van een gedeelde collectie.
- **Delen:** collecties delen via een uitnodigingslink (of automatisch per e-mail), leden voegen samen media toe, tags worden gedeeld, wijzigingen verschijnen binnen ~15 seconden bij de anderen. Rechten zitten in de server: leden mogen alleen eigen items bewerken of verwijderen en kunnen de collectie niet hernoemen of verwijderen.
- **Link-voorbeeld:** bij een geplakte link haalt de server titel, beschrijving en voorbeeldafbeelding op en bewaart de afbeelding in R2.
- **Rest:** zoeken op naam en tags, Nederlands/Engels, 6 achtergronden, browserknop ("Bewaar in Archive"), voorbeeldgegevens laden voor een lege start.

---

## Stap 1 — de code in GitHub zetten

1. Maak op github.com een **nieuwe, lege repository** (bijvoorbeeld `archive`, privé mag).
2. Open de repository en kies **Add file → Upload files**.
3. Sleep **de inhoud van deze map** erin (de mappen `public`, `functions`, `migrations`, `tests` en de losse bestanden). Pak de ZIP dus eerst uit. De webinterface van GitHub accepteert maximaal 100 bestanden per keer; dit pakket bevat er ongeveer 40.
4. Klik op **Commit changes**.

Liever de opdrachtregel? `git init && git add . && git commit -m "Archive" && git remote add origin <jouw-repo-url> && git push -u origin main`.

## Stap 2 — de database en de bestandsopslag aanmaken

In [Turso](https://turso.tech/):

1. Maak een database aan, bijvoorbeeld `archive`, en kies een Europese regio.
2. Maak een database auth token aan. Bewaar de database URL (`libsql://...`) en het token; voeg die later als Cloudflare secrets toe.
3. Open de SQL-console van Turso en voer de volledige inhoud van `migrations/0001_init.sql` uit. Het schema gebruikt SQLite en maakt de tabellen voor accounts, sessies, werkruimte en gedeelde collecties aan.

Maak daarnaast in het [Cloudflare-dashboard](https://dash.cloudflare.com) onder **Storage & databases → R2 object storage** een bucket `archive-files` aan.

## Stap 3 — GitHub koppelen aan Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git** en kies je GitHub-repository.
2. Bouwinstellingen:
   - Framework preset: **None**
   - Build command: **leeg laten**
   - Build output directory: **`public`**
3. Klik op **Save and Deploy**. De eerste keer geeft de site nog een melding dat de server niet is ingesteld; dat lossen de volgende stappen op.

## Stap 4 — de koppelingen (bindings) instellen

In je Pages-project: **Settings → Variables and Secrets**, voor zowel **Production** als **Preview**:

| Type | Naam (exact zo) | Waarde |
|------|-----------------|--------|
| Secret | `TURSO_DATABASE_URL` | je Turso database URL (`libsql://...`) |
| Secret | `TURSO_AUTH_TOKEN` | het database auth token |
| R2 bucket | `FILES` | `archive-files` |

Daarna: **Deployments → Retry deployment** (of maak een kleine wijziging in GitHub). Open je site (`https://jouwproject.pages.dev`), registreer je account en alles werkt.

**Optioneel** onder *Settings → Variables and Secrets*:

| Naam | Doel |
|------|------|
| `APP_ORIGIN` | het volledige adres van je site, bijvoorbeeld `https://archive.jouwdomein.be` (gebruikt in uitnodigingsmails) |
| `RESEND_API_KEY` en `MAIL_FROM` | uitnodigingen automatisch per e-mail versturen via [Resend](https://resend.com). Zonder deze waarden toont de site een uitnodigingslink die je kopieert of via je eigen mailprogramma verstuurt. |

## Stap 5 — eigen domeinnaam (optioneel)

Pages-project → **Custom domains → Set up a custom domain**. Cloudflare regelt het https-certificaat.

---

## Lokaal ontwikkelen en testen

```bash
npm install
cp wrangler.toml.example wrangler.toml      # D1-fallback voor lokaal gebruik
# Zet TURSO_DATABASE_URL en TURSO_AUTH_TOKEN in .dev.vars om lokaal Turso te gebruiken
npm run db:local                            # maakt de lokale D1-fallback aan
npm run dev                                 # http://localhost:8788
# in een tweede venster:
npm test                                    # 14 testgroepen voor de server
```

## Goed om te weten

- **Gratis niveau:** Pages-functies tellen 100.000 aanvragen per dag. De site vraagt alleen `/api/*` aan de server (zie `public/_routes.json`); de rest zijn gewone bestanden. Turso en R2 hebben eigen limieten en tarieven; controleer de actuele cijfers bij de aanbieders.
- **Grootte van je gegevens:** per gebruiker worden de gegevens in 6 blokken bewaard (collecties, media, notities, quotes, leeslijst, groepen) van elk maximaal ongeveer 1,9 MB tekst. Afbeeldingen tellen daar niet in mee. Voor een persoonlijk archief met duizenden items is dat ruim voldoende.
- **Meerdere apparaten:** wijzigingen worden binnen een seconde of twee opgeslagen. Open je het archief op twee toestellen tegelijk en bewerk je beide, dan wint de eerste opslag en herlaadt de tweede met de nieuwste gegevens.
- **Back-ups:** Maak regelmatig een export van Turso en bewaar die los van de database.
- **Beveiliging:** schakel in Cloudflare onder *Security → WAF → Rate limiting rules* eventueel een extra regel in voor `/api/auth/*`. Wachtwoorden verlaten nooit je server leesbaar. Een gebruiker kan zijn account en alle bestanden zelf definitief verwijderen via Account.
- **Privacy (AVG):** voeg een privacyverklaring toe als anderen de site gebruiken en kies bij Turso een Europese database-regio. Instagram- en Pinterest-afbeeldingen blijven van de makers: gebruik ze alleen als je daar de rechten voor hebt.
- **Foutmelding "De server is nog niet ingesteld":** de secrets `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` of de fallback-binding `DB`, of de binding `FILES`, ontbreken of de deployment is nog niet opnieuw uitgevoerd (stap 4).


## Turso instellen

1. Maak een database aan via [Turso](https://turso.tech/) en kies een Europese regio.
2. Maak een database auth token aan en bewaar de database URL (`libsql://...`) en het token.
3. Voer `migrations/0001_init.sql` uit op de nieuwe database; het schema gebruikt SQLite en is compatibel met Turso.
4. Voeg in Cloudflare Pages → **Settings → Variables and Secrets** voor Production én Preview de secrets `TURSO_DATABASE_URL` en `TURSO_AUTH_TOKEN` toe.
5. Laat de bestaande R2-binding `FILES` actief. Als beide Turso-secrets aanwezig zijn, gebruikt de API Turso; anders blijft de bestaande D1-binding `DB` als fallback beschikbaar.

**Bestaande D1-data overzetten:** maak eerst een backup en voer de export/import uit vóór je de Turso-secrets activeert:

```bash
npx wrangler d1 export archive-db --remote --output archive-d1-backup.sql
# Maak de Turso database en voer daarna de export in:
turso db shell archive < archive-d1-backup.sql
```

Vervang `archive-db` en `archive` door de namen van jouw D1- en Turso-database. Controleer in Turso of de tabellen en aantallen overeenkomen. Bewaar D1 als rollback totdat de migratie gevalideerd is. De code schakelt niet automatisch data over; activeer Turso pas nadat de import geslaagd is.

**Sociale links:** Archive leest publiek beschikbare Open Graph-metadata. Pinterest-pins krijgen waar mogelijk een lokale thumbnail in R2 en gebruiken anders de officiële Pinterest embed. Instagram-posts worden niet als afbeelding gekopieerd; Archive toont de officiële Instagram embed. Privéposts en content waarvoor het platform toegang weigert, blijven alleen als link zichtbaar.
