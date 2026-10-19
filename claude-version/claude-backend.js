/* =============================================================
   GetTogether – Claude-backend
   Efterligner den del af Supabase-klienten, som fællesskabet bruger,
   men gemmer alt i Claude-sidens delte database (db-capability)
   og bruger din Claude-konto som login (user-capability).
   Kun til Claude-versionen – den udgivne app bruger rigtig Supabase.
   ============================================================= */
(function(){
  'use strict';
  const TABLES = ['profiles','rooms','messages','direct_messages','blocks','reports','friendships','groups','group_members','group_messages'];
  const BIG = { messages:1, direct_messages:1, group_messages:1 };   // vis de nyeste 1000
  const mem = {}; TABLES.forEach(t => mem[t] = new Map());
  mem.calls = new Map();   // opkald findes ikke i Claude-versionen
  let uid = null, owner = false, DB = null, USER = null, initP = null;
  let listeners = [], chans = [], authCbs = [];
  const now = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
  let lastNum = 0;
  const numId = () => { let n = Date.now() * 1000 + Math.floor(Math.random() * 1000); if (n <= lastNum) n = lastNum + 1; lastNum = n; return n; };
  const keyOf = (t, r) => t === 'blocks' ? `${r.blocker}_${r.blocked}` : t === 'group_members' ? `${r.group_id}_${r.user_id}` : String(r.id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v);
  const same = (a, b) => stable(a) === stable(b);

  // ---------- hvem må se hvad (spejler reglerne i den rigtige database) ----------
  const isMember = (g, u) => mem.group_members.has(`${g}_${u}`);
  const friends = (a, b) => [...mem.friendships.values()].some(f => f.status === 'accepted' && ((f.requester === a && f.addressee === b) || (f.requester === b && f.addressee === a)));
  const blockedPair = (a, b) => mem.blocks.has(`${a}_${b}`) || mem.blocks.has(`${b}_${a}`);
  const profile = id => mem.profiles.get(id);
  const canSee = (t, r) => ({
    profiles: () => !r.banned || r.id === uid || owner,
    direct_messages: () => uid === r.sender || uid === r.recipient,
    friendships: () => uid === r.requester || uid === r.addressee,
    groups: () => isMember(r.id, uid) || r.owner === uid || owner,
    group_members: () => isMember(r.group_id, uid),
    group_messages: () => isMember(r.group_id, uid),
    blocks: () => r.blocker === uid,
    reports: () => owner || r.reporter === uid,
    messages: () => { const room = mem.rooms.get(r.room_id); const me = profile(uid); return !room || !room.gender_only || owner || (me && me.gender === room.gender_only); },
  }[t] || (() => true))();

  // ---------- realtime til appen ----------
  function emit(table, type, row){
    listeners.filter(l => l.table === table && (l.event === '*' || l.event === type)).forEach(l => {
      if (l.filter && type !== 'DELETE' && String(row[l.filter[0]]) !== l.filter[1]) return;
      if (type !== 'DELETE' && !canSee(table, row)) return;
      setTimeout(() => l.cb(type === 'DELETE' ? { eventType:type, old:{ ...row } } : { eventType:type, new:{ ...row } }), 0);
    });
  }
  function norm(t, r){
    if (t === 'profiles') r.is_admin = r.id === uid && owner;
    return r;
  }
  function applyRemote(t, key, row, initial){
    const had = mem[t].get(key);
    if (row === null){ if (had){ mem[t].delete(key); if (!initial) emit(t, 'DELETE', had); } return; }
    row = norm(t, row);
    if (had && same(had, row)) return;
    mem[t].set(key, row);
    if (!initial) emit(t, had ? 'UPDATE' : 'INSERT', row);
  }

  // ---------- forbind til Claude ----------
  function init(){
    if (initP) return initP;
    initP = (async () => {
      const c = window.claude;
      if (!c || !c.use) return;
      [USER, DB] = await Promise.all([c.use('user'), c.use('db')]);
      if (!USER || !DB) return;
      uid = await USER.id();
      owner = await USER.isOwner();
      if (!uid) return;
      const waits = [];
      for (const t of TABLES){
        waits.push(new Promise(res => {
          let first = true; const done = () => { if (first){ first = false; res(); } };
          setTimeout(done, 8000);
          if (t === 'reports'){
            DB.collection('reports').onSnapshot(snap => {
              for (const ch of snap.docChanges()){
                const reporter = ch.doc.id, items = (ch.doc.data() || {}).items || {};
                const keep = new Set(ch.type === 'removed' ? [] : Object.keys(items));
                for (const [k, r] of [...mem.reports]) if (r.reporter === reporter && !keep.has(k)) applyRemote('reports', k, null, first);
                if (ch.type !== 'removed') for (const id in items) applyRemote('reports', id, clone(items[id]), first);
              }
              done();
            }, () => done());
            return;
          }
          let q = DB.collection(t);
          if (BIG[t]) q = q.orderBy('created_at', 'desc').limit(1000);
          q.onSnapshot(snap => {
            for (const ch of snap.docChanges()){
              if (ch.type === 'removed'){ applyRemote(t, ch.doc.id, null, first); continue; }
              applyRemote(t, ch.doc.id, clone(ch.doc.data()), first);
            }
            done();
          }, () => done());
        }));
      }
      await Promise.all(waits);
    })();
    return initP;
  }

  // ---------- skriv til databasen ----------
  function dbErr(e){
    const code = e && e.code;
    if (code === 'invalid_argument') return { message:'Du har kun læseadgang til fællesskabet. Bed ejeren om at give dig adgang som bidragyder.', code:'42501' };
    if (code === 'quota_exceeded') return { message:'Fællesskabets lager er fyldt. Ejeren skal rydde gamle beskeder op.', code:'quota' };
    if (code === 'resource_exhausted') return { message:'Du skriver for hurtigt – vent et øjeblik.', code:'rate' };
    return { message:'Kunne ikke gemme. Tjek din forbindelse og prøv igen.', code:'unavailable' };
  }
  async function persistSet(t, row){
    if (t === 'reports'){
      const ref = DB.doc('reports/' + row.reporter);
      const snap = await ref.get();
      if (snap.exists) await ref.update({ items:{ [row.id]:row } }); else await ref.set({ items:{ [row.id]:row } });
      return;
    }
    const body = clone(row); if (t === 'profiles') delete body.is_admin;
    await DB.doc(t + '/' + keyOf(t, row)).set(body);
  }
  async function persistPatch(t, row, patch){
    if (t === 'reports') return DB.doc('reports/' + row.reporter).update({ items:{ [row.id]:patch } });
    const body = clone(patch); if (t === 'profiles') delete body.is_admin;
    await DB.doc(t + '/' + keyOf(t, row)).update(body);
  }
  async function persistDelete(t, row){
    if (t === 'reports'){ const ref = DB.doc('reports/' + row.reporter); const s = await ref.get(); if (!s.exists) return; const items = { ...((s.data() || {}).items || {}) }; delete items[row.id]; return ref.set({ items }); }
    await DB.doc(t + '/' + keyOf(t, row)).delete();
  }

  // ---------- forespørgsler i Supabase-stil ----------
  function split(s){ const out = []; let d = 0, cur = ''; for (const ch of s){ if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d){ out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
  function leaf(t){ const [c, , ...v] = t.split('.'); const val = v.join('.'); return r => String(r[c]) === val; }
  function orFn(expr){ const terms = split(expr).map(t => { if (t.startsWith('and(')){ const subs = split(t.slice(4, -1)).map(leaf); return r => subs.every(f => f(r)); } return leaf(t); }); return r => terms.some(f => f(r)); }
  const err = (message, code) => ({ data:null, error:{ message, code } });

  function q(table){
    let op = 'select', filters = [], payload = null, ord = null, lim = null, single = null;
    const b = {
      select(){ return b; },
      insert(p){ op = 'insert'; payload = p; return b; }, update(p){ op = 'update'; payload = p; return b; }, delete(){ op = 'delete'; return b; },
      eq(c, v){ filters.push(r => String(r[c]) === String(v)); return b; }, lt(c, v){ filters.push(r => r[c] < v); return b; },
      in(c, v){ const s = v.map(String); filters.push(r => s.includes(String(r[c]))); return b; },
      or(e){ filters.push(orFn(e)); return b; }, order(c, o){ ord = [c, o?.ascending !== false]; return b; }, limit(n){ lim = n; return b; },
      maybeSingle(){ single = 'maybe'; return b; }, single(){ single = 'one'; return b; },
      then(res, rej){ return init().then(run).then(res, rej); },
    };

    async function insertOne(p){
      if (!uid) return err('Ikke logget ind', '401');
      const r = { ...p };
      if (['messages','direct_messages','group_messages','reports'].includes(table)) r.id = numId();
      if (['groups','friendships'].includes(table)) r.id = uuid();
      r.created_at = now();
      const me = profile(uid);
      if (table !== 'profiles' && me && me.banned) return err('Din konto er udelukket.', '42501');
      if (table === 'profiles'){
        r.id = uid;
        if ([...mem.profiles.values()].some(x => x.id !== uid && x.nickname.toLowerCase() === String(r.nickname).toLowerCase())) return err('duplicate key value violates unique constraint "profiles_nickname_unique"', '23505');
        r.banned = false; r.banned_reason = null;
      }
      if (table === 'messages'){
        r.user_id = uid; const room = mem.rooms.get(r.room_id);
        if (!room) return err('Rummet findes ikke.', '42501');
        if (room.gender_only && me && room.gender_only !== me.gender) return err('Rummet er ikke for dig.', '42501');
      }
      if (table === 'group_messages'){ r.user_id = uid; if (!isMember(r.group_id, uid)) return err('rls', '42501'); }
      if (table === 'direct_messages'){
        r.sender = uid; const t = profile(r.recipient);
        if (!t || blockedPair(uid, r.recipient) || !(friends(uid, r.recipient) || t.dm_pref === 'alle' || (t.dm_pref === 'samme_koen' && me && t.gender === me.gender))) return err('new row violates row-level security policy', '42501');
      }
      if (table === 'friendships'){
        r.requester = uid; r.status = 'pending'; r.accepted_at = null;
        if (blockedPair(uid, r.addressee)) return err('rls', '42501');
        if ([...mem.friendships.values()].some(f => (f.requester === uid && f.addressee === r.addressee) || (f.requester === r.addressee && f.addressee === uid))) return err('duplicate key value violates unique constraint "friendships_pair_unique"', '23505');
      }
      if (table === 'groups'){
        r.owner = uid;
        if ([...mem.groups.values()].filter(g => g.owner === uid).length >= 20) return err('Du kan højst eje 20 grupper.');
      }
      if (table === 'group_members'){
        const g = mem.groups.get(r.group_id);
        if (!g || g.owner !== uid) return err('rls', '42501');
        if (r.user_id !== uid && !friends(uid, r.user_id)) return err('Du kan kun tilføje dine venner til en gruppe.');
        if ([...mem.group_members.values()].filter(m => m.group_id === r.group_id).length >= 50) return err('En gruppe kan højst have 50 medlemmer.');
        r.role = r.user_id === g.owner ? 'owner' : 'member'; r.joined_at = now(); r.added_by = uid;
      }
      if (table === 'blocks') r.blocker = uid;
      if (table === 'reports'){
        r.reporter = uid; r.status = 'ny';
        const src = { message:mem.messages, gmessage:mem.group_messages, dm:mem.direct_messages }[r.kind];
        const m = src && src.get(String(r.target_id));
        if (m){ r.snapshot = m.body; r.target_user = m.user_id || m.sender; }
        if (r.kind === 'profile'){ r.target_user = r.target_id; const p = profile(r.target_id); r.snapshot = p ? `${p.nickname} – ${p.bio || ''}` : null; }
      }
      if (table === 'rooms' && !owner) return err('rls', '42501');
      const key = keyOf(table, r);
      const prev = mem[table].get(key);
      mem[table].set(key, norm(table, r)); emit(table, prev ? 'UPDATE' : 'INSERT', r);
      try { await persistSet(table, r); }
      catch(e){ if (prev) mem[table].set(key, prev); else mem[table].delete(key); emit(table, 'DELETE', r); return { data:null, error:dbErr(e) }; }
      // afledte skrivninger
      if (table === 'groups') await insertMember({ group_id:r.id, user_id:uid, role:'owner', joined_at:now(), added_by:uid });
      if (table === 'blocks'){
        for (const f of [...mem.friendships.values()]) if ((f.requester === uid && f.addressee === r.blocked) || (f.requester === r.blocked && f.addressee === uid)){
          mem.friendships.delete(f.id); emit('friendships', 'DELETE', f); persistDelete('friendships', f).catch(() => {});
        }
      }
      return { data:r };
    }
    async function insertMember(m){ const key = keyOf('group_members', m); mem.group_members.set(key, m); emit('group_members', 'INSERT', m); try { await persistSet('group_members', m); } catch(e){} }

    async function run(){
      const rows = mem[table]; const match = r => filters.every(f => f(r)) && canSee(table, r);
      if (op === 'insert'){
        const list = Array.isArray(payload) ? payload : [payload]; const out = [];
        for (const p of list){ const res = await insertOne(p); if (res.error) return res; out.push(res.data); }
        return { data: single ? out[0] : out, error:null };
      }
      if (op === 'update'){
        const hit = [...rows.values()].filter(match);
        let patch = { ...payload };
        for (const r of hit){
          if (table === 'friendships'){ if (r.addressee !== uid) continue; if (patch.status === 'accepted' && r.status === 'pending') patch.accepted_at = now(); }
          if (table === 'profiles'){ if (r.id !== uid && !owner) continue; if (r.id === uid && !owner){ delete patch.gender; delete patch.banned; delete patch.banned_reason; } if ('nickname' in patch && [...rows.values()].some(x => x.id !== r.id && x.nickname.toLowerCase() === String(patch.nickname).toLowerCase())) return err('duplicate key value violates unique constraint "profiles_nickname_unique"', '23505'); }
          if (table === 'groups' && r.owner !== uid) continue;
          if (table === 'reports' && !owner) continue;
          const before = { ...r }; const key = keyOf(table, r);
          Object.assign(r, patch); emit(table, 'UPDATE', r);
          try { await persistPatch(table, r, patch); }
          catch(e){ mem[table].set(key, before); emit(table, 'UPDATE', before); return { data:null, error:dbErr(e) }; }
        }
        return { data: single ? hit[0] : hit, error:null };
      }
      if (op === 'delete'){
        const hit = [...rows.values()].filter(match);
        for (const r of hit){
          const mine = { messages:r.user_id, group_messages:r.user_id, direct_messages:r.sender, friendships:(r.requester === uid || r.addressee === uid) ? uid : null, blocks:r.blocker, groups:r.owner, profiles:r.id }[table];
          const groupOwner = (table === 'group_members' || table === 'group_messages') && mem.groups.get(r.group_id)?.owner === uid;
          const self = table === 'group_members' && r.user_id === uid && r.role !== 'owner';
          if (!(owner || mine === uid || groupOwner || self)) continue;
          if (table === 'group_members' && r.role === 'owner' && !owner) continue;
          const key = keyOf(table, r);
          rows.delete(key); emit(table, 'DELETE', r);
          try { await persistDelete(table, r); } catch(e){ rows.set(key, r); emit(table, 'INSERT', r); return { data:null, error:dbErr(e) }; }
          if (table === 'groups'){
            for (const m of [...mem.group_members.values()]) if (m.group_id === r.id){ mem.group_members.delete(keyOf('group_members', m)); persistDelete('group_members', m).catch(() => {}); }
            for (const m of [...mem.group_messages.values()]) if (m.group_id === r.id){ mem.group_messages.delete(String(m.id)); persistDelete('group_messages', m).catch(() => {}); }
          }
        }
        return { data:null, error:null };
      }
      let out = [...rows.values()].filter(match).map(r => ({ ...r }));
      if (ord) out.sort((a, b) => (a[ord[0]] > b[ord[0]] ? 1 : a[ord[0]] < b[ord[0]] ? -1 : 0) * (ord[1] ? 1 : -1));
      if (lim) out = out.slice(0, lim);
      if (single === 'maybe') return { data:out[0] || null, error:null };
      if (single === 'one') return out[0] ? { data:out[0], error:null } : err('no rows');
      return { data:out, error:null };
    }
    return b;
  }

  async function deleteMyAccount(){
    await init();
    const del = async (t, pred) => { for (const r of [...mem[t].values()]) if (pred(r)){ mem[t].delete(keyOf(t, r)); try { await persistDelete(t, r); } catch(e){} } };
    const myGroups = new Set([...mem.groups.values()].filter(g => g.owner === uid).map(g => g.id));
    await del('messages', r => r.user_id === uid);
    await del('direct_messages', r => r.sender === uid);
    await del('group_messages', r => r.user_id === uid || myGroups.has(r.group_id));
    await del('group_members', r => r.user_id === uid || myGroups.has(r.group_id));
    await del('groups', r => r.owner === uid);
    await del('friendships', r => r.requester === uid || r.addressee === uid);
    await del('blocks', r => r.blocker === uid);
    try { await DB.doc('reports/' + uid).delete(); } catch(e){}
    await del('profiles', r => r.id === uid);
  }

  window.supabase = { createClient(){ return {
    auth:{
      async getSession(){ await init(); return { data:{ session: uid ? { user:{ id:uid, email:null }, access_token:'claude' } : null } }; },
      onAuthStateChange(cb){ authCbs.push(cb); },
      async signInWithOtp(){ return { data:{}, error:{ message:'Login sker med din Claude-konto.' } }; },
      async verifyOtp(){ return { data:{}, error:{ message:'Login sker med din Claude-konto.' } }; },
      async signOut(){},
    },
    realtime:{ setAuth(){} },
    from:q,
    async rpc(name){ if (name === 'delete_my_account'){ await deleteMyAccount(); return { data:null, error:null }; } return err('Ukendt funktion'); },
    channel(name){
      const ch = { name, bcs:[],
        on(type, o, cb){ if (type === 'postgres_changes') listeners.push({ table:o.table, event:o.event, filter:o.filter ? o.filter.split('=eq.') : null, cb, ch }); else if (type === 'broadcast') ch.bcs.push({ event:o.event, cb }); return ch; },
        subscribe(cb){ chans.push(ch); setTimeout(() => cb && cb('SUBSCRIBED'), 0); return ch; },
        send(){ return Promise.resolve('ok'); },
        unsubscribe(){},
      };
      return ch;
    },
    removeChannel(ch){ listeners = listeners.filter(l => l.ch !== ch); chans = chans.filter(c => c !== ch); },
  }; } };

  // Hjælpere til den indlejrede side
  window.GT_BACKEND = { init, info: () => ({ uid, owner }) };
})();
