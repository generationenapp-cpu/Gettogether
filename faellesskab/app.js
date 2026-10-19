/* =============================================================
   GetTogether Fællesskab – app
   Rum · Venner · Private grupper · Private beskeder · Opkald
   ============================================================= */
'use strict';

const CONFIG = window.APP_CONFIG || {};
const PREVIEW = !!CONFIG.PREVIEW;
const CONFIGURED = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(CONFIG.SUPABASE_URL || '')
  && !/DIT-PROJEKT/i.test(CONFIG.SUPABASE_URL) && (CONFIG.SUPABASE_ANON_KEY || '').length > 40;
const sb = CONFIGURED ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

const PAGE = 60;
const JOURNEY = { 'ny': 'Ny muslim', 'født': 'Født muslim', 'undersøger': 'Nysgerrig på islam' };
const DMPREF = { samme_koen: 'Venner og medlemmer af samme køn', alle: 'Alle medlemmer', ingen: 'Kun mine venner' };
const CITIES = ['København','Aarhus','Odense','Aalborg','Esbjerg','Vejle','Kolding','Horsens','Randers','Roskilde','Næstved','Herning','Silkeborg','Helsingør','Køge','Holbæk','Slagelse','Svendborg','Viborg','Fredericia'];
const GROUP_EMOJI = ['💬','🕌','📖','🌙','☕','⚽','🍲','🤲','🌱','🎓','🏃','👨‍👩‍👧'];
const ICE = CONFIG.ICE_SERVERS || [{ urls:'stun:stun.l.google.com:19302' }];
const EMBEDDED = !!CONFIG.EMBEDDED;          // kører inde i en anden side (fx Claude-versionen)
const CALLS = CONFIG.CALLS !== false;        // telefonopkald kan slås fra, hvor WebRTC ikke findes
const PRIVACY_URL = CONFIG.PRIVACY_URL === undefined ? 'privatliv.html' : CONFIG.PRIVACY_URL;
const ROOT = window.GT_ROOT || document;     // dokumentet – eller en shadow root, når appen er indlejret

/* =============================================================
   DATA-LAG (Supabase)
   ============================================================= */
const ok = ({ data, error }) => { if (error) throw error; return data; };
const me = () => state.user.id;

const api = {
  async session(){ const { data } = await sb.auth.getSession(); return data.session?.user || null; },
  onAuth(cb){ sb.auth.onAuthStateChange((_e, s) => cb(s?.user || null)); },
  async sendCode(email){ ok(await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } })); },
  async verifyCode(email, token){ ok(await sb.auth.verifyOtp({ email, token, type:'email' })); },
  async signOut(){ await sb.auth.signOut(); },

  // profil
  async myProfile(uid){ return ok(await sb.from('profiles').select('*').eq('id', uid).maybeSingle()); },
  async createProfile(p){ return ok(await sb.from('profiles').insert({ ...p, id: me() }).select().single()); },
  async updateProfile(p){ return ok(await sb.from('profiles').update(p).eq('id', me()).select().single()); },
  async deleteAccount(){ ok(await sb.rpc('delete_my_account')); },
  async members(){ return ok(await sb.from('profiles').select('*').eq('banned', false).order('created_at', { ascending:false }).limit(500)); },
  async profilesByIds(ids){ return ok(await sb.from('profiles').select('*').in('id', ids)); },

  // rum
  async rooms(){ return ok(await sb.from('rooms').select('*').order('sort')); },
  async messages(roomId, before){
    let q = sb.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending:false }).limit(PAGE);
    if (before) q = q.lt('created_at', before);
    return ok(await q).reverse();
  },
  async send(roomId, body){ ok(await sb.from('messages').insert({ room_id: roomId, body })); },
  async delMessage(id){ ok(await sb.from('messages').delete().eq('id', id)); },
  subRoom(roomId, cb){
    const ch = sb.channel('room-' + roomId)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:'room_id=eq.' + roomId }, cb)
      .on('postgres_changes', { event:'DELETE', schema:'public', table:'messages' }, cb)
      .subscribe();
    return () => sb.removeChannel(ch);
  },

  // private beskeder
  async dms(other){
    const m = me();
    return ok(await sb.from('direct_messages').select('*')
      .or(`and(sender.eq.${m},recipient.eq.${other}),and(sender.eq.${other},recipient.eq.${m})`)
      .order('created_at', { ascending:false }).limit(200)).reverse();
  },
  async sendDM(to, body){ ok(await sb.from('direct_messages').insert({ recipient: to, body })); },
  async threads(){
    const m = me();
    const data = ok(await sb.from('direct_messages').select('*').or(`sender.eq.${m},recipient.eq.${m}`).order('created_at', { ascending:false }).limit(500));
    const seen = new Map();
    for (const x of data){ const o = x.sender === m ? x.recipient : x.sender; if (!seen.has(o)) seen.set(o, x); }
    return [...seen].map(([other, last]) => ({ other, last }));
  },

  // venner
  async friendships(){ return ok(await sb.from('friendships').select('*')); },
  async requestFriend(uid){ ok(await sb.from('friendships').insert({ addressee: uid })); },
  async acceptFriend(fid){ ok(await sb.from('friendships').update({ status:'accepted' }).eq('id', fid)); },
  async removeFriendship(fid){ ok(await sb.from('friendships').delete().eq('id', fid)); },

  // grupper
  async myGroups(){
    const groups = ok(await sb.from('groups').select('*').order('created_at', { ascending:false }));
    if (!groups.length) return { groups, members:[], last:[] };
    const ids = groups.map(g => g.id);
    const [members, last] = await Promise.all([
      sb.from('group_members').select('*').in('group_id', ids).then(ok),
      sb.from('group_messages').select('*').in('group_id', ids).order('created_at', { ascending:false }).limit(400).then(ok),
    ]);
    return { groups, members, last };
  },
  async createGroup(name, emoji){ return ok(await sb.from('groups').insert({ name, emoji }).select().single()); },
  async addMembers(gid, uids){ if (uids.length) ok(await sb.from('group_members').insert(uids.map(u => ({ group_id: gid, user_id: u })))); },
  async removeMember(gid, uid){ ok(await sb.from('group_members').delete().eq('group_id', gid).eq('user_id', uid)); },
  async updateGroup(gid, p){ ok(await sb.from('groups').update(p).eq('id', gid)); },
  async deleteGroup(gid){ ok(await sb.from('groups').delete().eq('id', gid)); },
  async groupMessages(gid, before){
    let q = sb.from('group_messages').select('*').eq('group_id', gid).order('created_at', { ascending:false }).limit(PAGE);
    if (before) q = q.lt('created_at', before);
    return ok(await q).reverse();
  },
  async sendGroup(gid, body){ ok(await sb.from('group_messages').insert({ group_id: gid, body })); },
  async delGroupMessage(id){ ok(await sb.from('group_messages').delete().eq('id', id)); },

  // opkald
  async startCall(uid){ return ok(await sb.from('calls').insert({ callee: uid }).select().single()); },
  async setCallStatus(id, status){ ok(await sb.from('calls').update({ status }).eq('id', id)); },
  async callChannel(id){
    try { const { data } = await sb.auth.getSession(); if (data.session) sb.realtime.setAuth(data.session.access_token); } catch(e){}
    return sb.channel('call:' + id, { config:{ private:true, broadcast:{ self:false } } });
  },

  // alt der skal lyttes til, mens man er logget ind
  subLive(h){
    const m = me();
    const ch = sb.channel('live-' + m)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'direct_messages' }, p => h.dm(p.new))
      .on('postgres_changes', { event:'*', schema:'public', table:'friendships' }, p => h.friend(p))
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'group_members', filter:'user_id=eq.' + m }, p => h.joined(p.new))
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'group_messages' }, p => h.gmsg(p.new))
      .on('postgres_changes', { event:'DELETE', schema:'public', table:'group_messages' }, p => h.gdel(p.old))
      .on('postgres_changes', { event:'*', schema:'public', table:'calls' }, p => h.call(p))
      .subscribe();
    return () => sb.removeChannel(ch);
  },

  // blokering / rapporter
  async blocks(){ return ok(await sb.from('blocks').select('blocked')).map(b => b.blocked); },
  async block(uid){ ok(await sb.from('blocks').insert({ blocked: uid })); },
  async unblock(uid){ ok(await sb.from('blocks').delete().eq('blocker', me()).eq('blocked', uid)); },
  async report(kind, targetId, reason){ ok(await sb.from('reports').insert({ kind, target_id: String(targetId), reason })); },

  async exportMine(){
    const m = me();
    const [profile, messages, dms, blocks, friends, gmsgs, calls] = await Promise.all([
      sb.from('profiles').select('*').eq('id', m).single().then(ok),
      sb.from('messages').select('*').eq('user_id', m).order('created_at').then(ok),
      sb.from('direct_messages').select('*').or(`sender.eq.${m},recipient.eq.${m}`).order('created_at').then(ok),
      sb.from('blocks').select('*').then(ok),
      sb.from('friendships').select('*').then(ok),
      sb.from('group_messages').select('*').eq('user_id', m).order('created_at').then(ok),
      sb.from('calls').select('*').order('created_at').then(ok),
    ]);
    return { eksporteret: new Date().toISOString(), email: state.user.email, profil: profile,
      beskeder_i_rum: messages, private_beskeder: dms, gruppebeskeder: gmsgs, venskaber: friends, opkald: calls, blokeringer: blocks };
  },

  // moderation (kun admins – håndhæves også i databasen)
  async openReports(){ return ok(await sb.from('reports').select('*').eq('status', 'ny').order('created_at', { ascending:false }).limit(200)); },
  async resolveReport(id){ ok(await sb.from('reports').update({ status:'løst' }).eq('id', id)); },
  async resolveAllFor(kind, targetId){ ok(await sb.from('reports').update({ status:'løst' }).eq('kind', kind).eq('target_id', String(targetId)).eq('status', 'ny')); },
  async setBan(uid, banned, reason){ ok(await sb.from('profiles').update({ banned, banned_reason: banned ? reason : null }).eq('id', uid)); },
  async bannedUsers(){ return ok(await sb.from('profiles').select('*').eq('banned', true).order('nickname')); },
  subReports(cb){
    const ch = sb.channel('reports').on('postgres_changes', { event:'INSERT', schema:'public', table:'reports' }, cb).subscribe();
    return () => sb.removeChannel(ch);
  },
};

/* =============================================================
   STATE + HJÆLPERE
   ============================================================= */
