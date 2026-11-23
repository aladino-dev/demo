'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { captureTable } from './table';

const Ctx = createContext(null);
const KEY = 'onyx-cart';

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    captureTable();
    try { setItems(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  }, [items, ready]);

  const add = (line) => {
    const key = Date.now() + Math.random();
    setItems((xs) => {
      const options = line.options || [];
      const match = xs.find((item) => item.product_id === line.product_id
        && !item.note && !line.note
        && item.unit_cents === line.unit_cents
        && item.quantity + line.quantity <= 20
        && [...(item.options || [])].sort((a, b) => a - b).join() === [...options].sort((a, b) => a - b).join()); // mêmes options, mêmes doses
      return match
        ? xs.map((item) => item === match ? { ...item, quantity: item.quantity + line.quantity } : item)
        : [...xs, { ...line, key }];
    });
  };
  const setQty = (key, q) => setItems((xs) => xs.flatMap((x) => (x.key !== key ? [x] : q > 0 ? [{ ...x, quantity: q }] : [])));
  const clear = () => setItems([]);
  const count = items.reduce((a, x) => a + x.quantity, 0);
  const total = items.reduce((a, x) => a + x.unit_cents * x.quantity, 0);
  return <Ctx.Provider value={{ items, add, setQty, clear, count, total, ready }}>{children}</Ctx.Provider>;
}

export const useCart = () => useContext(Ctx);
