// server.js — Ycine SA (MVP) - tokenized card linking (PSP adapter), JSON DB
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://yacine-sa.vercel.app'; // update on prod
const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// files
const USERS_FILE = path.join(DATA_DIR,'users.json');
const VIDEOS_FILE = path.join(DATA_DIR,'videos.json');
const WITHDRAWS_FILE = path.join(DATA_DIR,'withdraws.json');
const PAYMENTS_FILE = path.join(DATA_DIR,'payments.json');

function ensureFile(file, init){
  if(!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(init,null,2),'utf8');
}
ensureFile(USERS_FILE, []);
ensureFile(WITHDRAWS_FILE, []);
ensureFile(PAYMENTS_FILE, []);
ensureFile(VIDEOS_FILE, [
  { id:"VID1", title:"إعلان منتج X", value:1000, duration:20, thumbnail:"/static/img/v1.jpg", src:"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id:"VID2", title:"إعلان خدمة Y", value:800, duration:15, thumbnail:"/static/img/v2.jpg", src:"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id:"VID3", title:"إعلان تطبيق Z", value:600, duration:12, thumbnail:"/static/img/v3.jpg", src:"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" }
]);

function readJSON(f){ return JSON.parse(fs.readFileSync(f,'utf8')); }
function writeJSON(f,d){ fs.writeFileSync(f, JSON.stringify(d,null,2),'utf8'); }

// middlewares
app.use(helmet());
app.use(bodyParser.json({limit:'1mb'}));
app.use(bodyParser.urlencoded({extended:true}));
app.use(cors());
app.use(express.static(path.join(__dirname,'public')));
app.use('/static', express.static(path.join(__dirname,'public')));

// rate limit
app.use(rateLimit({ windowMs: 5*1000, max: 200 }));

// helpers
function findUserById(id){
  const users = readJSON(USERS_FILE); return users.find(u=>u.id===id);
}
function saveOrUpdateUser(user){
  const users = readJSON(USERS_FILE);
  const i = users.findIndex(x=>x.id===user.id);
  if(i>=0) users[i]=user; else users.push(user);
  writeJSON(USERS_FILE, users);
}
function readPayments(){ return readJSON(PAYMENTS_FILE); }
function writePayments(d){ writeJSON(PAYMENTS_FILE,d); }

function recomputeLevel(user){
  const t = user.totalEarned || 0;
  if(t>=50000) user.level='VIP';
  else if(t>=20000) user.level='Gold';
  else if(t>=5000) user.level='Silver';
  else user.level='Bronze';
}

// ---------- Web pages ----------
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/dashboard', (req,res)=> res.sendFile(path.join(__dirname,'public','dashboard.html')));
app.get('/withdraw', (req,res)=> res.sendFile(path.join(__dirname,'public','withdraw.html')));

// ---------- API ----------

// signup
app.post('/api/signup', (req,res)=>{
  const { name, inviteCode } = req.body;
  if(!name) return res.status(400).json({ error:'name required' });
  const users = readJSON(USERS_FILE);
  let u = users.find(x=>x.name===name);
  if(!u){
    u = {
      id: uuidv4(),
      name,
      balance:0,
      watched:[],
      inviteCode: (name.replace(/\s+/g,'').slice(0,6).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase()),
      inviterId: null,
      totalEarned:0,
      lastWithdraw:null,
      createdAt:new Date().toISOString(),
      level:'Bronze',
      dailyCount:{ date: new Date().toISOString().slice(0,10), count:0 },
      progress:{},
      invites:0,
      linked_payment_id: null,
      is_verified:false
    };
    if(inviteCode){
      const inv = users.find(x=>x.inviteCode===inviteCode);
      if(inv){ u.inviterId = inv.id; inv.invites = (inv.invites||0) + 1; saveOrUpdateUser(inv); }
    }
    users.push(u); writeJSON(USERS_FILE, users);
  }
  return res.json({ success:true, user:{ id:u.id, name:u.name, balance:u.balance, inviteCode:u.inviteCode, linked_payment_id:u.linked_payment_id, is_verified:u.is_verified }});
});

// login (by name)
app.post('/api/login', (req,res)=>{
  const { name } = req.body;
  if(!name) return res.status(400).json({ error:'name required' });
  const users = readJSON(USERS_FILE);
  const u = users.find(x=>x.name===name);
  if(!u) return res.status(404).json({ error:'notfound' });
  return res.json({ success:true, user:{ id:u.id, name:u.name, balance:u.balance, inviteCode:u.inviteCode, linked_payment_id:u.linked_payment_id, is_verified:u.is_verified }});
});

// get videos
app.get('/api/videos', (req,res)=> res.json(readJSON(VIDEOS_FILE)));