const state = {
  ready:false, uidSet:undefined, user:null, profile:null,
  loginStep:'email', loginEmail:'',
  tab:'rooms', friendsTab:'mine',
  roomId:null, dmWith:null, groupId:null, msgs:[], hasMore:false,
  rooms:[], people:new Map(), members:null, threads:[], blocks:new Set(),
  friendships:[], groups:[], gMembers:new Map(), gLast:new Map(),
  q:'', jf:'alle', sheet:null, busy:false,
  reports:null, banned:null,
  subs:{ room:null, live:null, reports:null },
};
const $ = s => ROOT.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const COLORS = ['#34449C','#7a4fb5','#b8562f','#2f6fb5','#a33f6b','#3f7a4a','#9c7420','#2f7f86'];
const color = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; };
const avatar = (p, size = 42) => `<div class="av" style="background:${color(p.id)};width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px">${esc((p.nickname || '?')[0].toUpperCase())}</div>`;
const nick = id => state.people.get(id)?.nickname || 'Tidligere medlem';
function fmt(t){
  const d = new Date(t), n = new Date();
  const time = d.toLocaleTimeString('da-DK', { hour:'2-digit', minute:'2-digit' });
  return d.toDateString() === n.toDateString() ? time : d.toLocaleDateString('da-DK', { day:'numeric', month:'short' });
}
const clock = t => new Date(t).toLocaleTimeString('da-DK', { hour:'2-digit', minute:'2-digit' });
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
};
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3500); }
function errMsg(e, ctx){
  if (!e) return 'Noget gik galt.';
  const m = e.message || '';
  if (e.code === '23505' && /nickname/i.test(m + (e.details || ''))) return 'Kaldenavnet er allerede taget. Vælg et andet.';
  if (e.code === '23505' && /friendships/i.test(m + (e.details || ''))) return 'I har allerede en venneanmodning mellem jer.';
  if (e.code === '23505') return 'Findes allerede.';
  if (e.code === '42501' && ctx === 'dm') return 'Denne person tager kun imod beskeder fra venner. Send en venneanmodning først.';
  if (e.code === '42501') return 'Det har du ikke adgang til.';
  if (/Token has expired|invalid/i.test(m) && ctx === 'otp') return 'Koden er forkert eller udløbet. Prøv igen eller få en ny kode.';
  if (/rate limit|security purposes/i.test(m)) return 'Vent lidt, før du beder om en ny kode.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Ingen forbindelse. Tjek dit internet.';
  return m || 'Noget gik galt. Prøv igen.';
}
async function ensurePeople(ids){
  const missing = [...new Set(ids)].filter(id => id && !state.people.has(id));
  if (!missing.length) return;
  try { (await api.profilesByIds(missing)).forEach(p => state.people.set(p.id, p)); } catch(e){}
}

// ulæst
const lrKey = () => 'gt_lastread_' + state.user.id;
const lastRead = () => store.get(lrKey(), {});
function markRead(key){ const lr = lastRead(); lr[key] = new Date().toISOString(); store.set(lrKey(), lr); }
function isUnread(t){
  if (t.last.sender === state.user.id || state.blocks.has(t.other)) return false;
  const r = lastRead()[t.other];
  return !r || new Date(t.last.created_at) > new Date(r);
}
function isGroupUnread(gid){
  const l = state.gLast.get(gid); if (!l || l.user_id === state.user.id) return false;
  const r = lastRead()['g:' + gid];
  return !r || new Date(l.created_at) > new Date(r);
}
const unreadCount = () => state.threads.filter(isUnread).length + state.groups.filter(g => isGroupUnread(g.id)).length;

// venner
function relation(uid){
  const f = state.friendships.find(x => (x.requester === uid && x.addressee === state.user.id) || (x.addressee === uid && x.requester === state.user.id));
  if (!f) return { kind:'none' };
  if (f.status === 'accepted') return { kind:'friends', f };
  return { kind: f.requester === state.user.id ? 'outgoing' : 'incoming', f };
}
const friendIds = () => state.friendships.filter(f => f.status === 'accepted').map(f => f.requester === state.user.id ? f.addressee : f.requester).filter(id => !state.blocks.has(id));
const incoming = () => state.friendships.filter(f => f.status === 'pending' && f.addressee === state.user.id && !state.blocks.has(f.requester));
const outgoing = () => state.friendships.filter(f => f.status === 'pending' && f.requester === state.user.id);
const groupOf = gid => state.groups.find(g => g.id === gid);
const isOwner = g => g && g.owner === state.user.id;

const ICON = {
  rooms:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V10l7-6 7 6v11"/><path d="M10 21v-5h4v5"/></svg>',
  friends:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  chats:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  me:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  mod:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  send:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.99.99 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg>',
  chev:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  phone:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
  chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  mic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/></svg>',
  micoff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.7-1.3M19 10a7 7 0 0 1-1.2 3.9M5 10a7 7 0 0 0 10.7 6M12 19v3"/></svg>',
  hang:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.02 11.3 11.3 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9z"/></svg>',
  group:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5M16 14.6c3 .2 6 1.8 6 5"/></svg>',
};

/* =============================================================
   AUTH-FLOW
   ============================================================= */
async function setUser(u){
  const id = u?.id || null;
  if (id === state.uidSet) return;
  state.uidSet = id;
  unsubAll(); Call.reset();
  Object.assign(state, { user:u, profile:null, ready:false, tab:'rooms', roomId:null, dmWith:null, groupId:null,
    members:null, threads:[], friendships:[], groups:[], reports:null, banned:null, sheet:null, loginStep:'email' });
  state.people.clear(); state.gMembers.clear(); state.gLast.clear();
  drawSheet(); render();
  if (u){
    try { state.profile = await api.myProfile(u.id); }
    catch(e){ toast(errMsg(e)); }
    if (state.profile && !state.profile.banned) await afterProfile();
  }
  state.ready = true;
  render();
}
async function afterProfile(){
  state.people.set(state.profile.id, state.profile);
  try {
    const [rooms, blocks, threads, friendships] = await Promise.all([api.rooms(), api.blocks(), api.threads(), api.friendships()]);
    state.rooms = rooms; state.blocks = new Set(blocks); state.threads = threads; state.friendships = friendships;
    await loadGroups(true);
    await ensurePeople([...threads.map(t => t.other), ...friendships.flatMap(f => [f.requester, f.addressee])]);
  } catch(e){ toast(errMsg(e)); }
  state.subs.live = api.subLive({ dm:onDM, friend:onFriendChange, joined:onJoined, gmsg:onGroupMsg, gdel:onGroupDel, call:p => Call.onRow(p) });
  if (state.profile.is_admin){
    loadReports();
    state.subs.reports = api.subReports(() => { loadReports(); toast('Ny sag til moderation'); });
  }
}
function unsubRoom(){ if (state.subs.room){ state.subs.room(); state.subs.room = null; } }
function unsubAll(){ Object.keys(state.subs).forEach(k => { if (state.subs[k]){ state.subs[k](); state.subs[k] = null; } }); }

/* =============================================================
   VIEWS
   ============================================================= */
const LOGO = CONFIG.LOGO || '../icon-192.png';
const GUIDE_URL = CONFIG.GUIDE_URL || '../';
const STAR = '<svg class="star" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="13" y="13" width="22" height="22"/><rect x="13" y="13" width="22" height="22" transform="rotate(45 24 24)"/><circle cx="24" cy="24" r="4"/></svg>';
const inChat = () => !!(state.roomId || state.dmWith || state.groupId);

function render(){
  const app = $('#app');
  const off = navigator.onLine ? '' : '<div class="offline">Du er offline. Beskeder sendes, når forbindelsen er tilbage.</div>';
  if (!CONFIGURED){ app.innerHTML = viewNotConfigured(); return; }
  if (!state.ready){ app.innerHTML = off + '<main><div class="spin"></div></main>'; return; }
  if (!state.user){ app.innerHTML = off + viewLogin(); return; }
  if (!state.profile){ app.innerHTML = off + viewOnboarding(); return; }
  if (state.profile.banned){ app.innerHTML = viewBanned(); return; }

  const chat = inChat();
  let body;
  if (chat) body = viewChat();
  else if (state.tab === 'friends') body = viewFriends();
  else if (state.tab === 'chats') body = viewChats();
  else if (state.tab === 'me') body = viewMe();
  else if (state.tab === 'mod' && state.profile.is_admin) body = viewMod();
  else body = viewRooms();

  const showHeader = chat || state.tab !== 'rooms';
  app.innerHTML = off + (showHeader ? headerHTML() : '') + `<main id="main">${body}</main>${chat ? '' : viewNav()}`;
  if (chat) drawMsgs(true);
  if (!chat && state.tab === 'friends' && state.friendsTab === 'find') drawPeople();
}
function headerHTML(){
  const chat = inChat();
  let title = `<span class="brand"><img src="${LOGO}" alt="">${esc(CONFIG.APP_NAME)}<span class="by">by Malik</span></span>`, back = '', right = '';
  if (state.roomId){ const r = state.rooms.find(x => x.id === state.roomId); title = `<span>${esc(r?.emoji || '')}</span><span>${esc(r?.name || '')}</span>`; }
  if (state.dmWith){
    const p = state.people.get(state.dmWith) || { id:state.dmWith };
    title = `<button class="head-btn" data-action="person" data-id="${esc(state.dmWith)}">${avatar(p, 34)}<span><b>${esc(nick(state.dmWith))}</b><small>${relation(state.dmWith).kind === 'friends' ? 'Ven' : esc(JOURNEY[p.journey] || '')}</small></span></button>`;
    if (CALLS && relation(state.dmWith).kind === 'friends') right = `<button class="round-btn" data-action="call" data-id="${esc(state.dmWith)}" aria-label="Ring op">${ICON.phone}</button>`;
  }
  if (state.groupId){
    const g = groupOf(state.groupId) || {};
    const n = (state.gMembers.get(state.groupId) || []).length;
    title = `<button class="head-btn" data-action="groupinfo"><span class="tile small">${esc(g.emoji || '💬')}</span><span><b>${esc(g.name || '')}</b><small>${n} ${n === 1 ? 'medlem' : 'medlemmer'}</small></span></button>`;
  }
  if (chat) back = `<button class="icon-btn" data-action="back" aria-label="Tilbage">${ICON.back}</button>`;

  return `<header>${back}<h1>${title}</h1>${right}</header>`;
}
function drawNav(){ const n = $('nav'); if (n && state.profile) n.outerHTML = viewNav(); }

function viewNav(){
  const counts = { friends: incoming().length, chats: unreadCount(), mod: state.reports?.length || 0 };
  const t = (id, label) => `<button class="${state.tab === id ? 'on' : ''}" data-action="tab" data-id="${id}" ${state.tab === id ? 'aria-current="page"' : ''}>${ICON[id]}${label}${counts[id] ? `<span class="badge">${counts[id]}</span>` : ''}</button>`;
  return `<nav><button class="guide" data-action="guide" aria-label="Tilbage til guiden"><span class="g">نور</span>Guide</button>${t('rooms','Rum')}${t('friends','Venner')}${t('chats','Chats')}${t('me','Profil')}${state.profile.is_admin ? t('mod','Moderation') : ''}</nav>`;
}

const RULES = `<div class="rules"><h3>Sådan passer vi på hinanden</h3><ul>
  <li>Vis respekt – også når I er uenige. Ingen hadtale, mobning eller takfir.</li>
  <li>Fællesskabet er for voksne over 18 år.</li>
  <li>Ingen reklame, spam eller indsamling af penge.</li>
  <li>Del aldrig adresse, telefonnummer eller andres private oplysninger.</li>
  <li>Søstre- og brødrerummet er kun for det køn, der står på døren.</li>
  <li>Ser du noget, der ikke hører hjemme her, så rapportér det.</li>
  <li>Brud på reglerne kan betyde, at du bliver udelukket.</li></ul></div>`;

function viewNotConfigured(){
  return `<main><div class="card-center"><h2 class="page-title">Appen mangler sine nøgler</h2>
    <p class="muted">Indsæt din Supabase URL og anon-nøgle i <b>config.js</b> (README.md, trin 2) og upload igen.</p></div></main>`;
}

