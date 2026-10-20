# GetTogether som rigtig app (Google Play og App Store)

Mappen her laver hjemmesiden om til en rigtig app med **Capacitor 8**. Det er den samme kode som på hjemmesiden – guiden, fællesskabet, chat og opkald – pakket ind i en app. Den bruger den samme Supabase-database, så folk kan logge ind med det samme kaldenavn og den samme kode på hjemmesiden og i appen.

> Mappen starter med et punktum (`.mobil`), så Netlify **ikke** lægger den på hjemmesiden.

**Navn og ID:** Appen hedder **GetTogether** og har ID'et `dk.gettogether.app` (i `capacitor.config.json` og `codemagic.yaml`). ID'et kan ikke ændres, når appen først er uploadet. Vil du have et andet, så ret det **før** første upload.

---

## Før du starter (én gang)
1. Udfyld `faellesskab/config.js` (Supabase og `LOGIN_DOMAIN`) som beskrevet i hoved-README. Appen virker ikke uden.
2. Er din Netlify-adresse ikke `https://gettogether-by-malik.netlify.app`, så ret `"site"` i `.mobil/package.json`. Tælleren og privatlivspolitikken hentes derfra.
3. Læg hjemmesiden op igen (`npx netlify-cli deploy --prod`), så tælleren også svarer appen.
4. Installer på din computer:
   - **Node.js 22 eller nyere** (nodejs.org, LTS)
   - **Android Studio** (developer.android.com/studio, nyeste udgave)

---

## Android – på din egen computer

**Første gang** – åbn en terminal i mappen `.mobil`:
```
npm install
npm run android:opret
npm run android
```
Android Studio åbner. Vent, til den er færdig med at gøre klar ("Gradle sync").

**Prøv appen på din telefon**
1. På telefonen: Indstillinger → Om telefonen → tryk 7 gange på **Build-nummer**.
2. Gå til Indstillinger → **Udviklerindstillinger** og slå **USB-fejlfinding** til.
3. Sæt telefonen i computeren med et USB-kabel og tryk på den grønne ▶ i Android Studio.
4. Test et opkald mellem to telefoner. Telefonen spørger om lov til mikrofonen første gang.

**Lav filen til Google Play**
1. Android Studio → **Build → Generate Signed App Bundle or APK → Android App Bundle**.
2. **Create new…** keystore. Gem filen og begge adgangskoder et sikkert sted – **ikke** i GitHub.
3. Vælg **release** → **Create**. Filen ligger i `.mobil/android/app/release/app-release.aab`.

**Google Play Console** (play.google.com/console – 25 USD én gang)
1. **Opret app** → navn, sprog dansk, gratis.
2. Udfyld butikssiden, ikonet (`.mobil/assets/icon-only.png`), skærmbilleder, privatlivspolitik (`https://DIN-SIDE/faellesskab/privatliv.html`), **Datasikkerhed**, **Indholdsvurdering** og **Målgruppe: 18+**.
3. **App-adgang:** opret en testprofil i appen og skriv kaldenavn og kode her, så Google kan logge ind.
4. **Test → Lukket test** → upload `.aab`-filen.
5. Har du en **personlig** konto (oprettet efter november 2023), kræver Google mindst **12 testere i 14 dage i træk**, før du kan søge om at udgive. Inviter venner og familie med deres Gmail.
6. **Produktion → Opret udgivelse**.

---

## iPhone – uden Mac (Codemagic bygger den i skyen)

Det kræver **Apple Developer Program** (99 USD om året) og at koden ligger på GitHub.

1. **Apple Developer** → Certificates, Identifiers & Profiles → **Identifiers → +** → App IDs → Bundle ID: `dk.gettogether.app`.
2. **App Store Connect** → Apps → **+ Ny app** → navn GetTogether, Bundle ID `dk.gettogether.app`.
3. **App Store Connect** → Brugere og adgang → **Integrationer → App Store Connect API** → lav en nøgle med rollen **App Manager**. Hent `.p8`-filen og noter **Issuer ID** og **Key ID**.
4. **codemagic.io** → log ind med GitHub → tilføj repoet `gettogether-by-malik`.
5. Codemagic → **Integrations → Developer Portal** → indsæt nøglen og kald den **GetTogether**.
6. Codemagic → **Code signing identities**:
   - **iOS certificates → Generate certificate**.
   - **iOS provisioning profiles → Fetch profiles** (App Store-profil til `dk.gettogether.app`).
7. **Start new build** → vælg **iPhone til TestFlight**. Opskriften ligger i `codemagic.yaml` i roden af repoet.
8. Efter cirka 20 minutter ligger appen i **TestFlight**. Installer TestFlight-appen på din iPhone og prøv den, også et opkald.
9. App Store Connect → udfyld butikssiden, **App-privatliv**, aldersgrænse **18+**, og under **App Review Information** et demo-login (kaldenavn + kode). Indsend.

---

## Når du har ændret noget
Ændringer i **databasen og indstillinger** (Supabase, AI-tjek, moderatorer) virker med det samme i appen. Ændringer i **koden** (fx `faellesskab/app.js` eller `index.html`) kræver en ny version i butikkerne:
1. Hæv `"version"` (fx `1.0.1`) og `"build"` (fx `2`) i `.mobil/package.json`. Google kræver et højere `build` hver gang.
2. **Android:** `npm run android` → lav en ny `.aab` → upload.
3. **iPhone:** skub koden til GitHub → start et nyt build i Codemagic (build-nummeret tæller selv op).

## Så bliver I godkendt
- **Brugerindhold (Apple 1.2 / Google UGC):** appen skal kunne filtrere, rapportere og blokere og have en kontakt. Det har I: AI-tjek, Rapportér, Bloker, moderatorer og kontaktmail i privatlivspolitikken.
- **Sletning af konto:** findes i appen (Profil → Slet min konto). Google vil også have et link: brug privatlivspolitikken.
- **Demo-login:** både Apple og Google skal have et kaldenavn og en kode, de kan logge ind med.
- **Dit navn i butikken:** Med en **personlig** Apple-konto står dit fulde navn som udvikler. Vil du undgå det, skal kontoen oprettes som virksomhed. Det kræver et selskab (fx ApS) med et gratis D-U-N-S-nummer, fordi Apple tilmelder enkeltmandsvirksomheder som privatpersoner. På Google vælger du selv udviklernavnet. En virksomhedskonto hos Google slipper også for kravet om 12 testere.

## Filer
- `package.json` – kommandoerne og versionsnummeret
- `capacitor.config.json` – appens navn og ID
- `scripts/kopier-web.mjs` – kopierer hjemmesiden ind i appen (`www/`) og retter det, der skal være anderledes i en app
- `scripts/indstil.mjs` – giver appen lov til mikrofonen (opkald) og sætter versionsnummeret
- `assets/` – ikon og startskærm, som `npm run android:opret` / `ios:opret` laver om til alle størrelser
- `android/` og `ios/` – laves af Capacitor første gang og skal med i GitHub
