(function(){
  var c = window.APP_CONFIG || {};
  document.querySelectorAll('[data-cfg]').forEach(function(el){ el.textContent = c[el.dataset.cfg] || ''; });
  document.querySelectorAll('[data-cfg-mail]').forEach(function(el){ var m = c[el.dataset.cfgMail] || ''; el.textContent = m; el.href = 'mailto:' + m; });
})();