function viewLogin(){
  if (EMBEDDED) return `<main><div class="card-center"><h2 class="page-title">Log ind for at være med</h2><p class="muted">Fællesskabet bruger din Claude-konto. Åbn siden, mens du er logget ind, så kan du oprette en profil.</p><p class="fine"><button class="link" data-action="guide">Tilbage til guiden</button></p></div></main>`;
  const sent = state.loginStep === 'code';
  return `<main><div class="login">
    <section class="sky">
      <a class="backguide" href="${GUIDE_URL}">${ICON.back.replace('<svg','<svg width="18" height="18"')}Tilbage til guiden</a><br>
      <img src="${LOGO}" alt=""><span class="ar">معًا</span>
      <h2>Find dit fællesskab</h2>
      <p>Et trygt mødested for muslimer i Danmark – uanset om du er født muslim, ny i troen eller bare nysgerrig.</p>
    </section>
    <section class="login-sheet"><div class="inner">
      <form id="loginForm" novalidate class="step ${sent ? 'done' : ''}">
        <span class="step-n">${sent ? '✓' : '1'}</span>
        <div>
          <label class="f" for="email">Din e-mail</label>
          <input class="input" id="email" name="email" type="email" required placeholder="navn@mail.dk" autocomplete="email" value="${esc(state.loginEmail)}">
          <button class="btn wide ${sent ? 'ghost' : ''}" style="margin-top:10px" ${state.busy === 'send' ? 'disabled' : ''}>${state.busy === 'send' ? 'Sender kode…' : sent ? 'Send en ny kode' : 'Send kode'}</button>
          <p class="hint">${sent ? `Koden er sendt til <b>${esc(state.loginEmail)}</b>. Kig også i spam.` : 'Du får en kode på mail. Ingen adgangskode at huske.'}</p>
        </div>
      </form>
      <form id="codeForm" novalidate class="step">
        <span class="step-n">2</span>
        <div>
          <label class="f" for="code">Kode fra mailen</label>
          <input class="input code-input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="000000" value="${esc(state.code || '')}">
          <button class="btn wide" style="margin-top:10px;font-size:17px;padding:15px" ${state.busy === 'verify' ? 'disabled' : ''}>${state.busy === 'verify' ? 'Logger ind…' : 'Log ind'}</button>
        </div>
      </form>
      <p class="fine">Din e-mail er kun synlig for dig.<br><a href="privatliv.html">Sådan passer vi på dine data</a></p>
    </div></section>
  </div></main>`;
}

