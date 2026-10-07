// Optional cloud sync keyed by a name the user types (no accounts, no auth). Exposes window.Sync.
// Sessions live at pvtCheck/{name}/sessions/{ts}. If this module fails to load, the app still works locally.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, collection, doc, setDoc, getDocs, writeBatch }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const db = getFirestore(initializeApp(firebaseConfig));
const KEY = 'attn.name';
const clean = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, '-');
const VALID = /^[a-z0-9_-]{1,32}$/;

let name = null;
try { name = clean(localStorage.getItem(KEY)); } catch {}
if (!VALID.test(name)) name = null;

const col = () => collection(db, 'pvtCheck', name, 'sessions');

window.Sync = {
  name: () => name,
  setName(n) {
    const c = clean(n);
    if (c && !VALID.test(c)) throw new Error('Use 1–32 letters, digits, - or _');
    name = c || null;
    try { name ? localStorage.setItem(KEY, name) : localStorage.removeItem(KEY); } catch {}
  },
  async fetchAll() {
    return (await getDocs(col())).docs.map((d) => d.data());
  },
  push: (s) => setDoc(doc(col(), String(s.ts)), s),
  async deleteAll() {
    const docs = (await getDocs(col())).docs;
    for (let i = 0; i < docs.length; i += 400) {
      const b = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  },
};
window.dispatchEvent(new Event('sync-ready'));
