# GetTogether by Malik – samlet app

> **Første gang?** Åbn `START-HER.md` og dobbeltklik på `START-HER.cmd`. Så tager du trinene i den rigtige rækkefølge.

Én app med tre dele:

| Del | Hvor | Login | Server |
|---|---|---|---|
| **Guiden (Nur)** – Hjem, Lær, Spørg, Undersøg, 33 sprog | roden af mappen (`index.html`) | Nej | Kun tælleren (Netlify-funktion) |
| **Fællesskab** – rum, venner, private grupper, beskeder, opkald | `faellesskab/` | Kaldenavn + personlig kode (ingen e-mail) | Supabase |
| **Moderatorpanel** – kun for dig og dine moderatorer | `faellesskab/panel/` | Samme kaldenavn + kode | Supabase |

Guiden virker præcis som før – også offline og uden login. Menupunktet **Fællesskab** (معًا) fører ind i fællesskabet, og **Guide** (نور) i fællesskabets menu fører tilbage. Det er ét ikon og én app på telefonen.

**Sådan virker login:** Man vælger et kaldenavn, og appen laver en personlig kode (fx `KNW73-QWCVY`), som man gemmer. Kaldenavn + kode er login. Der bliver ikke sendt nogen mails, og ingen skal opgive e-mail eller telefonnummer.

**Sådan virker AI-tjekket:** Når nogen opretter eller ændrer sin profil, spørger appen Claude, om profilen tydeligt er falsk eller skræmmende (spam, svindel, trusler, seksuelt indhold, under 18 osv.).
- **ok** → profilen er synlig med det samme.
- **tvivl** → profilen er synlig, men lægges i moderatorernes kø.
- **stop** → profilen er skjult. Personen kan rette den eller bede en moderator om at se på den.

---

## Trin 1 – Supabase (5 min)
1. **supabase.com → New project**. Region: **Central EU (Frankfurt)**.
2. **SQL Editor → New query** → indsæt hele `faellesskab/schema.sql` → **Run**. (Filen kan køres igen ved opdateringer.)
3. **Project Settings → API** → kopiér **Project URL** og **anon public key** ind i `faellesskab/config.js`. Udfyld også navn/kontakt-mail til privatlivspolitikken (brug gerne en anonym mail).

## Trin 2 – Login med kaldenavn og kode (2 min)
1. Supabase → **Authentication → Sign In / Providers → Email**: slå **Confirm email** **fra** og tryk **Save**. (Ellers kan ingen oprette sig, for der sendes ingen mails.)
2. I `faellesskab/config.js`: sæt `LOGIN_DOMAIN` til et domæne, du ejer, og som kan modtage mail (fx `ai-helt.dk`). Det bruges kun internt som login-navn bag kulisserne – der sendes aldrig mails dertil. Supabase afviser opdigtede domæner.

> Vælg `LOGIN_DOMAIN` én gang og lad den være. Ændrer du den senere, kan de gamle brugere ikke logge ind.

## Trin 3 – AI-tjek af profiler (5 min)
1. **console.anthropic.com → API Keys → Create Key**. Kopiér nøglen.
2. Supabase → **Edge Functions → Deploy a new function → Via Editor**. Navn: `check-profile`. Slet eksempelkoden, indsæt hele `supabase/functions/check-profile/index.ts` → **Deploy**.
   *(Bruger du terminal i stedet:* `npx supabase login` *og* `npx supabase functions deploy check-profile --project-ref DIT-PROJEKT-ID`*.)*
3. Supabase → **Edge Functions → Secrets → Add new secret**: navn `ANTHROPIC_API_KEY`, værdi = din nøgle → **Save**.
4. AI-tjekket er **slået fra**, indtil du slår det til i panelet (trin 6). Så kan du teste først.

Det koster meget lidt: hvert tjek er ét kort kald til en hurtig og billig Claude-model (standard `claude-haiku-5-5`, kan ændres med secret `ANTHROPIC_MODEL`). Svarer Claude ikke, bliver profilen synlig og lagt i moderatorernes kø – ingen bliver låst ude pga. en fejl.

## Trin 4 – Læg det hele op på Netlify
Tælleren i guiden er en Netlify-funktion, så brug Netlify CLI (ikke træk-og-slip):
```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```
Kør det i denne mappe. Har du allerede siden **gettogether-by-malik**, så vælg den – så får du samme adresse som før, og tælleren bevares.

