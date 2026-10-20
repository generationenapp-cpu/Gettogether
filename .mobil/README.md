# GetTogether som Android-app (Google Play)

Mappen laver hjemmesiden om til en rigtig Android-app med **Capacitor 8**. Det er den samme kode som på hjemmesiden – guiden, fællesskabet, chat og opkald – pakket ind i en app. Den bruger den samme database, så folk logger ind med det samme kaldenavn og den samme kode på hjemmesiden og i appen.

Appen kan desuden det, en Android-app skal kunne:
- **Tilbage-knappen** lukker det øverste (en dialog, en chat, en fane) og går til sidst ud til guiden.
- **Download mine data** gemmer filen og åbner telefonens Del-menu (Gem i Filer, Drev, mail …).
- **Tastaturet** dækker ikke chatfeltet.
- **Mikrofon** til opkald mellem venner – telefonen spørger første gang.

Appen findes kun til Android. iPhone-brugere bruger hjemmesiden og kan lægge den på hjemmeskærmen (Del → Føj til hjemmeskærm).

> Mappen starter med et punktum (`.mobil`), så Netlify **ikke** lægger den på hjemmesiden.

**Navn og ID:** Appen hedder **GetTogether** og har ID'et `dk.gettogether.app` (i `capacitor.config.json`). ID'et kan ikke ændres, når appen først er uploadet. Vil du have et andet, så ret det **før** første upload.

---

## Før du starter (én gang)
1. Hjemmesiden skal være oppe og virke (se `START-HER.md`). Appen henter tælleren og privatlivspolitikken derfra.
2. Er din Netlify-adresse ikke `https://gettogether-by-malik.netlify.app`, så ret `"site"` i `.mobil/package.json`.
3. Installer **Android Studio** (developer.android.com/studio, nyeste udgave). Node.js har du allerede.

## Byg appen
`START-HER.cmd` → **3** (første gang) og derefter **4**. Eller i en terminal i mappen `.mobil`:
```
npm install
npm run android:opret
npm run android
```
Android Studio åbner. Vent, til den er færdig med at gøre klar ("Gradle sync").

**Prøv appen på din telefon**
1. På telefonen: Indstillinger → Om telefonen → tryk 7 gange på **Build-nummer**.
2. Indstillinger → **Udviklerindstillinger** → slå **USB-fejlfinding** til.
3. Sæt telefonen i computeren med et USB-kabel og tryk på den grønne ▶ i Android Studio.
4. Test: log ind, skriv, ring op til en ven, tryk på tilbage-knappen og prøv **Download mine data**.

**Lav filen til Google Play**
1. Android Studio → **Build → Generate Signed App Bundle or APK → Android App Bundle**.
2. **Create new…** keystore. Gem filen og begge adgangskoder et sikkert sted – **ikke** i GitHub. Mister du dem, kan du ikke opdatere appen.
3. Vælg **release** → **Create**. Filen ligger i `.mobil/android/app/release/app-release.aab`.

## Google Play – anonymt
Google Play Console (play.google.com/console) koster 25 USD én gang.
- Opret kontoen som **personlig konto** med en mail uden dit navn. Google kontrollerer din identitet, men viser den ikke.
- **Udviklernavn** er offentligt – vælg fx "GetTogether".
- **Kontakt-mail** på butikssiden er offentlig – brug den samme anonyme mail som i privatlivspolitikken.
- Din **adresse** vises kun, hvis appen tjener penge (betalte apps eller køb i appen). Hold appen gratis, så vises den ikke.
- Nye personlige konti skal have mindst **12 testere i 14 dage i træk** (lukket test), før appen kan udgives.

**Udgiv**
1. **Opret app** → navn GetTogether, sprog dansk, gratis.
2. Udfyld butikssiden, ikonet (`.mobil/assets/icon-only.png`), skærmbilleder, privatlivspolitik (`https://DIN-SIDE/faellesskab/privatliv.html`), **Datasikkerhed**, **Indholdsvurdering** og **Målgruppe: 18+**.
3. **App-adgang:** opret en testprofil og skriv kaldenavn og kode her, så Google kan logge ind.
4. **Test → Lukket test** → upload `.aab`-filen → inviter 12 testere.
5. Efter 14 dage: **Produktion → Opret udgivelse**.

Google kræver for apps med brugerindhold, at man kan filtrere, rapportere og blokere og har en kontakt. Det har appen: AI-tjek, Rapportér, Bloker, moderatorer og kontaktmail i privatlivspolitikken. Sletning af konto findes i appen (Profil → Slet min konto), og privatlivspolitikken er det link, Google beder om.

## Når du har ændret noget
Ændringer i **databasen og indstillinger** (Supabase, AI-tjek, moderatorer) virker med det samme. Ændringer i **koden** (fx `faellesskab/app.js` eller `index.html`) kræver en ny version:
1. Hæv `"version"` (fx `1.0.1`) og `"build"` (fx `2`) i `.mobil/package.json`. Google kræver et højere `build` hver gang.
2. `START-HER.cmd` → **4** → lav en ny `.aab` → upload i Play Console.

## Filer
- `package.json` – kommandoerne og versionsnummeret
- `capacitor.config.json` – appens navn og ID
- `scripts/kopier-web.mjs` – kopierer hjemmesiden ind i appen (`www/`) og retter det, der skal være anderledes i en app
- `scripts/bro.js` – tilbage-knap og "Download mine data" i appen
- `scripts/indstil.mjs` – giver appen lov til mikrofonen (opkald) og sætter versionsnummeret
- `assets/` – ikon og startskærm, som `npm run android:opret` laver om til alle størrelser
- `android/` – laves af Capacitor første gang og skal med i GitHub
