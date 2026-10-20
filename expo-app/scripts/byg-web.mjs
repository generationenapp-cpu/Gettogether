// Bygger guiden og fællesskabet ind i appen som to færdige sider (web/sider.js).
//
// Siderne vises i appen, som om de lå på hjemmesiden (samme adresse), så login,
// database, opkald og tælleren virker præcis som på nettet. Det der kan ligge
// i appen, ligger i appen: al tekst, alle 33 sprog, stil og kode. Så virker
// guiden også uden internet.
//
// Køres automatisk af "npm start", "npm run build:*", "npm run opdater" og af EAS.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROD = resolve(APP, '..');                       // roden af repoet = hjemmesiden
const læs = f => readFileSync(join(ROD, f), 'utf8');
const sikkerScript = s => s.replace(/<\/script/gi, '<\\/script');   // må ikke lukke <script> for tidligt

function ret(navn, s, aendringer) {
  for (const [fra, til, antal] of aendringer) {
    const n = s.split(fra).length - 1;
    if (n !== antal) throw new Error(`${navn}: forventede ${antal} × «${fra.slice(0, 70)}», fandt ${n}. Koden er ændret – ret expo-app/scripts/byg-web.mjs.`);
    s = s.split(fra).join(til);
  }
  return s;
}

// ---------- Guiden ----------
const sprog = {};
for (const f of readdirSync(join(ROD, 'lang')).filter(f => f.endsWith('.json')).sort()) {
  sprog[f.slice(0, -5)] = JSON.parse(læs('lang/' + f));
}
let guide = ret('index.html', læs('index.html'), [
  // ingen service worker og ingen "Installér som app" i en rigtig app
  ['navigator.serviceWorker.register("sw.js").catch(()=>{})', '0', 1],
  ['const standalone=matchMedia("(display-mode: standalone)").matches||navigator.standalone;', 'const standalone=true;', 1],
  // sprogfilerne ligger i appen
  ['await fetch("lang/"+code+".json")', 'await (window.__GT_LANG&&window.__GT_LANG[code]?{ok:true,json:async()=>window.__GT_LANG[code]}:fetch("lang/"+code+".json"))', 1],
  ['<script>', `<script>window.__GT_LANG=${JSON.stringify(sprog).replace(/</g, '\\u003c')};</script>\n<script>`, 1],
]);

// ---------- Fællesskabet ----------
const logo = 'data:image/png;base64,' + readFileSync(join(ROD, 'icon-192.png')).toString('base64');
let supabase = null;
try {
  const kræv = createRequire(join(APP, 'package.json'));
  const umd = join(dirname(kræv.resolve('@supabase/supabase-js/package.json')), 'dist/umd/supabase.js');
  if (existsSync(umd)) supabase = readFileSync(umd, 'utf8');
} catch (e) { /* ikke installeret endnu: hentes fra nettet */ }

let faelles = ret('faellesskab/index.html', læs('faellesskab/index.html'), [
  ['<link rel="stylesheet" href="app.css">', `<style>\n${læs('faellesskab/app.css')}\n</style>`, 1],
  ['<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
    supabase ? `<script>${sikkerScript(supabase)}</script>` : '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', 1],
  ['<script src="config.js"></script>', `<script>${sikkerScript(læs('faellesskab/config.js'))}\nwindow.APP_CONFIG.LOGO = ${JSON.stringify(logo)};</script>`, 1],
  ['<script src="app.js"></script>', `<script>${sikkerScript(læs('faellesskab/app.js'))}</script>`, 1],
]);

mkdirSync(join(APP, 'web'), { recursive: true });
writeFileSync(join(APP, 'web/sider.js'),
  '// Lavet af scripts/byg-web.mjs – ret ikke her, ret hjemmesiden og kør "npm run web".\n' +
  `export default ${JSON.stringify({ guide, faelles })};\n`);

const kb = s => Math.round(Buffer.byteLength(s) / 1024) + ' KB';
const cfg = læs('faellesskab/config.js');
console.log(`✓ Guiden (${kb(guide)}, ${Object.keys(sprog).length} sprog) og fællesskabet (${kb(faelles)}) er bygget ind i appen`);
if (!supabase) console.log('⚠ Supabase-biblioteket er ikke installeret endnu (kør "npm install") – det hentes fra nettet indtil da.');
if (/DIT-PROJEKT|DIN-ANON/.test(cfg)) console.log('⚠ faellesskab/config.js: SUPABASE_URL og SUPABASE_ANON_KEY er ikke udfyldt.');
if (/DIT-DOM/i.test(cfg)) console.log('⚠ faellesskab/config.js: LOGIN_DOMAIN er ikke udfyldt.');
