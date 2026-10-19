/* =============================================================
   GetTogether – KONFIGURATION
   Det eneste sted du skal rette noget. Se README.md trin 2.
   ============================================================= */
window.APP_CONFIG = {
  // Supabase → Project Settings → API
  SUPABASE_URL: 'https://DIT-PROJEKT.supabase.co',
  SUPABASE_ANON_KEY: 'DIN-ANON-PUBLIC-KEY',

  // Vises i appen
  APP_NAME: 'GetTogether',

  // Login med kaldenavn + kode: Supabase skal bruge en e-mail bag kulisserne.
  // Skriv et domæne, du ejer, som kan modtage mail (fx dit firmadomæne).
  // Der bliver ALDRIG sendt mails dertil, og ingen medlemmer ser det.
  LOGIN_DOMAIN: 'DIT-DOMÆNE.dk',

  // Bruges i privatlivspolitikken + når brugere skal kontakte jer (GDPR-krav)
  CONTROLLER_NAME: 'Dit navn eller virksomhedsnavn',
  CONTROLLER_ID: 'CVR-nr. eller adresse',
  CONTACT_EMAIL: 'kontakt@ditdomæne.dk',

  // Servere der hjælper telefonopkald med at finde vej mellem to telefoner.
  // STUN er gratis og virker på de fleste netværk. Tilføj en TURN-server
  // (fx gratis fra metered.ca eller Cloudflare) for at opkald også virker
  // på mobilnet og strenge arbejds-/skolenetværk – se README.md trin 7.
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // { urls: 'turn:DIN-TURN-SERVER:443?transport=tcp', username: 'BRUGERNAVN', credential: 'ADGANGSKODE' },
  ],
};
