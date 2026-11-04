'use client';
import { createContext, useContext, useEffect, useState } from 'react';

const Ctx = createContext(null);
const KEY = 'onyx-cart';

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setItems(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  }, [items, ready]);

  const add = (line) => setItems((xs) => [...xs, { ...line, key: Date.now() + Math.random() }]);
  const setQty = (key, q) => setItems((xs) => xs.flatMap((x) => (x.key !== key ? [x] : q > 0 ? [{ ...x, quantity: q }] : [])));
  const clear = () => setItems([]);
  const count = items.reduce((a, x) => a + x.quantity, 0);
  const total = items.reduce((a, x) => a + x.unit_cents * x.quantity, 0);
  return <Ctx.Provider value={{ items, add, setQty, clear, count, total, ready }}>{children}</Ctx.Provider>;
}

export const useCart = () => useContext(Ctx);
