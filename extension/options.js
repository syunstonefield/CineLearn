'use strict';
// CineLearn 設定ページ（options_ui）。字幕マーカーの挙動を chrome.storage.local に保存する。
// content.js が storage.onChanged で即時反映するため、保存＝その場で字幕に効く。

const modeSel = document.getElementById('marker-mode');
const hardChk = document.getElementById('hard-marker');
const savedNote = document.getElementById('saved-note');

// 現在値をロード（既定: subtle / 難語OFF＝没入優先のデフォルト）
chrome.storage.local.get(['cl_marker_mode', 'cl_hard_marker'], (r) => {
  modeSel.value = r.cl_marker_mode || 'subtle';
  hardChk.checked = r.cl_hard_marker === '1';
});

let savedTimer = null;
function save() {
  chrome.storage.local.set(
    {
      cl_marker_mode: modeSel.value,
      cl_hard_marker: hardChk.checked ? '1' : '0',
    },
    () => {
      savedNote.style.visibility = 'visible';
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (savedNote.style.visibility = 'hidden'), 1500);
    }
  );
}

modeSel.addEventListener('change', save);
hardChk.addEventListener('change', save);
