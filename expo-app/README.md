# GetTogether som Expo-app (Google Play og App Store)

Guiden og fællesskabet er **bygget ind i appen**: al tekst, alle sprog, stil og kode ligger i appen. Siderne vises, som om de lå på hjemmesiden, så login, database, opkald og tælleren virker præcis som på nettet. Folk logger ind med samme kaldenavn og kode i appen og på hjemmesiden.

Oven i det kan appen det, kun en rigtig app kan:
- **Push-beskeder** ved nye private beskeder, gruppebeskeder, opkald og venneanmodninger. Teksten i beskeden sendes aldrig med – kun hvem det er fra.
- **Tryk på en push-besked** åbner den rigtige chat, venneanmodningerne eller opkaldet.
- **Guiden virker uden internet** – også alle sprogene.
- **Android-tilbageknap**, plads til tastaturet og status- og navigationslinjen i appens farver (lys/mørk og opkald).
- **Kopiér din kode** og **Download mine data** via telefonens egen Del/Gem.
- Links (fx privatlivspolitikken) åbner i en browser ovenpå appen.
- **Opdateringer uden butikkerne**: rettelser i guiden og fællesskabet sendes ud med én kommando.

Expo (EAS) bygger både Android- og iPhone-appen i skyen. Du skal **ikke** have en Mac og ikke Android Studio.

**Navn og ID:** Appen hedder **GetTogether** og har ID'et `dk.gettogether.app` (i `app.config.js`). ID'et kan ikke ændres, når appen først ligger i en butik. Ret det før første upload, hvis du vil have et andet.

---

## 1. Gør klar (én gang)

Du skal have:
- **Node.js 22 eller nyere** (nodejs.org, LTS)
- En gratis konto på **expo.dev** (brug gerne en mail uden dit navn)

Åbn en terminal i mappen `expo-app` og kør:
```
npm install -g eas-cli
npm install
npx expo install --fix
eas login
eas init
eas update:configure
```
`eas init` opretter projektet hos Expo og skriver projekt-ID'et i `app.json`. `eas update:configure` gør opdateringer uden butikkerne klar.

Tjek også:
- `faellesskab/config.js` er udfyldt (Supabase og `LOGIN_DOMAIN`), ligesom til hjemmesiden.
- Er din Netlify-adresse ikke `https://gettogether-by-malik.netlify.app`, så ret `SITE` øverst i `app.config.js`.

## 2. Supabase: push-beskeder (5 min)
1. Kør hele `faellesskab/schema.sql` igen i **SQL Editor** (den tilføjer tabellerne til push).
2. **Edge Functions → Deploy a new function → Via Editor**. Navn: `send-push`. Indsæt hele `supabase/functions/send-push/index.ts` → **Deploy**.

## 3. Prøv appen med det samme
```
npm start
```
Scan QR-koden med **Expo Go**-appen på din telefon. Alt undtagen push virker i Expo Go.

## 4. Push på Android (Firebase, 10 min)
1. **console.firebase.google.com** → opret et projekt (fx "GetTogether") → **Tilføj app → Android** → pakkenavn `dk.gettogether.app`.
2. Hent **google-services.json** og læg den i mappen `expo-app`. Den må gerne komme på GitHub.
3. Firebase → **Project settings → Service accounts → Generate new private key**. Den fil er hemmelig – **ikke** på GitHub.
4. Kør `eas credentials` → Android → production → **Google Service Account** → **FCM V1** → upload filen fra trin 3.

På iPhone klarer EAS push selv: sig **ja**, når den spørger om en push-nøgle ved første iPhone-build.

## 5. Testversion på din Android-telefon
```
npm run build:test
```
Efter 10–20 minutter får du et link. Åbn det på telefonen og installer appen. Test med to telefoner: log ind, skriv, ring op, og luk appen på den ene for at se push-beskeden.

## 6. Udgiv

**Google Play** (play.google.com/console – 25 USD én gang)
1. `npm run build:android` laver en `.aab`-fil.
2. Første gang skal filen uploades **i hånden** i Play Console (Google kræver det): Opret app → udfyld butikssiden, privatlivspolitik (`https://DIN-SIDE/faellesskab/privatliv.html`), **Datasikkerhed**, **Indholdsvurdering**, **Målgruppe 18+** → **Test → Lukket test** → upload.
3. Har du en **personlig** konto (oprettet efter november 2023), kræver Google mindst **12 testere i 14 dage i træk**, før du kan udgive.
4. Senere versioner: `npm run build:android` og så `npm run send:android`.

**App Store** (Apple Developer Program – 99 USD om året)
1. `npm run build:ios`. EAS beder dig logge ind med dit Apple-ID og laver selv certifikater og push-nøgle.
2. `npm run send:ios` sender den til **TestFlight**. Installer TestFlight på din iPhone og prøv den – også et opkald.
3. App Store Connect → udfyld butikssiden, **App-privatliv**, aldersgrænse **18+**, demo-login under **App Review Information** → indsend.

## 7. Når du har ændret noget
| Hvad du har ændret | Hvad du gør |
|---|---|
| Databasen, moderatorer, AI-tjek (Supabase) | Ingenting – virker med det samme |
| Guiden eller fællesskabet (`index.html`, `faellesskab/…`, sprogfiler) | `npm run opdater` – telefonerne henter det selv. Læg også hjemmesiden op på Netlify. |
| `App.js`, ikoner, tilladelser, nye Expo-pakker | Hæv `version` i `app.config.js` (fx `1.0.1`) og byg nye versioner (trin 6) |

## Så bliver I godkendt
- **Demo-login:** Opret en testprofil og giv Apple og Google kaldenavn og kode.
- **Brugerindhold:** Appen skal kunne filtrere, rapportere og blokere og have en kontakt. Det har I: AI-tjek, Rapportér, Bloker, moderatorer og kontaktmail.
- **Sletning af konto** findes i appen (Profil → Slet min konto). Google vil også have et link – brug privatlivspolitikken.
- **"Mere end en hjemmeside":** Apple afviser nogle gange apps, der bare viser en hjemmeside. Skriv i noterne til Apple, at appen har push-beskeder, opkald mellem venner, privat chat og en guide, der virker uden internet.
- **Dit navn i butikken:** Med en **personlig** Apple-konto står dit fulde navn som udvikler. Vil du undgå det, skal kontoen oprettes som virksomhed. Det kræver et selskab (fx ApS) med et gratis D-U-N-S-nummer, fordi Apple tilmelder enkeltmandsvirksomheder som privatpersoner. På Google vælger du selv udviklernavnet, og en virksomhedskonto slipper for kravet om 12 testere.

## Filer
- `App.js` – appen: viser siderne, push, tilbageknap, tastatur, farver, kopiér/gem
- `app.config.js` – navn, ID, ikoner, tilladelser (mikrofon til opkald) og adressen på hjemmesiden
- `eas.json` – byggeprofiler (test-APK og butiksversion) og upload
- `scripts/byg-web.mjs` – bygger guiden og fællesskabet ind i appen (`web/sider.js`). Køres automatisk.
- `assets/` – ikon, Android-ikon (også til telefonens farvetema), startskærm og ikon til push
