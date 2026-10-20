# Start her – GetTogether by Malik

Gør det i denne rækkefølge, så går intet galt. Hvor der står **START-HER**, dobbeltklikker du på `START-HER.cmd` i denne mappe og trykker på tallet.

Du skal bruge: din Lenovo med **Node.js** (nodejs.org, LTS) og en browser.

---

### ☐ 1. Supabase – databasen (i browseren, ca. 15 min)
1. **supabase.com → New project** → region **Central EU (Frankfurt)**.
2. **SQL Editor → New query** → indsæt hele `faellesskab/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email** → slå **Confirm email** fra → **Save**.
4. **Edge Functions → Deploy a new function → Via Editor**, to gange:
   - navn `check-profile` → indsæt `supabase/functions/check-profile/index.ts` → **Deploy**
   - navn `send-push` → indsæt `supabase/functions/send-push/index.ts` → **Deploy**
5. **Edge Functions → Secrets** → `ANTHROPIC_API_KEY` = din nøgle fra console.anthropic.com.

### ☐ 2. Ret én fil: `faellesskab/config.js`
Åbn den i Notesblok og udfyld:
- `SUPABASE_URL` og `SUPABASE_ANON_KEY` (Supabase → **Project Settings → API**)
- `LOGIN_DOMAIN` – et domæne du ejer, fx `ai-helt.dk` (der sendes aldrig mails dertil)
- `CONTROLLER_NAME`, `CONTROLLER_ID`, `CONTACT_EMAIL` – til privatlivspolitikken (brug gerne en anonym mail)

### ☐ 3. START-HER → **1** (tjek) og **2** (hjemmesiden)
Står der et **X**, så ret det først. Punkt 2 lægger hjemmesiden op på Netlify.

### ☐ 4. Gør dig selv til administrator
1. Åbn din hjemmeside → **Fællesskab** → **Ny her** → vælg kaldenavn → **gem koden** → opret profil.
2. Supabase → **SQL Editor** (skriv dit kaldenavn):
   ```sql
   update public.profiles set role = 'admin' where lower(nickname) = lower('DIT-KALDENAVN');
   ```
3. Gå til `din-side/faellesskab/panel/` → log ind → **Indstillinger** → slå **AI-tjek** til.

### ☐ 5. START-HER → **3** (gør appen klar) og **4** (prøv den)
Lav først en gratis konto på **expo.dev** (gerne med en mail uden dit navn). Punkt 3 spørger om login og et par ja/nej – svar **ja (Y)**. Punkt 4 viser en QR-kode, som du scanner med **Expo Go**-appen.

### ☐ 6. Push på Android (Firebase, ca. 10 min)
Følg trin 4 i `expo-app/README.md`. Læg `google-services.json` i mappen `expo-app`.

### ☐ 7. START-HER → **5** (testapp på din telefon)
Test med to telefoner: log ind, skriv, ring op, og luk appen på den ene for at se push-beskeden.

### ☐ 8. Ud i butikkerne
- **Google Play** (25 USD én gang): START-HER → **6**. Første gang uploader du filen i hånden i Play Console. Personlige konti skal have **12 testere i 14 dage**.
- **App Store** (99 USD om året): START-HER → **7** og så **8** → TestFlight → indsend i App Store Connect.
- Giv Apple og Google et **demo-login** (kaldenavn + kode) og sæt aldersgrænsen til **18+**.
- Detaljerne står i `expo-app/README.md` under "Så bliver I godkendt".

### Senere: når du har rettet noget
- Guiden eller fællesskabet: START-HER → **9** (telefonerne) og **2** (hjemmesiden).
- Moderatorer, AI-tjek, databasen: virker med det samme – gør ingenting.

---
**Gik noget galt?** Kopiér den sidste tekst fra det sorte vindue til Claude.
