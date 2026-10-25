# Archive

Een privé referentie-archief voor architecten: collecties met media, leeslijst, notities, quotes, tags, groepen en gedeelde collecties. Draait volledig op **Cloudflare** (Pages + Functions, D1-database, R2-bestandsopslag) en wordt vanuit **GitHub** automatisch gepubliceerd.

```
public/                 de website (index.html, afbeeldingen, seed.json met voorbeeldgegevens)
functions/api/[[path]].js   de server (alle /api/-routes: inloggen, gegevens, uploads, delen, link-voorbeeld)
migrations/0001_init.sql    het databaseschema voor D1
tests/api.test.mjs          integratietest voor de server
wrangler.toml.example       alleen nodig voor lokaal ontwikkelen
```

## Wat is er allemaal in gebouwd

- **Accounts:** registreren, inloggen, uitloggen, profiel, wachtwoord wijzigen, account verwijderen. Wachtwoorden worden op de server met PBKDF2 (SHA-256, 100.000 iteraties, eigen salt) opgeslagen, de sessie zit in een HttpOnly-cookie en pogingen worden beperkt.
- **Gegevens:** collecties, media, notities, quotes, leeslijst, groepen en tags worden automatisch bewaard in D1 (per gebruiker, met versiecontrole zodat een oud tabblad niets overschrijft).
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

In het [Cloudflare-dashboard](https://dash.cloudflare.com):

1. **Storage & databases → D1 SQL database → Create.** Geef de database de naam `archive-db`. Kies eventueel een locatiehint in Europa.
2. Open de database en ga naar het tabblad **Console**. Plak de volledige inhoud van `migrations/0001_init.sql` en voer uit. Lukt dat in één keer niet, plak de blokken dan één voor één (elk `CREATE TABLE`/`CREATE INDEX` apart). Daarna staan er 8 tabellen.
3. **Storage & databases → R2 object storage → Create bucket.** Naam: `archive-files`. (R2 vraagt een betaalmethode, maar blijft binnen het gratis niveau gratis.)

## Stap 3 — GitHub koppelen aan Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git** en kies je GitHub-repository.
2. Bouwinstellingen:
   - Framework preset: **None**
   - Build command: **leeg laten**
   - Build output directory: **`public`**
3. Klik op **Save and Deploy**. De eerste keer geeft de site nog een melding dat de server niet is ingesteld; dat lossen de volgende stappen op.

## Stap 4 — de koppelingen (bindings) instellen

In je Pages-project: **Settings → Bindings** (of *Functions → Bindings*), voor zowel **Production** als **Preview**:

| Type | Naam (exact zo) | Waarde |
|------|-----------------|--------|
| D1 database | `DB` | `archive-db` |
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
cp wrangler.toml.example wrangler.toml      # lokaal mag database_id elke UUID zijn
npm run db:local                            # maakt de lokale database aan
npm run dev                                 # http://localhost:8788
# in een tweede venster:
npm test                                    # 14 testgroepen voor de server
```

## Goed om te weten

- **Gratis niveau:** Pages-functies tellen 100.000 aanvragen per dag. De site vraagt alleen `/api/*` aan de server (zie `public/_routes.json`); de rest zijn gewone bestanden. D1 en R2 hebben ruime gratis limieten, controleer de actuele cijfers op cloudflare.com.
- **Grootte van je gegevens:** per gebruiker worden de gegevens in 6 blokken bewaard (collecties, media, notities, quotes, leeslijst, groepen) van elk maximaal ongeveer 1,9 MB tekst. Afbeeldingen tellen daar niet in mee. Voor een persoonlijk archief met duizenden items is dat ruim voldoende.
- **Meerdere apparaten:** wijzigingen worden binnen een seconde of twee opgeslagen. Open je het archief op twee toestellen tegelijk en bewerk je beide, dan wint de eerste opslag en herlaadt de tweede met de nieuwste gegevens.
- **Back-ups:** D1 bewaart automatisch eerdere toestanden (Time Travel). Maak daarnaast af en toe een export (`wrangler d1 export archive-db --remote --output backup.sql`).
- **Beveiliging:** schakel in Cloudflare onder *Security → WAF → Rate limiting rules* eventueel een extra regel in voor `/api/auth/*`. Wachtwoorden verlaten nooit je server leesbaar. Een gebruiker kan zijn account en alle bestanden zelf definitief verwijderen via Account.
- **Privacy (AVG):** voeg een privacyverklaring toe als anderen de site gebruiken en kies bij D1 een Europese locatie. Instagram- en Pinterest-afbeeldingen blijven van de makers: gebruik ze alleen als je daar de rechten voor hebt.
- **Foutmelding "De server is nog niet ingesteld":** de bindings `DB` en `FILES` ontbreken of de deployment is nog niet opnieuw uitgevoerd (stap 4).
