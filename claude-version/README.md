# Claude-versionen

Samme app, men så den kører direkte i Claude som en artifact – uden Supabase og uden Netlify.

- **Guiden (Nur)** bruger Claude til Spørg, Undersøg og oversættelse (ingen API-nøgle).
- **Fællesskabet** gemmer alt i Claude-sidens egen database og bruger din Claude-konto som login.
  Kun folk, du deler siden med, kan være med.
- **AI-tjek:** nye og ændrede profiler tjekkes af Claude (samme regler som i den udgivne app).
  Tydeligt falske eller skræmmende profiler bliver stoppet, og tvivlstilfælde lægges i ejerens kø.
- **Ejeren af siden er administrator** og har fanen *Moderation*: sager, medlemmer (godkend, stop,
  pause, udeluk), opslag til alle og en log. At udpege moderatorer og lave login-koder findes kun
  i den udgivne app, fordi Claude-versionen bruger Claude-konti i stedet for kaldenavn + kode.
- **Opkald** findes ikke i Claude-versionen (Claude-sider må ikke bruge mikrofon/WebRTC).
- Private beskeder og grupper vises kun for de rigtige personer i appen, men er ikke låst i
  databasen som i den udgivne app. Brug Claude-versionen til at teste og vise appen frem.

## Byg
```
python3 claude-version/build.py
```
Laver `claude-version/dist/gettogether.html` + `lang/` + `song.mp3`, som Claude udgiver som én artifact.

## Filer
- `claude-backend.js` – efterligner Supabase-klienten oven på Claude-sidens database (`db`) og konto (`user`)
- `build.py` – samler guiden og fællesskabet til én side
