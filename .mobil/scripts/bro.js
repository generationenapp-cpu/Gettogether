// Lægges ind i appen af kopier-web.mjs. Giver hjemmesiden det, en Android-app skal kunne.
(function () {
  var C = window.Capacitor;
  if (!C || !C.Plugins) return;
  var P = C.Plugins;
  var iFaelles = location.pathname.indexOf('/faellesskab/') !== -1;

  function toast(tekst) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = tekst; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  // Tilbage-knappen: luk det øverste på siden – ellers fra fællesskabet til guiden – ellers luk appen
  if (P.App && P.App.addListener) {
    P.App.addListener('backButton', function () {
      try { if (window.GT_BACK && window.GT_BACK()) return; } catch (e) {}
      if (iFaelles) location.href = '../index.html';
      else P.App.exitApp();
    });
  }

  // "Download mine data": gem filen og åbn telefonens Del-menu (Gem i Filer, Drev, mail …)
  window.GT_DOWNLOAD = async function (navn, tekst) {
    try {
      var r = await P.Filesystem.writeFile({ path: navn, data: tekst, directory: 'CACHE', encoding: 'utf8' });
      await P.Share.share({ title: navn, url: r.uri, dialogTitle: 'Gem dine data' });
    } catch (e) {
      if (/cancel/i.test(String(e && (e.message || e)))) return;   // du lukkede Del-menuen
      try { await navigator.clipboard.writeText(tekst); toast('Dine data er kopieret. Sæt dem ind i en note eller en mail.'); }
      catch (e2) { toast('Kunne ikke gemme dine data. Prøv igen.'); }
    }
  };
})();
