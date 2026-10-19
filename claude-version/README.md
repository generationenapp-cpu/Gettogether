# Claude-versionen

Samme app, men så den kører direkte i Claude som en artifact – uden Supabase og uden Netlify.

- **Guiden (Nur)** bruger Claude til Spørg, Undersøg og oversættelse (ingen API-nøgle).
- **Fællesskabet** gemmer alt i Claude-sidens egen database og bruger din Claude-konto som login.
  Kun folk, du deler siden med, kan være med. Ejeren af siden er moderator.
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