// save progress
app.post('/api/progress', (req,res)=>{
  const { userId, videoId, currentTime, completed } = req.body;
  if(!userId || !videoId) return res.status(400).json({ error:'bad' });
  const user = findUserById(userId); if(!user) return res.status(404).json({ error:'no_user' });
  user.progress = user.progress || {};
  user.progress[videoId] = { currentTime: currentTime || 0, completed: !!completed, updatedAt:new Date().toISOString() };
  saveOrUpdateUser(user);
  return res.json({ ok:true, progress:user.progress[videoId] });
});

// claim reward
app.post('/api/claim', (req,res)=>{
  const { userId, videoId } = req.body;
  if(!userId || !videoId) return res.status(400).json({ error:'bad' });
  const user = findUserById(userId); if(!user) return res.status(404).json({ error:'no_user' });
  user.progress = user.progress || {};
  const p = user.progress[videoId];
  if(!p || !p.completed) return res.status(403).json({ error:'not_completed' });
  user.watched = user.watched || [];
  if(user.watched.includes(videoId)) return res.status(409).json({ error:'already_claimed' });
  const videos = readJSON(VIDEOS_FILE);
  const v = videos.find(x=>x.id===videoId);
  if(!v) return res.status(404).json({ error:'video_not_found' });

  const platformRevenue = Number((v.value * 0.9).toFixed(2));
  const viewerReward = Number((platformRevenue * 0.10).toFixed(2));
  const platformNet = Number((platformRevenue - viewerReward).toFixed(2));

  user.balance = Number(( (user.balance || 0) + viewerReward ).toFixed(2));
  user.watched.push(videoId);
  user.totalEarned = Number((user.totalEarned || 0) + viewerReward);

  const today = new Date().toISOString().slice(0,10);
  if(!user.dailyCount || user.dailyCount.date !== today) user.dailyCount = { date: today, count:0 };
  user.dailyCount.count = (user.dailyCount.count||0) + 1;

  if(user.inviterId){
    const inviter = findUserById(user.inviterId);
    if(inviter){
      const inviterBonus = Number((viewerReward * 0.10).toFixed(2));
      inviter.balance = Number(((inviter.balance||0) + inviterBonus).toFixed(2));
      inviter.totalEarned = Number((inviter.totalEarned||0) + inviterBonus);
      saveOrUpdateUser(inviter);
    }
  }

  recomputeLevel(user);
  saveOrUpdateUser(user);
  return res.json({ ok:true, reward: viewerReward, newBalance: user.balance, platformNet });
});

// ---------------- Payment linking (PSP adapter - example Chargily) ----------------
// POST /api/link-card -> returns hosted URL to open
// PSP must call /api/link-card/callback webhook after tokenization

const PSP_CREATE_URL = process.env.PSP_CREATE_URL || ''; // e.g., Chargily create payment endpoint
const PSP_KEY = process.env.PSP_KEY || ''; // PSP secret
// Start tokenization session (hosted checkout) — in demo we simulate by returning a fake URL if not configured.
app.post('/api/link-card', (req,res)=>{
  const { userId } = req.body;
  if(!userId) return res.status(400).json({ error:'userId required' });
  const user = findUserById(userId); if(!user) return res.status(404).json({ error:'no_user' });

  // If PSP not configured, return simulated URL for demo
  if(!PSP_CREATE_URL || !PSP_KEY){
    // Demo: open a simple local page that simulates PSP and then calls callback (for local testing)
    const demoUrl = `${BASE_URL}/static/demo_psp_link.html?userId=${encodeURIComponent(userId)}`;
    return res.json({ ok:true, url: demoUrl, demo:true });
  }

  // Real PSP call (example skeleton)
  const payload = {
    amount: 1, currency: 'DZD', description: `Link card for ${userId}`, callback_url: `${BASE_URL}/api/link-card/callback`, metadata:{ userId }
  };
  fetch(PSP_CREATE_URL, { method:'POST', headers:{ 'Authorization': `Bearer ${PSP_KEY}`, 'Content-Type':'application/json' }, body: JSON.stringify(payload) })
    .then(r=>r.json()).then(j=>{
      if(j && j.data && j.data.payment_url) return res.json({ ok:true, url: j.data.payment_url });
      console.error('psp create error', j); return res.status(500).json({ error:'psp_error', detail:j });
    }).catch(err=>{ console.error(err); return res.status(500).json({ error:'psp_request_failed' }); });
});

