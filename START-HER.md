# Start her – GetTogether by Malik

Gør det i denne rækkefølge, så går intet galt. Hvor der står **START-HER**, dobbeltklikker du på `START-HER.cmd` i denne mappe og trykker på tallet.

Du skal bruge din Lenovo med **Node.js** (nodejs.org, LTS) og en browser.

---

### ☐ 1. Anonym opsætning (før du opretter noget)
1. Lav en **mail uden dit navn** (fx Proton Mail). Brug den til Supabase, Netlify, Anthropic og Google Play.
2. Køb et **separat domæne med mail** til `LOGIN_DOMAIN` (fx et `.dk`-domæne hos One.com). Brug **ikke** et domæne, der kan føres tilbage til dig eller din virksomhed – `config.js` kan ses af alle på hjemmesiden.

### ☐ 2. Supabase – databasen (i browseren, ca. 15 min)
1. **supabase.com → New project** → region **Central EU (Frankfurt)**.
2. **SQL Editor → New query** → indsæt hele `faellesskab/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email** → slå **Confirm email** fra → **Save**.
4. **Edge Functions → Deploy a new function → Via Editor** → navn `check-profile` → indsæt `supabase/functions/check-profile/index.ts` → **Deploy**.
5. **Edge Functions → Secrets** → `ANTHROPIC_API_KEY` = din nøgle fra console.anthropic.com. Sæt lidt kredit ind på Anthropic-kontoen.

### ☐ 3. Ret én fil: `faellesskab/config.js`
Åbn den i Notesblok og udfyld:
- `SUPABASE_URL` og `SUPABASE_ANON_KEY` (Supabase → **Project Settings → API**)
- `LOGIN_DOMAIN` – domænet fra trin 1
- `CONTROLLER_NAME`, `CONTROLLER_ID`, `CONTACT_EMAIL` – til privatlivspolitikken. Læs "Inden du åbner" herunder.

### ☐ 4. START-HER → **1** (tjek) og **2** (hjemmesiden)
Står der et **X**, så ret det først. Punkt 2 lægger hjemmesiden op på Netlify.

### ☐ 5. Gør dig selv til administrator
1. Åbn din hjemmeside → **Fællesskab** → **Ny her** → vælg kaldenavn → **gem koden** → opret profil.
2. Supabase → **SQL Editor** (skriv dit kaldenavn):
   ```sql
   update public.profiles set role = 'admin' where lower(nickname) = lower('DIT-KALDENAVN');
   ```
3. Gå til `din-side/faellesskab/panel/` → log ind → **Indstillinger** → slå **AI-tjek** til.
4. **Medlemmer** → vælg dine moderatorer → **Gør til moderator**.

### ☐ 6. Test hjemmesiden med to telefoner
- Opret to profiler, bliv venner, skriv privat, lav en gruppe og ring op.
- Lægges på hjemmeskærmen: Android → Chrome-menuen → **Installer app**. iPhone → Safari → Del → **Føj til hjemmeskærm**.
- Opkald på mobilnet (4G/5G) kræver ofte en **TURN-server**. Lav en gratis hos metered.ca eller Cloudflare og indsæt den i `ICE_SERVERS` i `config.js` (START-HER → **2** igen).

### ☐ 7. Android-appen (valgfri)
1. Installer **Android Studio** (developer.android.com/studio).
2. START-HER → **3** (første gang) → **4**. Android Studio åbner.
3. Prøv appen på din telefon via USB, og lav filen til Google Play. Se `.mobil/README.md`.

### ☐ 8. Google Play – anonymt (valgfri)
- Personlig konto med din anonyme mail (25 USD én gang). Google kontrollerer din identitet, men viser den ikke.
- Udviklernavn fx "GetTogether". Hold appen **gratis**, så vises din adresse ikke.
- **12 testere i 14 dage** i en lukket test, før du kan udgive. Aldersgrænse **18+** og et demo-login (kaldenavn + kode).

---

### Inden du åbner for alle
- **"by Malik"** står i appen, i titlen og i Netlify-adressen. Malik er dit mellemnavn. Vil du være helt anonym, så skift det (fx til "by M") – sig til, så retter jeg det alle steder.
- **Privatlivspolitikken:** Fordi appen behandler religiøs overbevisning, kræver GDPR, at der står, **hvem** der er dataansvarlig, og hvordan man kontakter dem. Helt anonymt er det ikke lovligt. Overvej at lade en forening eller et selskab stå som dataansvarlig, og få evt. en jurist til at kigge på det.
- **Supabase gratis:** projektet sættes på pause efter 7 dage uden aktivitet. Du får en mail en uge før. Åbn projektet i Supabase for at starte det igen.

### Senere: når du har rettet noget
- Hjemmesiden og fællesskabet: START-HER → **2**.
- Android-appen: hæv versionen i `.mobil/package.json` → START-HER → **4** → ny fil til Google Play.
- Moderatorer, AI-tjek, databasen: virker med det samme – gør ingenting.

---
**Gik noget galt?** Kopiér den sidste tekst fra det sorte vindue til Claude.
