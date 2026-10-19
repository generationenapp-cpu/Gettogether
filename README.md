# GetTogether by Malik – samlet app

Én app med to dele:

| Del | Hvor | Login | Server |
|---|---|---|---|
| **Guiden (Nur)** – Hjem, Lær, Spørg, Undersøg, 33 sprog | roden af mappen (`index.html`) | Nej | Kun tælleren (Netlify-funktion) |
| **Fællesskab** – rum, venner, private grupper, beskeder, opkald | mappen `faellesskab/` | Ja (e-mail + kode) | Supabase |

Guiden virker præcis som før – også offline og uden login. Menupunktet **Fællesskab** (معًا) fører ind i fællesskabet, og **Guide** (نور) i fællesskabets menu fører tilbage. Det er ét ikon og én app på telefonen.

---

## Trin 1 – Supabase til fællesskabet (5 min)
1. **supabase.com → New project**. Region: **Central EU (Frankfurt)**.
2. **SQL Editor → New query** → indsæt hele `faellesskab/schema.sql` → **Run**.
3. **Project Settings → API** → kopiér **Project URL** og **anon public key** ind i `faellesskab/config.js`. Udfyld også navn/kontakt-mail til privatlivspolitikken (brug gerne en anonym mail).

## Trin 2 – Login-mail med kode (3 min)
Supabase → **Authentication → Email Templates → Magic Link** (og det samme under **Confirm signup**):
```html
<h2>Din login-kode til GetTogether</h2>
<p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
<p>Eller klik her for at logge ind: <a href="{{ .ConfirmationURL }}">Log ind</a></p>
<p>Har du ikke bedt om denne mail, kan du se bort fra den.</p>
```

## Trin 3 – Læg det hele op på Netlify
Tælleren i guiden er en Netlify-funktion, så brug Netlify CLI (ikke træk-og-slip):
```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```
Kør det i denne mappe. Har du allerede siden **gettogether-by-malik**, så vælg den – så får du samme adresse som før, og tælleren bevares.

## Trin 4 – Fortæl Supabase adressen
Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://gettogether-by-malik.netlify.app/faellesskab/`
- **Redirect URLs:** `https://gettogether-by-malik.netlify.app/**`

(Ret navnet, hvis din Netlify-adresse er en anden.)

## Trin 5 – Gør dig selv til admin
Åbn Fællesskab, log ind og opret profil. Kør så i Supabase SQL Editor:
```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'DIN@EMAIL.dk');
```

## Trin 6 – Før I åbner for mange
- **Egen afsender-mail:** Resend eller Brevo under **Authentication → SMTP Settings** (Supabase' egen mail sender kun få i timen).
- **Opkald på mobilnet:** tilføj en gratis TURN-server (metered.ca eller Cloudflare) i `ICE_SERVERS` i `faellesskab/config.js`. På wifi virker opkald uden.
- **Moderatorer:** 2–3 betroede personer, gerne både en kvinde og en mand.

---

## Hvad hænger sammen
- Vælger man **Kvinde/Mand** i fællesskabet, tiltaler Nur (Spørg) én som søster/bror automatisk.
- Samme farver, skrifttyper, ikon og nattehimmel-mønster i begge dele. Lys/mørk følger telefonen.
- Menupunktet og forsidekortet "Fællesskab" er oversat til alle guidens 33 sprog. Selve fællesskabet er på dansk.
- Guidens offline-lager rører aldrig fællesskabet, så chat og opkald altid er friske.

## Claude-versionen
Den samme app kører også direkte i Claude (uden servere) – se `claude-version/README.md`.

## Filer
- `index.html`, `lang/`, `sw.js`, `song.mp3`, ikoner – guiden (Nur)
- `netlify/functions/count.mjs` – tælleren
- `faellesskab/` – fællesskabet (`config.js` er det eneste, du skal rette)
- `faellesskab/schema.sql` – databasen (kan køres igen ved opdateringer)
- `netlify.toml` – samlet opsætning (strammere sikkerhed og mikrofon kun i fællesskabet)
- `claude-version/` – byggescript til Claude-versionen (lægges ikke på hjemmesiden)