// PSP webhook / callback
app.post('/api/link-card/callback', (req,res)=>{
  // Warning: in prod verify signature header!
  const body = req.body || {};
  const metadata = body.metadata || {};
  const userId = metadata.userId || body.userId || (req.query && req.query.userId);
  if(!userId){ res.status(400).send('no_user'); return; }

  const d = body.data || body; // adapt to PSP payload
  // demo behavior: allow tokens in body.token, last4 in body.last4, brand in body.brand
  const token = d.token || d.payment_token || d.token_id;
  const last4 = d.last4 || (d.card && d.card.last4) || '';
  const brand = (d.brand || (d.card && d.card.brand) || 'EDAHABIA').toUpperCase();
  const owner = d.owner || d.card_holder_name || '';

  if(!token){
    // if no token and PSP not configured, handle a demo flow via query
    // For demo we accept query params if present
    const qtoken = req.query.token || req.query.demo_token;
    const qlast4 = req.query.last4 || (req.query.card && req.query.card.slice(-4));
    if(qtoken){
      // proceed with demo token
      const rec = { id: uuidv4(), userId, token: qtoken, last4: qlast4 || '0000', brand: 'EDAHABIA', owner:'DEMO', verified:true, verifiedAt:new Date().toISOString() };
      const payments = readPayments();
      const existing = payments.find(p => p.last4 === rec.last4 && p.brand === rec.brand && p.userId !== userId);
      if(existing){
        payments.push({ id: uuidv4(), userId, token: rec.token, last4: rec.last4, brand: rec.brand, owner: rec.owner, verified:false, note:'duplicate_demo' });
        writePayments(payments);
        return res.json({ ok:false, error:'card_already_used' });
      }
      payments.push(rec); writePayments(payments);
      const users = readJSON(USERS_FILE);
      const uidx = users.findIndex(x=>x.id===userId);
      if(uidx>=0){ users[uidx].linked_payment_id = rec.id; users[uidx].is_verified = true; writeJSON(USERS_FILE, users); }
      return res.json({ ok:true, demo:true });
    }
    return res.status(400).json({ error:'no_token' });
  }

  // Prevent duplicate card used by other user
  const payments = readPayments();
  const existing = payments.find(p => p.last4 === last4 && p.brand === brand && p.userId !== userId);
  if(existing){
    payments.push({ id: uuidv4(), userId, token, last4, brand, owner, verified:false, note:'duplicate' });
    writePayments(payments);
    return res.json({ ok:false, error:'card_already_used' });
  }

  const rec = { id: uuidv4(), userId, token, last4, brand, owner, verified:true, verifiedAt:new Date().toISOString() };
  payments.push(rec); writePayments(payments);
  const users = readJSON(USERS_FILE);
  const uidx = users.findIndex(x=>x.id===userId);
  if(uidx>=0){ users[uidx].linked_payment_id = rec.id; users[uidx].is_verified = true; writeJSON(USERS_FILE, users); }

  return res.json({ ok:true });
});

// withdraw request
app.post('/api/withdraw', (req,res)=>{
  const { userId, amount } = req.body;
  if(!userId || !amount) return res.status(400).json({ error:'bad' });
  const user = findUserById(userId); if(!user) return res.status(404).json({ error:'no_user' });
  const amt = Number(amount);
  if(amt<=0 || amt> (user.balance||0)) return res.status(400).json({ error:'invalid_amount' });
  if(!user.linked_payment_id) return res.status(403).json({ error:'no_linked_payment' });

  // weekly rule
  if(user.lastWithdraw){
    const last = new Date(user.lastWithdraw);
    const days = Math.floor((Date.now()-last.getTime())/(24*3600*1000));
    if(days<7) return res.status(403).json({ error:'withdraw_weekly', daysRemaining: 7-days });
  }

  const fee = Number((amt * 0.05).toFixed(2));
  const net = Number((amt - fee).toFixed(2));

  user.balance = Number((user.balance - amt).toFixed(2));
  user.lastWithdraw = new Date().toISOString();
  saveOrUpdateUser(user);

  const withdraws = readJSON(WITHDRAWS_FILE);
  withdraws.push({ id: uuidv4(), userId:user.id, amount:amt, fee, net, payment_id:user.linked_payment_id, createdAt:new Date().toISOString(), status:'processed' });
  writeJSON(WITHDRAWS_FILE, withdraws);
  return res.json({ ok:true, message:'withdraw_processed', net, fee });
});

// invite info
app.get('/api/invite/:code', (req,res)=>{
  const code = req.params.code;
  const users = readJSON(USERS_FILE);
  const inv = users.find(x=>x.inviteCode===code);
  if(!inv) return res.status(404).json({ error:'notfound' });
  return res.json({ ok:true, inviter: { id:inv.id, name:inv.name } });
});

// admin: list users (protected by header)
app.get('/api/admin/users', (req,res)=>{
  const secret = process.env.ADMIN_SECRET || 'admin_secret';
  if(req.headers['x-admin-secret'] !== secret) return res.status(403).send('forbidden');
  const users = readJSON(USERS_FILE);
  return res.json(users.map(u=>({ id:u.id, name:u.name, balance:u.balance, totalEarned:u.totalEarned||0, linked_payment_id:u.linked_payment_id, is_verified:u.is_verified })));
});

app.get('/api/admin/payments', (req,res)=>{
  const secret = process.env.ADMIN_SECRET || 'admin_secret';
  if(req.headers['x-admin-secret'] !== secret) return res.status(403).send('forbidden');
  return res.json(readPayments());
});

// fallback
app.use((req,res)=> res.status(404).send('Not Found'));

app.listen(PORT, '0.0.0.0', ()=> console.log(`Ycine SA server listening on 0.0.0.0:${PORT}`));