## Trin 5 – Gør dig selv til administrator
Åbn Fællesskab, tryk **Ny her**, vælg dit kaldenavn og **gem din kode**. Opret profilen. Kør så i Supabase **SQL Editor** (ret kaldenavnet):
```sql
update public.profiles set role = 'admin' where lower(nickname) = lower('DIT-KALDENAVN');
```
Det er den eneste gang, du skal bruge SQL. Resten klarer du i panelet.

## Trin 6 – Moderatorpanelet
Adresse: **`https://DIN-SIDE.netlify.app/faellesskab/panel/`** – log ind med dit kaldenavn og din kode.

- **Indstillinger** (kun dig): slå **AI-tjek** til.
- **Medlemmer** → tryk på en person → **Gør til moderator**. Vælg 2–3 du stoler på, gerne både en kvinde og en mand. De logger ind på samme adresse med deres eget kaldenavn og kode.
- **Sager**: profiler AI'en var i tvivl om, klager over stoppede profiler og rapporter fra medlemmer.
- **Opslag**: skriv til alle – vises øverst på forsiden af fællesskabet.
- **Log**: hvem gjorde hvad og hvornår.

| Kan | Moderator | Dig (admin) |
|---|---|---|
| Godkende og stoppe profiler | ✓ | ✓ |
| Give pause i 24 timer eller 7 dage | ✓ (kun almindelige medlemmer) | ✓ |
| Slette beskeder, lukke sager, skrive opslag | ✓ | ✓ |
| Udelukke permanent | | ✓ |
| Udpege og fjerne moderatorer | | ✓ |
| Lave ny login-kode til et medlem | | ✓ |
| Slå AI-tjek til og fra | | ✓ |

Sikkerheden ligger i databasen, ikke i adressen: en almindelig bruger, der finder panelet, får bare "Ingen adgang". Vil du alligevel holde adressen hemmelig, kan du omdøbe mappen `faellesskab/panel` til fx `faellesskab/vagt-7k2q` (ret også stien i `netlify.toml`).

**Mistet kode:** Der er ingen "glemt kode"-mail. Personen skriver til dig. Når du er sikker på, at det er dem: panelet → **Medlemmer** → personen → **Lav ny login-kode**, og giv dem koden. Medlemmer kan selv lave en ny kode under **Profil → Din kode**.

## Trin 7 – Før I åbner for mange
- **Opkald på mobilnet:** tilføj en gratis TURN-server (metered.ca eller Cloudflare) i `ICE_SERVERS` i `faellesskab/config.js`. På wifi virker opkald uden.
- **Test selv:** opret en testprofil med fx "tjen penge på krypto, skriv på WhatsApp" og se den blive stoppet.

---

## Hvad hænger sammen
- Vælger man **Kvinde/Mand** i fællesskabet, tiltaler Nur (Spørg) én som søster/bror automatisk.
- Samme farver, skrifttyper, ikon og nattehimmel-mønster i alle dele. Lys/mørk følger telefonen.
- Menupunktet og forsidekortet "Fællesskab" er oversat til alle guidens 33 sprog. Selve fællesskabet er på dansk.
- Guidens offline-lager rører aldrig fællesskabet, så chat og opkald altid er friske.

## Som rigtig app (Google Play og App Store)
Mappen `expo-app` er en rigtig app lavet med **Expo**. Guiden og fællesskabet er bygget ind i den, og den har push-beskeder ved nye beskeder, opkald og venneanmodninger. Expo (EAS) bygger både Android- og iPhone-appen i skyen, så du ikke skal have en Mac, og rettelser kan sendes ud uden at vente på butikkerne. Se `expo-app/README.md`.

## Claude-versionen
Den samme app kører også direkte i Claude (uden servere) – se `claude-version/README.md`. Dér logger man ind med sin Claude-konto, Claude tjekker profilerne, og ejeren af siden er administrator.

## Filer
- `index.html`, `lang/`, `sw.js`, `song.mp3`, ikoner – guiden (Nur)
- `netlify/functions/count.mjs` – tælleren
- `faellesskab/` – fællesskabet (`config.js` er det eneste, du skal rette)
- `faellesskab/panel/` – moderatorpanelet
- `faellesskab/schema.sql` – databasen
- `supabase/functions/check-profile/` – AI-tjekket (køres hos Supabase, lægges ikke på hjemmesiden)
- `netlify.toml` – samlet opsætning (strammere sikkerhed og mikrofon kun i fællesskabet)
- `claude-version/` – byggescript til Claude-versionen (lægges ikke på hjemmesiden)
- `expo-app/` – appen til Google Play og App Store (lægges ikke på hjemmesiden)
- `supabase/functions/send-push/` – push-beskeder til appen (køres hos Supabase)
