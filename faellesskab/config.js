/* =============================================================
   GetTogether – KONFIGURATION
   Det eneste sted du skal rette noget. Se README.md trin 2.
   ============================================================= */
window.APP_CONFIG = {
  // Supabase → Project Settings → API
  SUPABASE_URL: 'https://obgvmfiincvhifkzkitp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9iZ3ZtZmlpbmN2aGlma3praXRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NDAyNTIsImV4cCI6MjEwODUxNjI1Mn0._Ix6o4ItfuxVZL9o0DVuaEtR0JP9lXSoGpBweuR-Om4',

  // Vises i appen
  APP_NAME: 'GetTogether',

  // Login med kaldenavn + kode: Supabase skal bruge en e-mail bag kulisserne.
  // Her bruges projektets egen Supabase-adresse (testet: login virker).
  // Der bliver ALDRIG sendt mails dertil, og ingen medlemmer ser det.
  // Ret den ALDRIG, når der først er medlemmer – så kan de ikke logge ind.
  LOGIN_DOMAIN: 'obgvmfiincvhifkzkitp.supabase.co',

  // Bruges i privatlivspolitikken. Uden CONTACT_EMAIL kontakter man jer inde i fællesskabet.
  CONTROLLER_NAME: 'Malik',
  CONTROLLER_ID: '',
  CONTACT_EMAIL: '',

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
