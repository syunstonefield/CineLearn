'use strict';
// CineLearn 設定ページ（options_ui）。字幕マーカーの挙動を chrome.storage.local に保存する。
// content.js が storage.onChanged で即時反映するため、保存＝その場で字幕に効く。

const modeSel = document.getElementById('marker-mode');
const hardChk = document.getElementById('hard-marker');
const disneyNavChk = document.getElementById('disney-nav-trial');
const savedNote = document.getElementById('saved-note');

// 現在値をロード（既定: subtle / 難語OFF＝没入優先のデフォルト）
chrome.storage.local.get(['cl_marker_mode', 'cl_hard_marker', 'cl_disney_nav_trial'], (r) => {
  modeSel.value = r.cl_marker_mode || 'subtle';
  hardChk.checked = r.cl_hard_marker === '1';
  disneyNavChk.checked = r.cl_disney_nav_trial === '1';
});

let savedTimer = null;
function save() {
  chrome.storage.local.set(
    {
      cl_marker_mode: modeSel.value,
      cl_hard_marker: hardChk.checked ? '1' : '0',
      cl_disney_nav_trial: disneyNavChk.checked ? '1' : '0',
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
disneyNavChk.addEventListener('change', save);

// ── 再生ログ（content.js の vidLog が chrome.storage.local 'cl_vid_log' に溜める直近300行）──
const vidlogTa = document.getElementById('vidlog');
const vidlogNote = document.getElementById('vidlog-note');
function loadVidLog(cb) {
  chrome.storage.local.get(['cl_vid_log'], (r) => cb((r.cl_vid_log || []).join('\n')));
}
document.getElementById('vidlog-show').addEventListener('click', () => {
  loadVidLog((text) => {
    vidlogTa.style.display = 'block';
    vidlogTa.value = text || '（まだ記録がありません。視聴ページを再読み込みしてから操作してください）';
    vidlogTa.scrollTop = vidlogTa.scrollHeight;
  });
});
document.getElementById('vidlog-copy').addEventListener('click', () => {
  loadVidLog((text) => {
    navigator.clipboard.writeText(text || '').then(
      () => { vidlogNote.textContent = `✓ ${text ? text.split('\n').length : 0} 行をコピーしました`; },
      () => { vidlogTa.style.display = 'block'; vidlogTa.value = text; vidlogTa.select(); vidlogNote.textContent = '選択してコピーしてください'; }
    );
  });
});
document.getElementById('vidlog-clear').addEventListener('click', () => {
  chrome.storage.local.remove('cl_vid_log', () => { vidlogTa.value = ''; vidlogNote.textContent = '消去しました'; });
});
