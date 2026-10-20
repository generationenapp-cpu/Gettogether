// GetTogether – app-indstillinger til Expo / EAS.
// (app.json er tom med vilje: EAS skriver selv projekt-ID og opdaterings-adresse dér.)
// Ret navn, ID og adresse her. ID'erne (dk.gettogether.app) kan IKKE ændres,
// når appen først ligger i Google Play / App Store.
const fs = require('fs');
const path = require('path');

const SITE = 'https://gettogether-by-malik.netlify.app';   // adressen på din hjemmeside (Netlify)
const ID = 'dk.gettogether.app';
const MORK = '#0B1220';
const GULD = '#D4AF6A';
const MIK = 'GetTogether bruger mikrofonen, når du ringer til dine venner. Samtalen bliver aldrig optaget.';

// Push på Android kræver google-services.json fra Firebase (se README). Den tages kun med, når den findes.
const googleServices = fs.existsSync(path.join(__dirname, 'google-services.json')) ? './google-services.json' : undefined;

module.exports = ({ config }) => ({
  ...config,
  name: 'GetTogether',
  slug: 'gettogether',
  scheme: 'gettogether',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: MORK,
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: ID,
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: { NSMicrophoneUsageDescription: MIK },
  },
  android: {
    package: ID,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-mono.png',
      backgroundColor: MORK,
    },
    permissions: ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'],
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
  },
  plugins: [
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 180, backgroundColor: MORK, resizeMode: 'contain' }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: GULD }],
  ],
  extra: {
    ...(config.extra || {}),
    site: SITE,
  },
});
