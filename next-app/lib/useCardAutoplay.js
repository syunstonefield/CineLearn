'use client';

// カードが出た時に、その語を1回だけ読み上げる（設定 cardAutoplay がオンの時だけ・2026-11-13）。
//   決まり（memory tts-web-speech-gotchas）: 読み上げは lib/speak.js の speak だけを使う＝
//   前の音が鳴っている時だけ cancel して間を空けてから鳴らす（cancel 直後の speak で固まる Chrome の件・Mac の声の件は speak.js 側）。
//   鳴らすのは「カードが変わった時」だけ（最初の1枚＝開くボタンのタップのあと／答えて次のカードに進んだあと）。
//   めくった時・答え合わせの時・同じカードのまま設定だけ変えた時は鳴らさない（オンにした瞬間だけは今のカードを1回鳴らす）。
//   使い方: useCardAutoplay({ text: 読み上げる文字（語か連語）, index: 何枚目か, active: カードが見えているか })
import { useEffect, useRef } from 'react';
import { useApp } from '@/components/AppProvider';
import { speak } from './speak';
import { isCardAutoplayOn, cardAutoplayKey } from './cardAutoplay';

export function useCardAutoplay({ text, index, active = true }) {
  const { settings } = useApp();
  const on = isCardAutoplayOn(settings);
  const lastKeyRef = useRef(null);
  const key = text ? cardAutoplayKey(index, text) : null;
  useEffect(() => {
    if (!on || !active || !key) return;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    speak(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, active, key]);
  // オフにしたら印を消す（またオンにした時に今のカードを1回鳴らせるように）
  useEffect(() => {
    if (!on) lastKeyRef.current = null;
  }, [on]);
}
