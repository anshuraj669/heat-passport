import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const PHONES = [
  { number: '+15595550124', label: 'Juan · flip phone (registered)' },
  { number: '+16025550152', label: 'Aisha · registered' },
  { number: '+12105550199', label: 'Unknown number' },
];
const QUICK = ['Hola', 'HP-DC11', 'HP-RK90', 'MAL', '1', 'SICK HP-DC11'];

export default function Sms() {
  const [from, setFrom] = useState(PHONES[0].number);
  const [text, setText] = useState('');
  const [thread, setThread] = useState([]);
  const threadRef = useRef(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);
  useEffect(() => {
    setThread([]);
  }, [from]);

  async function send(body) {
    if (!body.trim()) return;
    setThread((t) => [...t, { me: true, text: body }]);
    setText('');
    const { reply } = await api.sms(from, body);
    setThread((t) => [...t, { me: false, text: reply }]);
  }

  return (
    <div className="page sms-page">
      <div>
        <p className="eyebrow">Works on any phone</p>
        <h1>Heat Passport by text message</h1>
        <p className="lead">
          Many farmworkers and day laborers have a basic phone or no data plan. Texting the Heat Passport number gives
          the same safety plan in English, Spanish or Portuguese, and texting <strong>SICK</strong> or <strong>MAL</strong> sends
          first-aid steps, asks one question to spot heat stroke, and alerts the supervisor.
        </p>
        <ul className="facts">
          <li>Text a passport ID, e.g. <code>HP-JM24</code>, for today's plan.</li>
          <li>From a registered phone, any message works: no ID needed.</li>
          <li>Coworkers can report too: <code>SICK HP-DC11</code>, or <code>HP-RK90 collapsed</code>.</li>
        </ul>
        <label>
          Send as
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {PHONES.map((p) => <option key={p.number} value={p.number}>{p.label}</option>)}
          </select>
        </label>
      </div>

      <div className="phone" aria-label="Phone simulator">
        <div className="phone-top">Heat Passport · (555) 010-4328</div>
        <div className="phone-thread" ref={threadRef}>
          {thread.length === 0 && <p className="muted small center">Send a message to start.</p>}
          {thread.map((m, i) => <p key={i} className={`bubble ${m.me ? 'me' : 'them'}`}>{m.text}</p>)}
        </div>
        <div className="quick">
          {QUICK.map((q) => <button key={q} type="button" className="chip" onClick={() => send(q)}>{q}</button>)}
        </div>
        <form className="phone-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text message" aria-label="Text message" />
          <button>Send</button>
        </form>
      </div>
    </div>
  );
}
