// js/modules/lead-scripts.js — "First Inquiry Scripts" copy-paste helper
// modal (#scriptModal). Same class of bug as js/modules/intake.js: the
// modal markup and its 4 onclick handlers (showScriptModal, closeScriptModal,
// switchScriptTab, copyScript) survived the Carte→Veriqo consolidation but
// the backing JS didn't — found via tests/onclick-handlers.test.js, not in
// the original brief's list. Working reference implementation was still in
// _archive/mise.html. Pure UI/clipboard feature, no data model, so this is a
// straightforward port — all target DOM IDs (scriptModal, scriptTab1-3,
// scriptPanel1-3, scriptStage1-3) are unchanged in current app.html.
(function () {
  'use strict';

  function showScriptModal(stage) {
    var modal = document.getElementById('scriptModal');
    if (modal) modal.style.display = 'flex';
    switchScriptTab(stage || 1);
  }

  function closeScriptModal(e) {
    if (e.target.id === 'scriptModal') {
      document.getElementById('scriptModal').style.display = 'none';
    }
  }

  function switchScriptTab(n) {
    [1, 2, 3].forEach(function (i) {
      var panel = document.getElementById('scriptPanel' + i);
      var btn = document.getElementById('scriptTab' + i);
      if (panel) panel.style.display = i === n ? 'block' : 'none';
      if (btn) {
        btn.style.background = i === n ? '#1C2B1E' : 'transparent';
        btn.style.color = i === n ? '#7ACC8A' : '#666';
        btn.style.borderColor = i === n ? '#1C2B1E' : '#e5e4de';
      }
    });
  }

  function copyScript(event, elementId) {
    var copyText = document.getElementById(elementId);
    if (!copyText) return;
    copyText.select();
    document.execCommand('copy');
    var btn = event.target;
    var orig = btn.innerText;
    btn.innerText = 'Copied! ✓';
    btn.style.background = '#2D7A3A';
    setTimeout(function () {
      btn.innerText = orig;
      btn.style.background = '#1C2B1E';
    }, 2000);
  }

  window.showScriptModal = showScriptModal;
  window.closeScriptModal = closeScriptModal;
  window.switchScriptTab = switchScriptTab;
  window.copyScript = copyScript;
})();
