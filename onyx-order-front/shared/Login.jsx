import { useState } from 'react';
import { API, saveSession } from './session.js';

export default function Login({ title, onLogged }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      saveSession(data);
      onLogged(data);
    } catch (e2) { setErr(e2.message === 'Failed to fetch' ? "L'API ne répond pas (onyx-order-api lancée ?)" : e2.message); }
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1>{title}</h1>
      <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
      <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {err && <p className="err">{err}</p>}
      <button className="primary">Se connecter</button>
    </form>
  );
}
