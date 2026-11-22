import { useEffect, useState } from 'react';
import { SPEECH_LANG } from '../i18n.js';
import Icon from './Icon.jsx';

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// Reads text aloud with the device's own voices. Hidden where the device has none.
export default function ListenButton({ t, lang, text, autoPlay = false }) {
  const [speaking, setSpeaking] = useState(false);

  function play() {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG[lang] ?? 'en-US';
    utterance.rate = 0.9;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    if (autoPlay && supported()) play();
    return () => { if (supported()) window.speechSynthesis.cancel(); };
    // Only on first show: re-reading on every poll would talk over the worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supported()) return null;
  return (
    <button
      type="button"
      className="ghost small-button listen-button"
      onClick={() => { if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); } else play(); }}
    >
      {speaking ? <><Icon name="stop" size={16} />{t.stopListening}</> : <><Icon name="speaker" size={16} />{t.listen}</>}
    </button>
  );
}