function viewOnboarding(){
  return `<main><div class="card-center">
    <h2 class="page-title">Fortæl lidt om dig</h2>
    <p class="muted" style="margin-top:0">Andre ser kun det, du skriver her. Et kaldenavn er helt fint.</p>
    <form id="onbForm">
      <label class="f" for="nick">Kaldenavn</label>
      <input class="input" id="nick" name="nickname" required minlength="2" maxlength="30" placeholder="Fx Yusuf, Amina eller bare M">
      <label class="f">Køn</label>
      <div class="seg">
        <label><input type="radio" name="gender" value="kvinde" required> Kvinde</label>
        <label><input type="radio" name="gender" value="mand" required> Mand</label>
      </div>
      <p class="hint">Giver adgang til søstre- eller brødrerummet. Kan ikke ændres bagefter.</p>
      <label class="f">Hvor er du på din vej?</label>
      <div class="choices">
        <label><input type="radio" name="journey" value="ny" required> <span>Jeg er ny muslim<small>Konverteret for nylig eller på vej</small></span></label>
        <label><input type="radio" name="journey" value="født" required> <span>Jeg er født muslim<small>Vokset op med troen</small></span></label>
        <label><input type="radio" name="journey" value="undersøger" required> <span>Jeg er nysgerrig på islam<small>Vil gerne lære og spørge</small></span></label>
      </div>
      <label class="f" for="city">By <span class="muted">(valgfri)</span></label>
      <input class="input" id="city" name="city" list="cities" maxlength="40" placeholder="Fx Aarhus">
      <datalist id="cities">${CITIES.map(c => `<option value="${c}">`).join('')}</datalist>
      <label class="f" for="bio">Lidt om dig <span class="muted">(valgfri)</span></label>
      <textarea class="input" id="bio" name="bio" rows="3" maxlength="300" placeholder="Hvad laver du til hverdag, og hvad håber du at finde her?"></textarea>
      <label class="f" for="ints">Interesser <span class="muted">(adskil med komma)</span></label>
      <input class="input" id="ints" name="interests" placeholder="Fodbold, arabisk, madlavning">
      <label class="f" for="dmp">Hvem må skrive privat til dig?</label>
      <select class="input" id="dmp" name="dm_pref">${Object.entries(DMPREF).map(([k, v]) => `<option value="${k}" ${k === 'samme_koen' ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <p class="hint">Dine venner kan altid skrive og ringe til dig.</p>
      ${CONFIG.ABOUT_HTML ? `<div class="rules" style="margin-top:24px"><h3>Om denne version</h3>${CONFIG.ABOUT_HTML}</div>` : ''}
      <div style="margin-top:24px">${RULES}</div>
      <label class="check"><input type="checkbox" name="adult" required> Jeg er fyldt 18 år.</label>
      <label class="check"><input type="checkbox" name="rules" required> Jeg følger reglerne ovenfor.</label>
      <label class="check"><input type="checkbox" name="consent" required> <span>Jeg giver samtykke til, at mine oplysninger – også at jeg er muslim eller interesseret i islam – behandles som beskrevet i ${PRIVACY_URL ? `<a href="${PRIVACY_URL}" target="_blank">privatlivspolitikken</a>` : 'beskrivelsen ovenfor'}. Jeg kan trække det tilbage ved at slette min konto.</span></label>
      <button class="btn wide" style="margin-top:6px;padding:15px">Gå ind i fællesskabet</button>
    </form>
    ${EMBEDDED ? '' : '<p class="fine"><button class="link" data-action="logout">Log ud</button></p>'}
  </div></main>`;
}

function viewBanned(){
  return `<main><div class="card-center">
    <h2 class="page-title">Din konto er udelukket</h2>
    <p class="muted">En moderator har udelukket din konto${state.profile.banned_reason ? ` med begrundelsen: <b>${esc(state.profile.banned_reason)}</b>` : '.'}</p>
    <p class="muted">Mener du, det er en fejl, så skriv til <a href="mailto:${esc(CONFIG.CONTACT_EMAIL)}">${esc(CONFIG.CONTACT_EMAIL)}</a>.</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:20px">
      ${EMBEDDED ? '' : '<button class="btn ghost" data-action="logout">Log ud</button>'}
      <button class="btn danger" data-action="deleteaccount">Slet min konto og alle mine data</button>
    </div></div></main>`;
}

function greeting(){
  const h = new Date().getHours();
  return h < 10 ? 'Godmorgen' : h < 18 ? 'Assalamu alaikum' : 'Godaften';
}

function viewRooms(){
  const vis = state.rooms.filter(r => !r.gender_only || r.gender_only === state.profile.gender);
  const row = r => `<li><button class="row" data-action="room" data-id="${esc(r.id)}">
    <span class="tile ${r.gender_only === 'kvinde' ? 'f' : r.gender_only === 'mand' ? 'm' : ''}">${esc(r.emoji || '💬')}</span>
    <span class="grow"><b>${esc(r.name)}</b><small>${esc(r.description || '')}</small></span>
    <span class="chev">${ICON.chev}</span></button></li>`;
  const common = vis.filter(r => !r.gender_only), own = vis.filter(r => r.gender_only);
  const inc = incoming().length;
  return `<section class="sky greet" style="padding-top:calc(26px + env(safe-area-inset-top))">
      <h2>${greeting()}, ${esc(state.profile.nickname)}</h2>
      <p>Hvad har du lyst til at tale om i dag?</p>
    </section>
    ${inc ? `<button class="notice" data-action="tab" data-id="friends">${ICON.friends}<span class="grow">${inc === 1 ? `${esc(nick(incoming()[0].requester))} vil gerne være ven med dig` : `${inc} venneanmodninger venter på dig`}</span>${ICON.chev}</button>` : ''}
    <h3 class="group-title">Fællesrum</h3>
    <div class="card-list"><ul class="list" style="padding:0">${common.map(row).join('')}</ul></div>
    ${own.length ? `<h3 class="group-title">${state.profile.gender === 'kvinde' ? 'Kun for søstre' : 'Kun for brødre'}</h3>
    <div class="card-list" style="margin-bottom:20px"><ul class="list" style="padding:0">${own.map(row).join('')}</ul></div>` : ''}`;
}

function viewChat(){
  return `<div id="msgs" class="msgs"><div class="spin"></div></div>
  <form id="composer" class="composer">
    <textarea class="input" name="body" rows="1" maxlength="2000" placeholder="Skriv en besked" aria-label="Besked"></textarea>
    <button class="send" aria-label="Send">${ICON.send}</button>
  </form>`;
}

function dayLabel(t){
  const d = new Date(t), n = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === n.toDateString()) return 'I dag';
  if (d.toDateString() === y.toDateString()) return 'I går';
  return d.toLocaleDateString('da-DK', { weekday:'long', day:'numeric', month:'long' });
}

function drawMsgs(force, keepTop){
  const box = $('#msgs'); if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
  const prevH = box.scrollHeight, prevTop = box.scrollTop;
  const mode = state.dmWith ? 'dm' : state.groupId ? 'group' : 'room';
  const author = m => mode === 'dm' ? m.sender : m.user_id;
  const list = state.msgs.filter(m => !state.blocks.has(author(m)));
  let prev = null, prevDay = null;
  const older = mode !== 'dm' && state.hasMore ? `<button class="btn ghost small older" data-action="older">Vis ældre beskeder</button>` : '';
  let emptyText;
  if (mode === 'dm') emptyText = `Sig salam til ${esc(nick(state.dmWith))} og start samtalen.`;
  else if (mode === 'group') emptyText = `Gruppen er klar. Skriv den første besked til ${esc(groupOf(state.groupId)?.name || 'gruppen')}.`;
  else emptyText = `Der er stille her endnu. Skriv den første besked i ${esc(state.rooms.find(r => r.id === state.roomId)?.name || 'rummet')}.`;
  const g = groupOf(state.groupId);
  box.innerHTML = older + (list.length ? list.map(m => {
    const uid = author(m);
    const mine = uid === state.user.id;
    const p = state.people.get(uid) || { nickname:'Tidligere medlem' };
    const day = new Date(m.created_at).toDateString();
    const sep = day !== prevDay ? `<div class="day">${dayLabel(m.created_at)}</div>` : '';
    const first = sep || prev !== uid;
    const showName = mode !== 'dm' && !mine && first;
    prev = uid; prevDay = day;
    const canDel = mode === 'room' ? (mine || state.profile.is_admin) : mode === 'group' ? (mine || isOwner(g) || state.profile.is_admin) : false;
    const rkind = mode === 'dm' ? 'dm' : mode === 'group' ? 'gmessage' : 'message';
    return `${sep}<div class="msg ${mine ? 'mine' : ''} ${first ? 'first' : ''}">
      ${showName ? `<div class="who"><button class="link" data-action="person" data-id="${esc(uid)}">${esc(p.nickname)}</button>${mode === 'room' && p.journey ? `, ${esc(JOURNEY[p.journey].toLowerCase())}` : ''}</div>` : ''}
      <div class="bubble">${esc(m.body).replace(/\n/g, '<br>')}</div>
      <div class="meta">${clock(m.created_at)}${!mine ? `&nbsp;&nbsp;<button class="link" data-action="report" data-kind="${rkind}" data-id="${m.id}">Rapportér</button>` : ''}${canDel ? `&nbsp;&nbsp;<button class="link" data-action="delmsg" data-id="${m.id}">Slet</button>` : ''}</div>
    </div>`;
  }).join('') : `<p class="empty">${STAR}${emptyText}</p>`);
  if (keepTop) box.scrollTop = box.scrollHeight - prevH + prevTop;
  else if (force || near) box.scrollTop = box.scrollHeight;
}

/* ---------- Venner ---------- */
function viewFriends(){
  const fr = friendIds(), inc = incoming(), out = outgoing();
  const seg = (id, label, n) => `<button class="${state.friendsTab === id ? 'on' : ''}" data-action="ftab" data-id="${id}">${label}${n ? ` <span class="count">${n}</span>` : ''}</button>`;
  let body = '';
  if (state.friendsTab === 'mine'){
    body = fr.length ? `<div class="card-list"><ul class="list" style="padding:0">${fr.sort((a, b) => nick(a).localeCompare(nick(b), 'da')).map(id => {
      const p = state.people.get(id) || { id, nickname:'…' };
      return `<li><div class="row">
        <button class="row-main" data-action="person" data-id="${esc(id)}">${avatar(p, 46)}<span class="grow"><b>${esc(p.nickname)}</b><small>${esc(JOURNEY[p.journey] || '')}${p.city ? ` i ${esc(p.city)}` : ''}</small></span></button>
        <button class="round-btn soft" data-action="dm" data-id="${esc(id)}" aria-label="Skriv til ${esc(p.nickname)}">${ICON.chat}</button>
        ${CALLS ? `<button class="round-btn" data-action="call" data-id="${esc(id)}" aria-label="Ring til ${esc(p.nickname)}">${ICON.phone}</button>` : ''}
      </div></li>`; }).join('')}</ul></div>`
      : `<p class="empty">${STAR}Du har ingen venner her endnu. Find nogen under Find folk og send en venneanmodning – så kan I skrive${CALLS ? ', ringe' : ''} og lave grupper sammen.</p>`;
  } else if (state.friendsTab === 'requests'){
    const reqRow = (f, inbound) => { const id = inbound ? f.requester : f.addressee; const p = state.people.get(id) || { id, nickname:'…' };
      return `<li><div class="row">
        <button class="row-main" data-action="person" data-id="${esc(id)}">${avatar(p, 46)}<span class="grow"><b>${esc(p.nickname)}</b><small>${inbound ? 'Vil gerne være ven med dig' : 'Venter på svar'}</small></span></button>
        ${inbound ? `<button class="btn small" data-action="accept" data-id="${f.id}">Accepter</button><button class="btn small ghost" data-action="unfriend" data-id="${f.id}">Afvis</button>`
                  : `<button class="btn small ghost" data-action="unfriend" data-id="${f.id}">Træk tilbage</button>`}
      </div></li>`; };
    body = (inc.length || out.length) ? `
      ${inc.length ? `<h3 class="group-title">Til dig</h3><div class="card-list"><ul class="list" style="padding:0">${inc.map(f => reqRow(f, true)).join('')}</ul></div>` : ''}
      ${out.length ? `<h3 class="group-title">Sendt af dig</h3><div class="card-list"><ul class="list" style="padding:0">${out.map(f => reqRow(f, false)).join('')}</ul></div>` : ''}`
      : `<p class="empty">${STAR}Ingen venneanmodninger lige nu.</p>`;
  } else {
    body = `<div class="pad" style="padding-top:4px">
      <input id="q" class="input" type="search" placeholder="Søg på navn, by eller interesse" value="${esc(state.q)}" style="background:var(--surface)">
      <div class="chips">${['alle','ny','født','undersøger'].map(j => `<button class="chip ${state.jf === j ? 'on' : ''}" data-action="jf" data-id="${j}">${j === 'alle' ? 'Alle' : JOURNEY[j]}</button>`).join('')}</div>
    </div><div id="people" class="cards"></div>`;
  }
  return `<div class="pad" style="padding-bottom:10px">
      <h2 class="hello">Venner</h2>
      <div class="segment">${seg('mine','Mine venner', fr.length)}${seg('requests','Anmodninger', inc.length)}${seg('find','Find folk')}</div>
    </div>${body}`;
}

function drawPeople(){
  const box = $('#people'); if (!box) return;
  if (!state.members){ box.innerHTML = '<div class="spin" style="grid-column:1/-1"></div>'; return; }
  const q = state.q.trim().toLowerCase();
  const list = state.members.filter(p => p.id !== state.user.id && !state.blocks.has(p.id)
    && (state.jf === 'alle' || p.journey === state.jf)
    && (!q || [p.nickname, p.city, ...(p.interests || [])].join(' ').toLowerCase().includes(q)));
  const relLabel = { friends:'Ven', outgoing:'Anmodning sendt', incoming:'Vil være ven med dig' };
  box.innerHTML = list.length ? list.map(p => { const r = relation(p.id).kind; return `<button class="pcard" data-action="person" data-id="${esc(p.id)}">
    <div style="display:flex;gap:12px;align-items:center">${avatar(p)}<div class="grow"><b style="font-weight:600">${esc(p.nickname)}</b><div class="muted" style="font-size:13.5px">${esc(JOURNEY[p.journey])}${p.city ? ` i ${esc(p.city)}` : ''}</div></div>${r !== 'none' ? `<span class="tag">${relLabel[r]}</span>` : ''}</div>
    ${p.bio ? `<div class="bio">${esc(p.bio)}</div>` : ''}
    ${p.interests?.length ? `<div class="ints">${p.interests.map(i => `<span>${esc(i)}</span>`).join('')}</div>` : ''}
  </button>`; }).join('') : `<p class="empty" style="grid-column:1/-1">${STAR}${state.members.length <= 1 ? 'Du er blandt de første her. Del appen med en ven, så fællesskabet kan vokse.' : 'Ingen passer på din søgning. Prøv et andet ord eller vælg Alle.'}</p>`;
}

/* ---------- Chats (grupper + private beskeder) ---------- */
function viewChats(){
  const items = [
    ...state.groups.map(g => ({ kind:'g', g, at: state.gLast.get(g.id)?.created_at || g.created_at })),
    ...state.threads.filter(t => !state.blocks.has(t.other)).map(t => ({ kind:'d', t, at: t.last.created_at })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  const head = `<div class="pad" style="padding-bottom:12px;display:flex;align-items:center;gap:10px">
      <h2 class="hello grow" style="margin:0">Chats</h2>
      <button class="btn small" data-action="newgroup" style="display:flex;align-items:center;gap:6px">${ICON.plus.replace('<svg','<svg width="16" height="16"')}Ny gruppe</button>
    </div>`;
  if (!items.length) return head + `<p class="empty">${STAR}Ingen samtaler endnu. Skriv til en ven, eller lav en privat gruppe med dine venner.</p>`;
  return head + `<div class="card-list"><ul class="list" style="padding:0">${items.map(it => {
    if (it.kind === 'g'){
      const l = state.gLast.get(it.g.id); const un = isGroupUnread(it.g.id);
      const preview = l ? `${l.user_id === state.user.id ? 'Dig' : esc(nick(l.user_id))}: ${esc(l.body)}` : 'Ingen beskeder endnu';
      return `<li><button class="row ${un ? 'unread' : ''}" data-action="group" data-id="${esc(it.g.id)}"><span class="tile">${esc(it.g.emoji || '💬')}</span>
        <span class="grow"><b>${esc(it.g.name)}</b><small>${preview}</small></span>
        <span class="muted when" style="font-size:12.5px;align-self:flex-start;margin-top:4px">${l ? fmt(l.created_at) : ''}</span></button></li>`;
    }
    const t = it.t, p = state.people.get(t.other) || { id:t.other, nickname:'Tidligere medlem' };
    return `<li><button class="row ${isUnread(t) ? 'unread' : ''}" data-action="dm" data-id="${esc(t.other)}">${avatar(p, 46)}
      <span class="grow"><b>${esc(p.nickname)}</b><small>${t.last.sender === state.user.id ? 'Dig: ' : ''}${esc(t.last.body)}</small></span>
      <span class="muted when" style="font-size:12.5px;align-self:flex-start;margin-top:4px">${fmt(t.last.created_at)}</span></button></li>`;
  }).join('')}</ul></div>`;
}

function viewMe(){
  const p = state.profile;
  const blocked = [...state.blocks];
  return `<div class="card-center">
    <div style="display:flex;gap:14px;align-items:center">${avatar(p, 64)}<div><h2 style="margin:0;font-size:24px">${esc(p.nickname)}</h2><div class="muted">${esc(JOURNEY[p.journey])}, ${p.gender === 'kvinde' ? 'søster' : 'broder'} · ${friendIds().length} ${friendIds().length === 1 ? 'ven' : 'venner'}</div></div></div>
    <h3 class="section-title">Din profil</h3>
    <form id="meForm" class="panel">
      <label class="f" style="margin-top:0">Kaldenavn</label><input class="input" name="nickname" required minlength="2" maxlength="30" value="${esc(p.nickname)}">
      <label class="f">By</label><input class="input" name="city" list="cities" maxlength="40" value="${esc(p.city || '')}">
      <datalist id="cities">${CITIES.map(c => `<option value="${c}">`).join('')}</datalist>
      <label class="f">Hvor er du på din vej?</label><select class="input" name="journey">${Object.entries(JOURNEY).map(([k, v]) => `<option value="${k}" ${p.journey === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label class="f">Lidt om dig</label><textarea class="input" name="bio" rows="3" maxlength="300">${esc(p.bio || '')}</textarea>
      <label class="f">Interesser</label><input class="input" name="interests" value="${esc((p.interests || []).join(', '))}">
      <label class="f">Hvem må skrive privat til dig?</label><select class="input" name="dm_pref">${Object.entries(DMPREF).map(([k, v]) => `<option value="${k}" ${p.dm_pref === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${CALLS ? '<p class="hint">Kun venner kan ringe til dig.</p>' : ''}
      <button class="btn wide" style="margin-top:16px">Gem profil</button>
    </form>
    ${blocked.length ? `<h3 class="section-title">Blokerede</h3><div class="card-list" style="margin:0">${blocked.map(id => `<div class="row" style="cursor:default"><span class="grow">${esc(nick(id))}</span><button class="link" data-action="unblock" data-id="${esc(id)}">Fjern blokering</button></div>`).join('')}</div>` : ''}
    <h3 class="section-title">Regler</h3>${RULES}
    <h3 class="section-title">Konto og data</h3>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn ghost" data-action="export">Download mine data</button>
      ${PRIVACY_URL ? `<a class="btn ghost" href="${PRIVACY_URL}">Læs privatlivspolitikken</a>` : ''}
      ${EMBEDDED ? '' : '<button class="btn ghost" data-action="logout">Log ud</button>'}
      <button class="btn danger" data-action="deleteaccount">Slet min konto</button>
    </div>
    ${CONFIG.ABOUT_HTML ? `<h3 class="section-title">Om denne version</h3><div class="rules">${CONFIG.ABOUT_HTML}</div>` : ''}
    <p class="fine" style="margin-bottom:24px">${state.user.email ? `Logget ind som ${esc(state.user.email)}` : 'Logget ind med din Claude-konto'}</p>
  </div>`;
}

function viewMod(){
  if (!state.reports) return '<div class="spin"></div>';
  const kindLabel = { message:'Besked i et rum', dm:'Privat besked', profile:'Profil', gmessage:'Besked i en privat gruppe' };
  const reps = state.reports.map(r => `<div class="report">
      <div style="font-size:13px" class="muted">${kindLabel[r.kind] || r.kind}, rapporteret af ${esc(nick(r.reporter))} ${fmt(r.created_at)}</div>
      <div style="display:flex;align-items:center;gap:10px">${r.target_user ? avatar(state.people.get(r.target_user) || { id:r.target_user, nickname:'?' }, 32) : ''}<b>${esc(r.target_user ? nick(r.target_user) : 'Ukendt')}</b></div>
      ${r.snapshot ? `<blockquote>${esc(r.snapshot)}</blockquote>` : '<div class="muted">Indholdet er allerede slettet.</div>'}
      ${r.reason ? `<div style="font-size:14.5px"><span class="muted">Begrundelse:</span> ${esc(r.reason)}</div>` : ''}
      <div class="acts">
        ${r.kind === 'message' || r.kind === 'gmessage' ? `<button class="btn small danger" data-action="mod-del" data-id="${r.id}">Slet beskeden</button>` : ''}
        ${r.target_user && r.target_user !== state.user.id ? `<button class="btn small danger" data-action="mod-ban" data-id="${r.id}">Udeluk ${esc(nick(r.target_user))}</button>` : ''}
        <button class="btn small ghost" data-action="mod-ok" data-id="${r.id}">Luk sagen</button>
      </div></div>`).join('');
  const banned = state.banned || [];
  return `<div class="pad">
    <h2 class="hello">Moderation</h2>
    <p class="muted" style="margin:0 0 14px">${!state.reports.length ? 'Ingen åbne sager. Alt er roligt.' : state.reports.length === 1 ? '1 åben sag' : `${state.reports.length} åbne sager`}</p>
    <div style="display:flex;flex-direction:column;gap:10px">${reps}</div>
    <h3 class="section-title">Udelukkede medlemmer</h3>
    ${state.banned === null ? `<button class="btn ghost small" data-action="mod-loadbanned">Vis udelukkede</button>`
      : banned.length ? `<div class="card-list" style="margin:0">${banned.map(p => `<div class="row" style="cursor:default"><span class="grow"><b>${esc(p.nickname)}</b><small>${esc(p.banned_reason || '')}</small></span><button class="link" data-action="mod-unban" data-id="${esc(p.id)}">Ophæv</button></div>`).join('')}</div>`
      : '<p class="muted">Ingen er udelukket.</p>'}
  </div>`;
}

/* ---------- Ark (profil, gruppe, ny gruppe, tilføj medlemmer) ---------- */
function drawSheet(){
  const el = $('#sheet');
  const s = state.sheet;
  if (!s){ el.classList.remove('open'); el.innerHTML = ''; return; }
  let html = '';
  if (s.type === 'person') html = sheetPerson(s.id);
  else if (s.type === 'group') html = sheetGroup();
  else if (s.type === 'newgroup') html = sheetNewGroup();
  else if (s.type === 'addmembers') html = sheetAddMembers();
  if (!html){ state.sheet = null; el.classList.remove('open'); return; }
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  el.classList.add('open');
}
function closeSheet(){ state.sheet = null; drawSheet(); }

function sheetPerson(id){
  const p = state.people.get(id);
  if (!p){ toast('Medlemmet findes ikke længere.'); return ''; }
  const isMe = p.id === state.user.id;
  const rel = relation(id);
  const dmOk = !isMe && (rel.kind === 'friends' || (p.dm_pref === 'alle') || (p.dm_pref === 'samme_koen' && p.gender === state.profile.gender));
  let friendBtns = '';
  if (!isMe){
    if (rel.kind === 'friends') friendBtns = CALLS ? `<div class="duo"><button class="btn" data-action="call" data-id="${esc(id)}">${ICON.phone.replace('<svg','<svg width="18" height="18"')} Ring op</button><button class="btn ghost" data-action="dm" data-id="${esc(id)}">${ICON.chat.replace('<svg','<svg width="18" height="18"')} Skriv</button></div>` : `<button class="btn" data-action="dm" data-id="${esc(id)}">Skriv til ${esc(p.nickname)}</button>`;
    else if (rel.kind === 'incoming') friendBtns = `<div class="duo"><button class="btn" data-action="accept" data-id="${rel.f.id}">Accepter venneanmodning</button><button class="btn ghost" data-action="unfriend" data-id="${rel.f.id}">Afvis</button></div>`;
    else if (rel.kind === 'outgoing') friendBtns = `<button class="btn ghost" data-action="unfriend" data-id="${rel.f.id}">Anmodning sendt · træk tilbage</button>`;
    else friendBtns = `<button class="btn" data-action="addfriend" data-id="${esc(id)}">Tilføj som ven</button>`;
    if (rel.kind !== 'friends'){
      friendBtns += dmOk ? `<button class="btn ghost" data-action="dm" data-id="${esc(id)}">Skriv til ${esc(p.nickname)}</button>`
                         : `<p class="hint" style="text-align:center;margin:2px 0">${esc(p.nickname)} tager kun imod beskeder fra venner.</p>`;
    }
  }
  return `<div style="display:flex;gap:14px;align-items:center">${avatar(p, 60)}<div><h3>${esc(p.nickname)}</h3><div class="muted">${esc(JOURNEY[p.journey])}${p.city ? ` i ${esc(p.city)}` : ''}${rel.kind === 'friends' ? ' · Ven' : ''}</div></div></div>
    ${p.bio ? `<p style="margin:16px 0 10px">${esc(p.bio)}</p>` : '<div style="height:12px"></div>'}
    ${p.interests?.length ? `<div class="ints">${p.interests.map(i => `<span>${esc(i)}</span>`).join('')}</div>` : ''}
    <div class="acts">
      ${friendBtns}
      ${isMe ? '' : `<div class="quiet-acts">
        ${rel.kind === 'friends' ? `<button class="link" data-action="unfriend" data-id="${rel.f.id}">Fjern som ven</button>` : ''}
        <button class="link" data-action="block" data-id="${esc(id)}">Bloker</button>
        <button class="link danger" data-action="report" data-kind="profile" data-id="${esc(id)}">Rapportér profil</button></div>`}
      <button class="btn ghost" data-action="closesheet">Luk</button>
    </div>`;
}

function sheetGroup(){
  const g = groupOf(state.groupId); if (!g) return '';
  const owner = isOwner(g);
  const mem = (state.gMembers.get(g.id) || []).slice().sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : nick(a.user_id).localeCompare(nick(b.user_id), 'da')));
  return `<div style="display:flex;gap:14px;align-items:center"><span class="tile big">${esc(g.emoji)}</span><div><h3>${esc(g.name)}</h3><div class="muted">Privat gruppe · ${mem.length} ${mem.length === 1 ? 'medlem' : 'medlemmer'}</div></div></div>
    <p class="hint" style="margin-top:14px">Kun medlemmer kan se gruppen og dens beskeder.${owner ? ' Du er ejer og kan tilføje dine venner.' : ''}</p>
    ${owner ? `<div class="duo" style="margin-top:12px"><button class="btn" data-action="addmembers">${ICON.plus.replace('<svg','<svg width="16" height="16"')} Tilføj venner</button><button class="btn ghost" data-action="renamegroup">Omdøb</button></div>` : ''}
    <h3 class="section-title" style="margin-top:20px">Medlemmer</h3>
    <div class="card-list" style="margin:0">${mem.map(m => { const p = state.people.get(m.user_id) || { id:m.user_id, nickname:'…' }; return `<div class="row" style="cursor:default">
      <button class="row-main" data-action="person" data-id="${esc(m.user_id)}">${avatar(p, 38)}<span class="grow"><b>${esc(p.nickname)}${m.user_id === state.user.id ? ' (dig)' : ''}</b><small>${m.role === 'owner' ? 'Ejer' : 'Medlem'}</small></span></button>
      ${owner && m.role !== 'owner' ? `<button class="link danger" data-action="kick" data-id="${esc(m.user_id)}">Fjern</button>` : ''}
    </div>`; }).join('')}</div>
    <div class="acts">
      ${owner ? `<button class="btn danger" data-action="deletegroup">Slet gruppen for alle</button>` : `<button class="btn danger" data-action="leavegroup">Forlad gruppen</button>`}
      <button class="btn ghost" data-action="closesheet">Luk</button>
    </div>`;
}

function friendPicker(exclude = []){
  const fr = friendIds().filter(id => !exclude.includes(id)).sort((a, b) => nick(a).localeCompare(nick(b), 'da'));
  if (!fr.length) return `<p class="hint">${exclude.length ? 'Alle dine venner er allerede med.' : 'Du har ingen venner at tilføje endnu. Du kan oprette gruppen nu og tilføje venner senere.'}</p>`;
  return `<div class="pick">${fr.map(id => { const p = state.people.get(id) || { id, nickname:'…' }; return `<label>${avatar(p, 36)}<span class="grow">${esc(p.nickname)}</span><input type="checkbox" name="m" value="${esc(id)}"></label>`; }).join('')}</div>`;
}

function sheetNewGroup(){
  return `<h3>Ny privat gruppe</h3>
    <p class="hint" style="margin-top:4px">Kun de venner, du tilføjer, kan se gruppen.</p>
    <form id="groupForm">
      <label class="f" for="gname">Navn</label>
      <input class="input" id="gname" name="name" required minlength="2" maxlength="40" placeholder="Fx Studiekreds Aarhus">
      <label class="f">Ikon</label>
      <div class="emoji-pick">${GROUP_EMOJI.map((e, i) => `<label><input type="radio" name="emoji" value="${e}" ${i === 0 ? 'checked' : ''}><span>${e}</span></label>`).join('')}</div>
      <label class="f">Medlemmer</label>
      ${friendPicker()}
      <div class="acts"><button class="btn">Opret gruppe</button><button type="button" class="btn ghost" data-action="closesheet">Annuller</button></div>
    </form>`;
}

function sheetAddMembers(){
  const g = groupOf(state.groupId); if (!g) return '';
  const already = (state.gMembers.get(g.id) || []).map(m => m.user_id);
  return `<h3>Tilføj venner til ${esc(g.name)}</h3>
    <form id="addForm">${friendPicker(already)}
      <div class="acts"><button class="btn">Tilføj</button><button type="button" class="btn ghost" data-action="groupinfo">Tilbage</button></div>
    </form>`;
}

/* =============================================================
   HANDLINGER
   ============================================================= */
function leaveChat(){ unsubRoom(); state.roomId = null; state.dmWith = null; state.groupId = null; state.msgs = []; }

async function openRoom(id){
  leaveChat(); state.roomId = id; render();
  await loadRoom(true);
  state.subs.room = api.subRoom(id, async p => {
    if (state.roomId !== id) return;
    if (p.eventType === 'INSERT'){
      if (state.msgs.some(m => m.id === p.new.id)) return;
      await ensurePeople([p.new.user_id]); state.msgs.push(p.new);
    } else if (p.eventType === 'DELETE'){
      state.msgs = state.msgs.filter(m => m.id !== p.old.id);
    }
    drawMsgs();
  });
}
async function loadRoom(first){
  const id = state.roomId;
  try {
    const fresh = await api.messages(id);
    if (state.roomId !== id) return;
    mergeMsgs(fresh, first);
    await ensurePeople(state.msgs.map(m => m.user_id));
  } catch(e){ toast(errMsg(e)); }
  drawMsgs(first);
}
function mergeMsgs(fresh, first){
  if (first){ state.msgs = fresh; state.hasMore = fresh.length === PAGE; return; }
  const ids = new Set(state.msgs.map(m => m.id));
  state.msgs = state.msgs.concat(fresh.filter(m => !ids.has(m.id))).sort((a, b) => a.id - b.id);
}
async function loadOlder(){
  if (!state.msgs.length) return;
  try {
    const older = state.groupId ? await api.groupMessages(state.groupId, state.msgs[0].created_at) : await api.messages(state.roomId, state.msgs[0].created_at);
    state.hasMore = older.length === PAGE;
    state.msgs = older.concat(state.msgs);
    await ensurePeople(older.map(m => m.user_id));
    drawMsgs(false, true);
  } catch(e){ toast(errMsg(e)); }
}

async function openDM(uid){
  leaveChat(); state.dmWith = uid;
  await ensurePeople([uid]);
  render();
  await loadDM();
}
async function loadDM(){
  const uid = state.dmWith;
  try { const msgs = await api.dms(uid); if (state.dmWith === uid) state.msgs = msgs; } catch(e){ toast(errMsg(e)); }
  markRead(uid);
  drawMsgs(true);
}

async function openGroup(gid){
  leaveChat(); state.groupId = gid; render();
  await loadGroupMsgs(true);
}
async function loadGroupMsgs(first){
  const gid = state.groupId;
  try {
    const fresh = await api.groupMessages(gid);
    if (state.groupId !== gid) return;
    mergeMsgs(fresh, first);
    await ensurePeople(state.msgs.map(m => m.user_id));
  } catch(e){ toast(errMsg(e)); }
  markRead('g:' + gid);
  drawMsgs(first);
}

async function loadGroups(silent){
  try {
    const { groups, members, last } = await api.myGroups();
    state.groups = groups;
    state.gMembers.clear(); members.forEach(m => { if (!state.gMembers.has(m.group_id)) state.gMembers.set(m.group_id, []); state.gMembers.get(m.group_id).push(m); });
    state.gLast.clear(); last.forEach(m => { if (!state.gLast.has(m.group_id)) state.gLast.set(m.group_id, m); });
    await ensurePeople(members.map(m => m.user_id).concat(last.map(m => m.user_id)));
    if (state.groupId && !groupOf(state.groupId)){ toast('Du er ikke længere med i gruppen.'); leaveChat(); closeSheet(); render(); return; }
  } catch(e){ if (!silent) toast(errMsg(e)); }
  if (silent) return;
  if (!inChat() && state.tab === 'chats') render(); else drawNav();
}

/* ---------- live-hændelser ---------- */
async function onDM(m){
  const mine = state.user.id;
  const other = m.sender === mine ? m.recipient : m.sender;
  const t = state.threads.find(x => x.other === other);
  if (t) t.last = m; else state.threads.push({ other, last:m });
  await ensurePeople([other]);
  if (state.dmWith === other){
    if (!state.msgs.some(x => x.id === m.id)){ state.msgs.push(m); drawMsgs(); }
    markRead(other);
  } else if (m.recipient === mine && !state.blocks.has(m.sender)){
    toast(`Ny besked fra ${nick(m.sender)}`);
    if (!inChat() && state.tab === 'chats') render(); else drawNav();
  }
}
async function onGroupMsg(m){
  const prev = state.gLast.get(m.group_id);
  if (!prev || new Date(m.created_at) >= new Date(prev.created_at)) state.gLast.set(m.group_id, m);
  await ensurePeople([m.user_id]);
  if (!groupOf(m.group_id)) await loadGroups(true);
  if (state.groupId === m.group_id){
    if (!state.msgs.some(x => x.id === m.id)){ state.msgs.push(m); drawMsgs(); }
    markRead('g:' + m.group_id);
  } else if (m.user_id !== state.user.id && !state.blocks.has(m.user_id)){
    toast(`${nick(m.user_id)} i ${groupOf(m.group_id)?.name || 'en gruppe'}: ${m.body.slice(0, 40)}`);
    if (!inChat() && state.tab === 'chats') render(); else drawNav();
  }
}
function onGroupDel(old){
  if (state.groupId && state.msgs.some(m => m.id === old.id)){ state.msgs = state.msgs.filter(m => m.id !== old.id); drawMsgs(); }
}
async function onJoined(row){
  if (row.user_id !== state.user.id) return;
  await loadGroups(true);
  const g = groupOf(row.group_id);
  if (g && g.owner !== state.user.id) toast(`${nick(g.owner)} har tilføjet dig til ${g.name}`);
  if (!inChat() && state.tab === 'chats') render(); else drawNav();
}
async function onFriendChange(p){
  const before = new Map(state.friendships.map(f => [f.id, f.status]));
  try { state.friendships = await api.friendships(); } catch(e){ return; }
  await ensurePeople(state.friendships.flatMap(f => [f.requester, f.addressee]));
  for (const f of state.friendships){
    const was = before.get(f.id);
    if (!was && f.status === 'pending' && f.addressee === state.user.id) toast(`${nick(f.requester)} vil gerne være ven med dig`);
    if (was === 'pending' && f.status === 'accepted' && f.requester === state.user.id) toast(`${nick(f.addressee)} har accepteret din venneanmodning`);
  }
  refreshView();
}
function refreshView(){
  if (state.sheet) drawSheet();
  if (inChat()){ const h = $('header'); if (h) h.outerHTML = headerHTML(); return; }
  if (['friends','rooms','chats'].includes(state.tab)) render(); else drawNav();
}

async function loadPeople(){
  try { state.members = await api.members(); state.members.forEach(p => state.people.set(p.id, p)); }
  catch(e){ toast(errMsg(e)); state.members = []; }
  drawPeople();
}
async function loadThreads(){
  try { state.threads = await api.threads(); await ensurePeople(state.threads.map(t => t.other)); }
  catch(e){ toast(errMsg(e)); }
  if (!inChat() && state.tab === 'chats') render(); else drawNav();
}
async function loadReports(){
  try {
    state.reports = await api.openReports();
    await ensurePeople(state.reports.flatMap(r => [r.reporter, r.target_user]));
  } catch(e){ toast(errMsg(e)); state.reports = []; }
  if (!inChat() && state.tab === 'mod') render(); else drawNav();
}

function ask({ title, text = '', ok = 'OK', danger = false, input = null, match = null }){
  return new Promise(resolve => {
    let el = $('#dialog');
    if (!el){ el = document.createElement('div'); el.id = 'dialog'; (ROOT === document ? document.body : ROOT).appendChild(el); }
    const prev = ROOT.activeElement || document.activeElement;
    el.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlgT">
      <h3 id="dlgT">${esc(title)}</h3>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      ${input || match ? `<input class="input" id="dlgIn" autocomplete="off" maxlength="${(input && input.max) || 500}" placeholder="${esc((input && input.placeholder) || (match ? 'Skriv ' + match : ''))}" value="${esc((input && input.value) || '')}">` : ''}
      <div class="duo"><button type="button" class="btn ghost" data-dlg="no">Annuller</button><button type="button" class="btn ${danger ? 'danger-fill' : ''}" data-dlg="yes" ${match ? 'disabled' : ''}>${esc(ok)}</button></div></div>`;
    el.classList.add('open');
    const inp = el.querySelector('#dlgIn'), yes = el.querySelector('[data-dlg=yes]');
    const done = v => { el.classList.remove('open'); el.innerHTML = ''; el.onclick = el.onkeydown = el.oninput = null; try { prev && prev.focus(); } catch(_){} resolve(v); };
    const accept = () => { if (yes.disabled) return; done(input ? inp.value.trim() : true); };
    el.oninput = () => { if (match) yes.disabled = inp.value.trim().toUpperCase() !== match; };
    el.onclick = e => { const d = e.target.closest('[data-dlg]'); if (e.target === el) done(input ? null : false); else if (d) d.dataset.dlg === 'yes' ? accept() : done(input ? null : false); };
    el.onkeydown = e => { if (e.key === 'Escape'){ e.stopPropagation(); done(input ? null : false); } if (e.key === 'Enter' && e.target === inp){ e.preventDefault(); e.stopPropagation(); accept(); } };
    setTimeout(() => (inp || yes).focus(), 30);
  });
}

function download(name, data){
  if (window.GT_DOWNLOAD) return window.GT_DOWNLOAD(name, JSON.stringify(data, null, 2));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const parseInterests = s => [...new Set(String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).map(x => x.slice(0, 30)))].slice(0, 8);

/* =============================================================
   TELEFONOPKALD (WebRTC – kun lyd, kun mellem venner)
   ============================================================= */
const Call = {
  c: null,   // { id, peer, role, phase, pc, stream, ch, started, muted, pending:[], timers:{} }

  reset(){ if (this.c) this.cleanup(); },

  async start(uid){
    if (!CALLS){ toast('Opkald virker i den udgivne app, ikke her.'); return; }
    if (this.c){ toast('Du er allerede i et opkald.'); return; }
    if (relation(uid).kind !== 'friends'){ toast('Du kan kun ringe til dine venner.'); return; }
    this.c = { id:null, peer:uid, role:'caller', phase:'mic', pending:[], timers:{}, muted:false };
    this.draw();
    try { this.c.stream = await this.mic(); }
    catch(e){ this.fail(e.name === 'NotAllowedError' ? 'Giv appen adgang til mikrofonen for at ringe.' : 'Mikrofonen kunne ikke startes.'); return; }
    if (!this.c) return;
    try {
      const row = await api.startCall(uid);
      if (!this.c){ api.setCallStatus(row.id, 'ended').catch(() => {}); return; }
      this.c.id = row.id; this.c.phase = 'ringing'; this.draw(); this.tone('ringback');
      await this.join();
      this.c.timers.noAnswer = setTimeout(() => { if (this.c?.phase === 'ringing'){ api.setCallStatus(this.c.id, 'missed').catch(() => {}); this.end(`${nick(uid)} svarede ikke`); } }, 45000);
    } catch(e){ this.fail(errMsg(e)); }
  },

  async accept(){
    const c = this.c; if (!c || c.role !== 'callee') return;
    this.tone(null);
    c.phase = 'connecting'; this.draw();
    try { c.stream = await this.mic(); }
    catch(e){ api.setCallStatus(c.id, 'declined').catch(() => {}); this.fail('Giv appen adgang til mikrofonen for at tage opkaldet.'); return; }
    try {
      await api.setCallStatus(c.id, 'accepted');
      await this.join();
      this.peer();
      this.send({ t:'ready' });
    } catch(e){ this.fail(errMsg(e)); }
  },

  decline(){ if (!this.c) return; api.setCallStatus(this.c.id, 'declined').catch(() => {}); this.end(null); },

  hangup(){
    const c = this.c; if (!c) return;
    if (c.id){
      this.send({ t:'bye' });
      api.setCallStatus(c.id, c.phase === 'ringing' && c.role === 'caller' ? 'missed' : 'ended').catch(() => {});
    }
    this.end(c.phase === 'active' ? `Opkald afsluttet · ${this.elapsed()}` : null);
  },

  toggleMute(){
    const c = this.c; if (!c?.stream) return;
    c.muted = !c.muted; c.stream.getAudioTracks().forEach(t => t.enabled = !c.muted); this.draw();
  },

  // indgående / ændrede opkald fra databasen
  async onRow(p){
    const row = p.new; if (!row?.id) return;
    if (p.eventType === 'INSERT' && row.callee === state.user.id && row.status === 'ringing'){
      if (this.c){ api.setCallStatus(row.id, 'declined').catch(() => {}); toast(`${nick(row.caller)} prøvede at ringe`); return; }
      if (Date.now() - new Date(row.created_at).getTime() > 60000) return;
      await ensurePeople([row.caller]);
      this.c = { id:row.id, peer:row.caller, role:'callee', phase:'incoming', pending:[], timers:{}, muted:false };
      this.draw(); this.tone('ring');
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
      this.c.timers.giveUp = setTimeout(() => { if (this.c?.phase === 'incoming') this.end(`Ubesvaret opkald fra ${nick(row.caller)}`); }, 50000);
      return;
    }
    if (p.eventType === 'UPDATE' && this.c && this.c.id === row.id){
      if (row.status === 'declined') this.end(this.c.role === 'caller' ? `${nick(this.c.peer)} kan ikke tale lige nu` : null);
      else if (row.status === 'missed') this.end(this.c.role === 'callee' ? `Ubesvaret opkald fra ${nick(this.c.peer)}` : null);
      else if (row.status === 'ended') this.end(this.c.phase === 'active' ? `Opkald afsluttet · ${this.elapsed()}` : null);
      else if (row.status === 'accepted' && this.c.role === 'caller' && this.c.phase === 'ringing'){ this.tone(null); this.c.phase = 'connecting'; this.draw(); }
    }
  },

  async mic(){
    if (PREVIEW) return null;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Din browser understøtter ikke opkald.');
    return navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
  },

  async join(){
    const c = this.c;
    if (PREVIEW){ c.ch = { send(){} }; return Preview.call(this); }
    const ch = await api.callChannel(c.id);
    c.ch = ch;
    ch.on('broadcast', { event:'sig' }, ({ payload }) => this.onSignal(payload));
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Kunne ikke forbinde opkaldet.')), 10000);
      ch.subscribe(s => { if (s === 'SUBSCRIBED'){ clearTimeout(to); res(); } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT'){ clearTimeout(to); rej(new Error('Kunne ikke forbinde opkaldet.')); } });
    });
  },

  send(payload){ try { this.c?.ch?.send({ type:'broadcast', event:'sig', payload }); } catch(e){} },

  peer(){
    const c = this.c;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    c.pc = pc;
    c.stream?.getTracks().forEach(t => pc.addTrack(t, c.stream));
    pc.onicecandidate = e => { if (e.candidate) this.send({ t:'ice', c:e.candidate.toJSON() }); };
    pc.ontrack = e => { const a = $('#remoteAudio'); if (a){ a.srcObject = e.streams[0]; a.play().catch(() => {}); } };
    pc.onconnectionstatechange = () => {
      if (!this.c || this.c.pc !== pc) return;
      if (pc.connectionState === 'connected' && this.c.phase !== 'active') this.live();
      if (pc.connectionState === 'failed') this.fail('Forbindelsen kunne ikke etableres. Prøv igen – eller tjek dit netværk.');
      if (pc.connectionState === 'disconnected'){ this.c.timers.drop = setTimeout(() => { if (this.c?.pc?.connectionState === 'disconnected') this.hangup(); }, 8000); }
    };
    return pc;
  },

  async onSignal(m){
    const c = this.c; if (!c) return;
    try {
      if (m.t === 'ready' && c.role === 'caller'){
        this.tone(null); c.phase = 'connecting'; this.draw();
        const pc = this.peer();
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        this.send({ t:'offer', sdp:pc.localDescription.toJSON() });
      } else if (m.t === 'offer' && c.role === 'callee'){
        await c.pc.setRemoteDescription(m.sdp); await this.flush();
        const ans = await c.pc.createAnswer(); await c.pc.setLocalDescription(ans);
        this.send({ t:'answer', sdp:c.pc.localDescription.toJSON() });
      } else if (m.t === 'answer' && c.role === 'caller'){
        await c.pc.setRemoteDescription(m.sdp); await this.flush();
      } else if (m.t === 'ice'){
        if (c.pc?.remoteDescription) await c.pc.addIceCandidate(m.c); else c.pending.push(m.c);
      } else if (m.t === 'bye'){
        this.end(c.phase === 'active' ? `Opkald afsluttet · ${this.elapsed()}` : null);
      }
    } catch(e){ console.warn('signal', e); }
  },
  async flush(){ const c = this.c; while (c.pending.length) await c.pc.addIceCandidate(c.pending.shift()).catch(() => {}); },

  live(){
    const c = this.c; this.tone(null);
    c.phase = 'active'; c.started = Date.now();
    clearTimeout(c.timers.noAnswer);
    c.timers.tick = setInterval(() => { const el = $('#callStatus'); if (el) el.textContent = this.elapsed(); }, 1000);
    this.draw();
  },
  elapsed(){ const s = Math.floor((Date.now() - (this.c?.started || Date.now())) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; },

  fail(msg){ if (this.c?.id) api.setCallStatus(this.c.id, 'ended').catch(() => {}); this.end(msg); },
  end(msg){ this.cleanup(); if (msg) toast(msg); },
  cleanup(){
    const c = this.c; if (!c) return;
    this.c = null; this.tone(null);
    Object.values(c.timers).forEach(t => { clearTimeout(t); clearInterval(t); });
    try { c.pc?.close(); } catch(e){}
    c.stream?.getTracks().forEach(t => t.stop());
    try { if (c.ch && sb && c.ch.unsubscribe) sb.removeChannel(c.ch); } catch(e){}
    const a = $('#remoteAudio'); if (a) a.srcObject = null;
    this.draw();
  },

  // ringetone (WebAudio – ingen lydfiler)
  _ac:null, _tone:null,
  tone(kind){
    if (this._tone){ clearInterval(this._tone); this._tone = null; }
    if (!kind) return;
    try {
      this._ac = this._ac || new (window.AudioContext || window.webkitAudioContext)();
      this._ac.resume?.();
      const beep = () => {
        const ac = this._ac, o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = kind === 'ring' ? 660 : 425;
        g.gain.setValueAtTime(0.0001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(kind === 'ring' ? 0.25 : 0.08, ac.currentTime + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + (kind === 'ring' ? 0.9 : 1.2));
        o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 1.3);
      };
      beep(); this._tone = setInterval(beep, kind === 'ring' ? 1600 : 4000);
    } catch(e){}
  },

  draw(){
    const el = $('#call');
    const c = this.c;
    if (!c){ el.classList.remove('open'); el.innerHTML = ''; return; }
    const p = state.people.get(c.peer) || { id:c.peer, nickname:'…' };
    const status = { mic:'Starter mikrofon…', ringing:'Ringer…', incoming:'Ringer til dig', connecting:'Forbinder…', active:this.elapsed() }[c.phase];
    const btn = (action, icon, label, cls = '') => `<button class="call-btn ${cls}" data-action="${action}" aria-label="${label}">${icon}<span>${label}</span></button>`;
    el.innerHTML = `<div class="call-inner">
      <div class="call-who">
        <div class="call-ring ${c.phase === 'ringing' || c.phase === 'incoming' ? 'pulse' : ''}">${avatar(p, 112)}</div>
        <h2>${esc(p.nickname)}</h2>
        <p id="callStatus">${status}</p>
        ${c.muted ? '<p class="muted-tag">Din mikrofon er slået fra</p>' : ''}
      </div>
      <div class="call-actions">
        ${c.phase === 'incoming'
          ? btn('call-decline', ICON.hang, 'Afvis', 'red') + btn('call-accept', ICON.phone, 'Tag den', 'green')
          : btn('call-mute', c.muted ? ICON.micoff : ICON.mic, c.muted ? 'Slå lyd til' : 'Lydløs', c.muted ? 'on' : '') + btn('call-hangup', ICON.hang, 'Læg på', 'red')}
      </div>
    </div>`;
    el.classList.add('open');
  },
};
window.addEventListener('beforeunload', () => { if (Call.c) Call.hangup(); });

/* ---------- forhåndsvisning: simuleret opkald (bruges kun i preview-filen) ---------- */
const Preview = {
  call(C){
    const c = C.c;
    if (c.role === 'caller'){
      c.timers.sim = setTimeout(() => { if (C.c === c){ C.tone(null); c.phase = 'connecting'; C.draw(); c.timers.sim2 = setTimeout(() => C.c === c && C.live(), 1200); } }, 3000);
    } else {
      c.timers.sim = setTimeout(() => C.c === c && C.live(), 1000);
    }
  },
};

/* =============================================================
   KLIK
   ============================================================= */
ROOT.addEventListener('click', async e => {
  if (e.target.id === 'sheet'){ closeSheet(); return; }
  const b = e.target.closest('[data-action]'); if (!b) return;
  const { action, id, kind } = b.dataset;
  try {
    switch (action){
      case 'guide': if (window.GT_GUIDE) window.GT_GUIDE(); else location.href = GUIDE_URL; break;
      case 'tab':
        leaveChat(); state.tab = id; render();
        if (id === 'friends' && state.friendsTab === 'find' && !state.members) loadPeople();
        if (id === 'chats'){ loadThreads(); loadGroups(); }
        if (id === 'mod') loadReports();
        break;
      case 'ftab': state.friendsTab = id; render(); if (id === 'find') loadPeople(); break;
      case 'room': openRoom(id); break;
      case 'group': openGroup(id); break;
      case 'older': b.disabled = true; await loadOlder(); break;
      case 'back': leaveChat(); render(); break;
      case 'person': await ensurePeople([id]); state.sheet = { type:'person', id }; drawSheet(); break;
      case 'closesheet': closeSheet(); break;
      case 'dm': closeSheet(); openDM(id); break;
      case 'jf': state.jf = id; ROOT.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.id === id)); drawPeople(); break;

      // venner
      case 'addfriend':
        b.disabled = true;
        await api.requestFriend(id); state.friendships = await api.friendships();
        toast(`Venneanmodning sendt til ${nick(id)}`); refreshView();
        break;
      case 'accept': {
        const f = state.friendships.find(x => x.id === id);
        await api.acceptFriend(id); state.friendships = await api.friendships();
        if (f) toast(`Du og ${nick(f.requester)} er nu venner`); refreshView();
        break;
      }
      case 'unfriend': {
        const f = state.friendships.find(x => x.id === id); if (!f) return;
        const other = f.requester === state.user.id ? f.addressee : f.requester;
        if (f.status === 'accepted' && !(await ask({ title:`Fjern ${nick(other)} som ven?`, text:'I kan ikke længere skrive frit eller ringe til hinanden.', ok:'Fjern ven', danger:true }))) return;
        await api.removeFriendship(id); state.friendships = await api.friendships();
        refreshView();
        break;
      }

      // opkald
      case 'call': closeSheet(); Call.start(id); break;
      case 'call-accept': Call.accept(); break;
      case 'call-decline': Call.decline(); break;
      case 'call-hangup': Call.hangup(); break;
      case 'call-mute': Call.toggleMute(); break;

      // grupper
      case 'newgroup': state.sheet = { type:'newgroup' }; drawSheet(); setTimeout(() => $('#gname')?.focus(), 50); break;
      case 'groupinfo': state.sheet = { type:'group' }; drawSheet(); break;
      case 'addmembers': state.sheet = { type:'addmembers' }; drawSheet(); break;
      case 'renamegroup': {
        const g = groupOf(state.groupId);
        const name = await ask({ title:'Omdøb gruppen', input:{ value:g.name, max:40 }, ok:'Gem navn' });
        if (!name || name.trim().length < 2) return;
        await api.updateGroup(g.id, { name:name.trim().slice(0, 40) }); g.name = name.trim().slice(0, 40);
        refreshView(); drawSheet(); toast('Gruppen er omdøbt.');
        break;
      }
      case 'kick':
        if (!(await ask({ title:`Fjern ${nick(id)} fra gruppen?`, ok:'Fjern', danger:true }))) return;
        await api.removeMember(state.groupId, id);
        await loadGroups(true); refreshView(); toast(`${nick(id)} er fjernet fra gruppen.`);
        break;
      case 'leavegroup': {
        const g = groupOf(state.groupId);
        if (!(await ask({ title:`Forlad ${g.name}?`, text:'Du kan kun komme med igen, hvis ejeren tilføjer dig.', ok:'Forlad gruppen', danger:true }))) return;
        await api.removeMember(g.id, state.user.id);
        closeSheet(); leaveChat(); state.tab = 'chats'; await loadGroups(true); render(); toast(`Du har forladt ${g.name}.`);
        break;
      }
      case 'deletegroup': {
        const g = groupOf(state.groupId);
        if (!(await ask({ title:`Slet ${g.name}?`, text:'Gruppen og alle beskeder slettes for alle medlemmer. Det kan ikke fortrydes.', ok:'Slet gruppen', danger:true }))) return;
        await api.deleteGroup(g.id);
        closeSheet(); leaveChat(); state.tab = 'chats'; await loadGroups(true); render(); toast('Gruppen er slettet.');
        break;
      }

      // tryghed
      case 'block':
        if (!(await ask({ title:`Bloker ${nick(id)}?`, text:'I kan ikke se hinandens beskeder, skrive eller ringe, og et eventuelt venskab fjernes.', ok:'Bloker', danger:true }))) return;
        await api.block(id); state.blocks.add(id); closeSheet();
        if (state.dmWith === id) leaveChat();
        state.friendships = await api.friendships().catch(() => state.friendships);
        render(); toast(`${nick(id)} er blokeret.`);
        break;
      case 'unblock': await api.unblock(id); state.blocks.delete(id); render(); toast('Blokering fjernet.'); break;
      case 'report': {
        const reason = await ask({ title:'Hvad er problemet?', text:'Fx chikane, spam eller upassende indhold. Kun moderatorer ser din rapport.', input:{ placeholder:'Kort begrundelse', max:500 }, ok:'Send rapport' });
        if (reason === null) return;
        await api.report(kind, id, reason.trim().slice(0, 500) || null);
        closeSheet(); toast('Tak. En moderator kigger på det.');
        break;
      }
      case 'delmsg':
        if (!(await ask({ title:'Slet beskeden?', ok:'Slet', danger:true }))) return;
        if (state.groupId) await api.delGroupMessage(+id); else await api.delMessage(+id);
        state.msgs = state.msgs.filter(m => m.id !== +id); drawMsgs();
        break;

      // konto
      case 'export': {
        b.disabled = true;
        const data = await api.exportMine();
        await download(`gettogether-mine-data-${new Date().toISOString().slice(0, 10)}.json`, data);
        b.disabled = false;
        break;
      }
      case 'logout': if (Call.c) Call.hangup(); await api.signOut(); await setUser(null); break;
      case 'deleteaccount': {
        const ans = await ask({ title:'Slet din konto?', text:'Din profil, dine venskaber, grupper du ejer og alle dine beskeder slettes permanent. Skriv SLET for at bekræfte.', match:'SLET', ok:'Slet min konto', danger:true });
        if (!ans) return;
        await api.deleteAccount();
        try { localStorage.removeItem(lrKey()); } catch(_){}
        await api.signOut(); await setUser(null);
        toast('Din konto er slettet.');
        break;
      }

      // moderation
      case 'mod-del': {
        const r = state.reports.find(x => x.id === +id); if (!r) return;
        if (!(await ask({ title:'Slet beskeden for alle?', ok:'Slet', danger:true }))) return;
        if (r.kind === 'gmessage') await api.delGroupMessage(+r.target_id); else await api.delMessage(+r.target_id);
        await api.resolveAllFor(r.kind, r.target_id);
        toast('Beskeden er slettet.'); loadReports();
        break;
      }
      case 'mod-ban': {
        const r = state.reports.find(x => x.id === +id); if (!r) return;
        const reason = await ask({ title:`Udeluk ${nick(r.target_user)}?`, text:'Skriv en kort begrundelse. Den vises for brugeren.', input:{ placeholder:'Fx gentagen spam', max:200 }, ok:'Udeluk', danger:true });
        if (reason === null) return;
        await api.setBan(r.target_user, true, reason.trim().slice(0, 200) || 'Brud på husreglerne');
        await api.resolveReport(r.id);
        state.banned = null; toast(`${nick(r.target_user)} er udelukket.`); loadReports();
        break;
      }
      case 'mod-ok': await api.resolveReport(+id); loadReports(); break;
      case 'mod-loadbanned': state.banned = await api.bannedUsers(); render(); break;
      case 'mod-unban':
        if (!(await ask({ title:'Ophæv udelukkelsen?', ok:'Ophæv' }))) return;
        await api.setBan(id, false); state.banned = await api.bannedUsers(); render(); toast('Udelukkelsen er ophævet.');
        break;
    }
  } catch(err){ b.disabled = false; toast(errMsg(err)); }
});

/* =============================================================
   FORMULARER
   ============================================================= */
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

async function handleForm(f){
  const d = Object.fromEntries(new FormData(f));
  try {
    if (f.id === 'loginForm'){
      const email = (d.email || '').trim().toLowerCase();
      if (!validEmail(email)){ toast('Skriv en gyldig e-mail.'); $('#email')?.focus(); return; }
      state.loginEmail = email; state.code = $('#code')?.value || '';
      state.busy = 'send'; render();
      try { await api.sendCode(email); state.loginStep = 'code'; toast('Koden er sendt. Tjek din e-mail.'); }
      finally { state.busy = false; render(); setTimeout(() => $('#code')?.focus(), 30); }
    }
    if (f.id === 'codeForm'){
      const email = ($('#email')?.value || state.loginEmail).trim().toLowerCase();
      const code = (d.code || '').replace(/\D/g, '');
      if (!validEmail(email)){ toast('Skriv først din e-mail i felt 1.'); $('#email')?.focus(); return; }
      if (code.length < 6){ toast('Koden skal være 6 cifre. Tryk "Send kode", hvis du ikke har fået en.'); $('#code')?.focus(); return; }
      state.loginEmail = email; state.code = code;
      state.busy = 'verify'; render();
      try { await api.verifyCode(email, code); state.code = ''; }
      catch(err){ state.busy = false; render(); toast(errMsg(err, 'otp')); return; }
      state.busy = false;
    }
    if (f.id === 'onbForm'){
      const btn = f.querySelector('button.btn'); btn.disabled = true;
      try {
        state.profile = await api.createProfile({
          nickname:d.nickname.trim(), city:d.city.trim() || null, gender:d.gender, journey:d.journey,
          bio:d.bio.trim() || null, interests:parseInterests(d.interests), dm_pref:d.dm_pref,
          adult_confirmed:true, rules_accepted:true, privacy_consent_at:new Date().toISOString(),
        });
      } catch(err){ btn.disabled = false; toast(errMsg(err)); return; }
      // Nur (guiden) tiltaler dig som bror eller søster – brug det køn, du lige har valgt
      store.set('nur_addr', d.gender === 'kvinde' ? 'soester' : 'bror');
      await afterProfile(); render();
    }
    if (f.id === 'meForm'){
      state.profile = await api.updateProfile({
        nickname:d.nickname.trim(), city:d.city.trim() || null, journey:d.journey,
        bio:d.bio.trim() || null, interests:parseInterests(d.interests), dm_pref:d.dm_pref,
      });
      state.people.set(state.profile.id, state.profile); state.members = null;
      render(); toast('Profilen er gemt.');
    }
    if (f.id === 'groupForm'){
      const btn = f.querySelector('button.btn'); btn.disabled = true;
      const uids = [...f.querySelectorAll('input[name=m]:checked')].map(x => x.value);
      try {
        const g = await api.createGroup(d.name.trim(), d.emoji || '💬');
        await api.addMembers(g.id, uids);
        await loadGroups(true);
        closeSheet(); state.tab = 'chats'; await openGroup(g.id);
        toast(uids.length ? `${g.name} er oprettet med ${uids.length} ${uids.length === 1 ? 'ven' : 'venner'}` : `${g.name} er oprettet`);
      } catch(err){ btn.disabled = false; toast(errMsg(err)); }
    }
    if (f.id === 'addForm'){
      const uids = [...f.querySelectorAll('input[name=m]:checked')].map(x => x.value);
      if (!uids.length){ toast('Vælg mindst én ven.'); return; }
      await api.addMembers(state.groupId, uids);
      await loadGroups(true);
      state.sheet = { type:'group' }; refreshView();
      toast(uids.length === 1 ? `${nick(uids[0])} er tilføjet` : `${uids.length} venner er tilføjet`);
    }
    if (f.id === 'composer'){
      const ta = f.querySelector('textarea'), body = ta.value.trim(); if (!body) return;
      ta.value = ''; ta.style.height = '';
      try {
        if (state.dmWith) await api.sendDM(state.dmWith, body);
        else if (state.groupId) await api.sendGroup(state.groupId, body);
        else await api.send(state.roomId, body);
      } catch(err){ ta.value = body; toast(errMsg(err, state.dmWith ? 'dm' : null)); }
      ta.focus();
    }
  } catch(err){ if (f.id === 'loginForm' || f.id === 'codeForm'){ state.busy = false; render(); } toast(errMsg(err)); }
}

// Formularer håndteres via klik/Enter (virker også i indlejrede visninger og app-webviews)
function trySubmit(f){
  if (!f || f.dataset.busy) return;
  if (!['loginForm','codeForm'].includes(f.id) && !f.reportValidity()) return;
  f.dataset.busy = '1';
  handleForm(f).finally(() => { delete f.dataset.busy; });
}
ROOT.addEventListener('submit', e => { e.preventDefault(); trySubmit(e.target); });
ROOT.addEventListener('click', e => {
  const btn = e.target.closest('form button');
  if (!btn || btn.dataset.action || btn.type === 'button') return;
  e.preventDefault(); trySubmit(btn.form);
});
ROOT.addEventListener('keydown', e => {
  const t = e.target;
  if (e.key === 'Enter' && !e.isComposing && t.form){
    if (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio'){ e.preventDefault(); trySubmit(t.form); }
    else if (t.matches('#composer textarea') && !e.shiftKey && window.matchMedia('(pointer:fine)').matches){ e.preventDefault(); trySubmit(t.form); }
  }
  if (e.key === 'Escape' && state.sheet) closeSheet();
});
ROOT.addEventListener('input', e => {
  if (e.target.id === 'q'){ state.q = e.target.value; drawPeople(); }
  if (e.target.matches('#composer textarea')){ e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }
});

// Hent det seneste igen når appen kommer i forgrunden / forbindelsen vender tilbage
async function refresh(){
  if (!state.profile || state.profile.banned) return;
  if (state.roomId) loadRoom(false);
  else if (state.dmWith) loadDM();
  else if (state.groupId) loadGroupMsgs(false);
  loadThreads(); loadGroups();
  api.friendships().then(f => { state.friendships = f; drawNav(); }).catch(() => {});
  if (state.profile.is_admin) loadReports();
  try {
    const p = await api.myProfile(state.user.id);
    if (!p){ await api.signOut(); return setUser(null); }
    if (p.banned && !state.profile.banned){ state.profile = p; unsubAll(); Call.reset(); render(); }
  } catch(e){}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('online', () => { render(); refresh(); });
window.addEventListener('offline', render);

/* =============================================================
   START
   ============================================================= */
render();
if (CONFIGURED){
  api.onAuth(u => setUser(u));
  api.session().then(u => setUser(u)).catch(() => setUser(null));
}
if ('serviceWorker' in navigator && location.protocol === 'https:' && !PREVIEW && !EMBEDDED){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
