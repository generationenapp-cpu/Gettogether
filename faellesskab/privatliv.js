(function(){
  var c = window.APP_CONFIG || {};
  document.querySelectorAll('[data-cfg]').forEach(function(el){ el.textContent = c[el.dataset.cfg] || ''; });
  document.querySelectorAll('[data-cfg-line]').forEach(function(el){
    var v = c[el.dataset.cfgLine] || '';
    if (v) { el.appendChild(document.createElement('br')); el.appendChild(document.createTextNode(v)); }
  });
  document.querySelectorAll('[data-contact]').forEach(function(el){
    var m = c.CONTACT_EMAIL || '';
    if (m) {
      el.appendChild(document.createTextNode('E-mail: '));
      var a = document.createElement('a'); a.href = 'mailto:' + m; a.textContent = m; el.appendChild(a);
    } else {
      el.textContent = 'Kontakt: skriv til administratoren eller en moderator inde i fællesskabet, eller brug knappen "Rapportér". Er din profil stoppet, så tryk "Bed en moderator se på det".';
    }
  });
})();
