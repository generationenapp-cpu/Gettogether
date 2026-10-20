// Indstiller de native projekter (android/ og ios/), efter Capacitor har lavet dem:
//  - mikrofon-tilladelse til opkald mellem venner
//  - versionsnummer fra package.json ("version" og "gettogether.build")
// Kan køres igen og igen – den ændrer kun det, der mangler.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBIL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(MOBIL, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const BUILD = Number(process.env.GT_BUILD || PKG.gettogether.build) || 1;   // GT_BUILD sættes af Codemagic
const MIK = 'GetTogether bruger mikrofonen, når du ringer til dine venner. Samtalen bliver aldrig optaget.';

function rediger(sti, fn) {
  if (!existsSync(sti)) return false;
  const før = readFileSync(sti, 'utf8');
  const efter = fn(før);
  if (efter !== før) writeFileSync(sti, efter);
  return true;
}

// ---------- Android ----------
const manifest = join(MOBIL, 'android/app/src/main/AndroidManifest.xml');
if (rediger(manifest, s => {
  for (const p of ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) {
    const linje = `<uses-permission android:name="android.permission.${p}" />`;
    if (!s.includes(`android.permission.${p}"`)) s = s.replace('</manifest>', `    ${linje}\n</manifest>`);
  }
  return s;
})) {
  rediger(join(MOBIL, 'android/app/build.gradle'), s => s
    .replace(/versionCode\s+\d+/, `versionCode ${BUILD}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${VERSION}"`));
  console.log(`✓ Android: mikrofon-tilladelse og version ${VERSION} (${BUILD})`);
}

// ---------- iOS ----------
const plist = join(MOBIL, 'ios/App/App/Info.plist');
if (rediger(plist, s => {
  const tilfoej = (noegle, vaerdi) => {
    if (s.includes(`<key>${noegle}</key>`)) return;
    const i = s.lastIndexOf('</dict>');
    s = s.slice(0, i) + `\t<key>${noegle}</key>\n\t${vaerdi}\n` + s.slice(i);
  };
  tilfoej('NSMicrophoneUsageDescription', `<string>${MIK}</string>`);
  tilfoej('ITSAppUsesNonExemptEncryption', '<false/>');   // kun almindelig HTTPS-/opkaldskryptering
  return s;
})) {
  rediger(join(MOBIL, 'ios/App/App.xcodeproj/project.pbxproj'), s => s
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${VERSION};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${BUILD};`));
  console.log(`✓ iOS: mikrofon-tekst og version ${VERSION} (${BUILD})`);
}
