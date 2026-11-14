'use client';
// 読み上げの声の確認ページ（運営の確認用・2026-11-14 受付）。
// この端末のブラウザが出す英語の声の一覧と、アプリ（lib/speak.js）が選ぶ声を表示する。何も送らない・保存しない。
import { useEffect, useState } from 'react';
import { pickVoiceFrom, speak } from '@/lib/speak';

const SAMPLE = 'I will take a rain check on dinner.';

export default function TtsCheck() {
  const [voices, setVoices] = useState([]);
  const [ua, setUa] = useState('');
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const s = window.speechSynthesis;
    const load = () => setVoices(s.getVoices() || []);
    load();
    s.addEventListener?.('voiceschanged', load);
    const t = setInterval(load, 1000);
    setUa(navigator.userAgent);
    return () => {
      clearInterval(t);
      s.removeEventListener?.('voiceschanged', load);
    };
  }, []);
  const chromium = typeof navigator !== 'undefined' && !!navigator.userAgentData;
  const picked = pickVoiceFrom(voices, { chromium });
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  const play = (v) => {
    const s = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(SAMPLE);
    u.lang = v.lang || 'en-US';
    u.voice = v;
    window.__clTtsHold = u;
    s.speak(u);
    s.resume();
  };
  const box = { fontFamily: '-apple-system, sans-serif', padding: 16, fontSize: 14, lineHeight: 1.6, color: '#222', background: '#fff', minHeight: '100vh' };
  const btn = { fontSize: 14, padding: '6px 10px', margin: '4px 0', border: '1px solid #999', borderRadius: 8, background: '#f6f6f6' };
  return (
    <div style={box}>
      <h1 style={{ fontSize: 18 }}>読み上げの声の確認</h1>
      <p>声の数: 全部 {voices.length}／英語 {en.length}</p>
      <p>
        アプリが選ぶ声: <b>{picked ? `${picked.name}（${picked.lang}）` : 'ブラウザ任せ（端末の設定の声）'}</b>
      </p>
      <button style={btn} onClick={() => speak(SAMPLE)}>アプリと同じ方法で聞く</button>
      <h2 style={{ fontSize: 16, marginTop: 20 }}>英語の声の一覧</h2>
      {en.map((v, i) => (
        <div key={i} style={{ borderTop: '1px solid #ddd', padding: '6px 0' }}>
          <div>
            <b>{v.name}</b> {v.lang}
            {v.default ? '・既定' : ''}
            {v.localService === false ? '・オンライン' : ''}
          </div>
          <div style={{ fontSize: 12, color: '#555', wordBreak: 'break-all' }}>{v.voiceURI}</div>
          <button style={btn} onClick={() => play(v)}>この声で聞く</button>
        </div>
      ))}
      <p style={{ fontSize: 12, color: '#555', marginTop: 20, wordBreak: 'break-all' }}>{ua}</p>
    </div>
  );
}
