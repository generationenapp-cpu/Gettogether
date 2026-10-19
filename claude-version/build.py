"""Bygger Claude-versionen af GetTogether by Malik (én artifact-side + sprogfiler + sang).

Guiden (Nur) er hovedsiden. Fællesskabet kører i en shadow root ovenpå,
med Claude-sidens egen database i stedet for Supabase.
"""
import base64, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)                      # roden af repoet (den udgivne app)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'dist')

nur = open(f'{SRC}/index.html', encoding='utf-8').read()
head = nur[nur.index('<head>') + 6: nur.index('</head>')]
body = nur[nur.index('<body>') + 6: nur.index('</body>')]

# --- head: kun skrifttyper og stil ---
fonts = re.findall(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', head)
styles = re.findall(r'<style>.*?</style>', head, re.S)
assert fonts and styles

# --- body: Fællesskab åbner som lag ovenpå i stedet for en ny side ---
def rep(s, a, b):
    assert s.count(a) == 1, (s.count(a), a[:80])
    return s.replace(a, b)

body = rep(body, 'document.querySelectorAll("[data-href]").forEach(b=>b.addEventListener("click",()=>{location.href=b.dataset.href}));',
           'document.querySelectorAll("[data-href]").forEach(b=>b.addEventListener("click",()=>window.GT_OPEN&&window.GT_OPEN()));')
# ingen service worker / installér-knap / iPhone-tip inde i Claude
inst_start = body.index('/* ================= INSTALLÉR SOM APP ================= */')
inst_end = body.index('</script>', inst_start)
body = body[:inst_start] + '/* Installér som app: ikke relevant inde i Claude */\n' + body[inst_end:]

# --- fællesskabet ---
F = f'{SRC}/faellesskab'
css = open(f'{F}/app.css', encoding='utf-8').read()
css = css.replace('html,body{margin:0;height:100%}\n', '')
css = re.sub(r'(?m)^body\{', ':host{display:block;', css)
css = css.replace('#app{max-width:760px;margin:0 auto;height:100dvh;', '#app{max-width:760px;margin:0 auto;height:100%;')
# farvetokens: :root -> :host, og respekter Claudes lys/mørk-valg
css = css.replace(':root{\n  /* Samme identitet', ':host{\n  /* Samme identitet', 1)
m = re.search(r'@media \(prefers-color-scheme:light\)\{\n  :root\{(.*?)\n  \}\n\}', css, re.S)
assert m, 'light-blok ikke fundet'
light = m.group(1)
css = css[:m.start()] + ('@media (prefers-color-scheme:light){\n  :host(:not([data-theme="dark"])){' + light + '\n  }\n}\n'
                         ':host([data-theme="light"]){' + light + '\n}\n') + css[m.end():]
assert ':root' not in css, 'der er stadig :root i fællesskabets css'

app = open(f'{F}/app.js', encoding='utf-8').read()
backend = open(f'{HERE}/claude-backend.js', encoding='utf-8').read()
for name, txt in [('app.js', app), ('backend', backend)]:
    assert '</script' not in txt.lower(), name

ABOUT = ('<p>Dette er Claude-versionen af GetTogether. Alt gemmes i denne Claude-sides egen database, '
         'og kun folk, som ejeren har delt siden med, kan være med.</p>'
         '<ul><li>Private beskeder og grupper vises kun for de rigtige personer i appen, men de er ikke låst i databasen '
         'som i den udgivne app. Del derfor ikke følsomme oplysninger her.</li>'
         '<li>Telefonopkald findes kun i den udgivne app.</li>'
         '<li>Nye og ændrede profiler bliver tjekket af Claude, så tydelige fake eller skræmmende profiler bliver stoppet.</li>'
         '<li>Ejeren af siden er administrator. Moderatorer og login med kaldenavn og kode findes i den udgivne app.</li></ul>')

boot = """
(function(){
  var host = document.getElementById('gt-faelles');
  var shadow = host.attachShadow({ mode:'open' });
  shadow.innerHTML = '<style>' + document.getElementById('gt-css').textContent + '</style>'
    + '<div id="app"></div><div id="sheet"></div><div id="toast" role="status" aria-live="polite"></div>'
    + '<div id="call" class="sky"></div><audio id="remoteAudio" playsinline></audio>';
  function syncTheme(){ var v = document.documentElement.getAttribute('data-theme'); if (v) host.setAttribute('data-theme', v); else host.removeAttribute('data-theme'); }
  syncTheme(); new MutationObserver(syncTheme).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  window.GT_ROOT = shadow;
  window.APP_CONFIG = {
    SUPABASE_URL:'https://claude-version.supabase.co', SUPABASE_ANON_KEY:'claude-version-uses-the-artifact-database-not-supabase',
    APP_NAME:'GetTogether', CONTACT_EMAIL:'', EMBEDDED:true, LOGO:%s, CALLS:false, PRIVACY_URL:null,
    ABOUT_HTML: %s,
  };
  var started = false;
  window.GT_OPEN = function(){
    host.hidden = false; document.documentElement.style.overflow = 'hidden';
    if (!started){ started = true; window.GT_START(); }
  };
  window.GT_GUIDE = function(){ host.hidden = true; document.documentElement.style.overflow = ''; };
  window.GT_DOWNLOAD = async function(name, text){
    var d = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (!d) throw { message:'Download virker ikke her.' };
    await d.save({ filename:name, data:text });
  };
  if (location.hash === '#faellesskab') setTimeout(window.GT_OPEN, 0);
})();
""" % (json.dumps("data:image/png;base64," + base64.b64encode(open(f"{SRC}/icon-192.png","rb").read()).decode()), json.dumps(ABOUT, ensure_ascii=False))

page = (
    '<title>GetTogether by Malik</title>\n'
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    + '\n'.join(fonts) + '\n'
    + '\n'.join(styles) + '\n'
    '<style>#gt-faelles{position:fixed;inset:0;z-index:100;background:#0B1220}'
    '@media (prefers-color-scheme:light){:root:not([data-theme="dark"]) #gt-faelles{background:#ECEFEA}}'
    ':root[data-theme="light"] #gt-faelles{background:#ECEFEA}</style>\n'
    '<style id="gt-css" media="not all">' + css + '</style>\n'
    + body.strip() + '\n'
    '<div id="gt-faelles" hidden></div>\n'
    '<script>' + backend + '</script>\n'
    '<script>' + boot + '</script>\n'
    '<script>window.GT_START = function(){\n' + app + '\n};</script>\n'
)

os.makedirs(OUT, exist_ok=True)
open(f'{OUT}/gettogether.html', 'w', encoding='utf-8').write(page)
shutil.copytree(f'{SRC}/lang', f'{OUT}/lang', dirs_exist_ok=True)
shutil.copy(f'{SRC}/song.mp3', f'{OUT}/song.mp3')
print('ok', len(page) // 1024, 'KB ->', OUT)
