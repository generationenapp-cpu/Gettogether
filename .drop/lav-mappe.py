#!/usr/bin/env python3
"""Laver mappen til Netlify Drop (træk-og-slip på app.netlify.com/drop).

Brug:  python3 .drop/lav-mappe.py UD-MAPPE --ref PROJEKT-REF --key ANON-NØGLE \
           --login-domain DOMÆNE --navn "..." --id "..." --mail "..."

Kun hjemmesidens filer kommer med (ikke Android, Claude-version, Supabase-filer,
START-HER eller schema.sql). config.js udfyldes, og netlify.toml erstattes af
_headers og _redirects, som også virker ved træk-og-slip. Tælleren i guiden
(/api/count) sendes videre til Supabase-funktionen "count".
"""
import argparse, json, re, shutil, subprocess, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = ('.mobil/', 'claude-version/', 'supabase/', 'netlify/', '.drop/')
SKIP_FILES = {'.gitignore', 'README.md', 'START-HER.cmd', 'START-HER.md', 'netlify.toml',
              'package.json', 'package-lock.json', 'faellesskab/schema.sql'}

HEADERS = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000
  X-Robots-Tag: noindex, nofollow

/sw.js
  Cache-Control: no-cache

/faellesskab/*
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(self), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; media-src 'self' blob:; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'

/faellesskab/sw.js
  Cache-Control: no-cache

/faellesskab/config.js
  Cache-Control: no-cache
"""

def js_str(v: str) -> str:
    return json.dumps(v, ensure_ascii=False).replace("'", "\\'")[1:-1]

def set_cfg(src: str, key: str, value: str) -> str:
    pat = re.compile(r"^(\s*" + key + r":\s*)'[^']*'", re.M)
    out, n = pat.subn(lambda m: m.group(1) + "'" + js_str(value) + "'", src)
    if n != 1:
        sys.exit(f'Fandt ikke {key} i config.js')
    return out

def main():
    a = argparse.ArgumentParser()
    a.add_argument('out'); a.add_argument('--ref', required=True); a.add_argument('--key', required=True)
    a.add_argument('--login-domain', required=True); a.add_argument('--navn', required=True)
    a.add_argument('--id', default=''); a.add_argument('--mail', required=True)
    a.add_argument('--zip', default='')
    o = a.parse_args()
    if not re.fullmatch(r'[a-z0-9]{20}', o.ref):
        sys.exit('Projekt-ref ser forkert ud')

    out = Path(o.out)
    if out.exists(): shutil.rmtree(out)
    files = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\n')
    for f in filter(None, files):
        if f.startswith(SKIP_DIRS) or f in SKIP_FILES: continue
        dst = out / f; dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, dst)

    cfg_path = out / 'faellesskab' / 'config.js'
    cfg = cfg_path.read_text(encoding='utf-8')
    for k, v in [('SUPABASE_URL', f'https://{o.ref}.supabase.co'), ('SUPABASE_ANON_KEY', o.key),
                 ('LOGIN_DOMAIN', o.login_domain), ('CONTROLLER_NAME', o.navn),
                 ('CONTROLLER_ID', o.id), ('CONTACT_EMAIL', o.mail)]:
        cfg = set_cfg(cfg, k, v)
    cfg_path.write_text(cfg, encoding='utf-8')

    (out / '_headers').write_text(HEADERS, encoding='utf-8')
    (out / '_redirects').write_text(f'/api/count  https://{o.ref}.supabase.co/functions/v1/count  200!\n', encoding='utf-8')

    if o.zip:
        z = Path(o.zip); z.unlink(missing_ok=True)
        with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
            for p in sorted(out.rglob('*')):
                if p.is_file(): zf.write(p, Path(out.name) / p.relative_to(out))
    n = sum(1 for p in out.rglob('*') if p.is_file())
    print(f'ok {n} filer -> {out}' + (f' og {o.zip}' if o.zip else ''))

if __name__ == '__main__':
    main()
