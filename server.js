// server.js
// Simple Node/Express server for Ycine SA (JSON file DB - local)
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// DB files
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const WITHDRAWS_FILE = path.join(DATA_DIR, 'withdraws.json');

function ensureFile(file, initial) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(initial, null, 2), 'utf8');
}
ensureFile(USERS_FILE, []);
ensureFile(VIDEOS_FILE, [
  { id:"VID1", title:"إعلان منتج X", value:1000, duration:20, thumbnail:"/static/img/v1.jpg", src:"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id:"VID2", title:"إعلان خدمة Y", value:800, duration:15, thumbnail:"/static/img/v2.jpg", src:"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" },
  { id:"VID3", title:"إعلان تطبيق Z", value:600, duration:12, thumbnail:"/static/img/v3.jpg", src:"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" }
]);
ensureFile(WITHDRAWS_FILE, []);

function readJSON(file){ return JSON.parse(fs.readFileSync(file,'utf8')); }
function writeJSON(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

// Middlewares
app.use(helmet());
app.use(bodyParser.json({limit:'1mb'}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/static', express.static(path.join(__dirname, 'public')));

// rate limit - basic
const limiter = rateLimit({ windowMs: 5*1000, max: 200 });
app.use(limiter);

// Utilities
function findUserById(id){
  const users = readJSON(USERS_FILE);
  return users.find(u=>u.id===id);
}
function saveOrUpdateUser(user){
  const users = readJSON(USERS_FILE);
  const i = users.findIndex(x=>x.id===user.id);
  if (i>=0) users[i]=user; else users.push(user);
  writeJSON(USERS_FILE, users);
}
function recomputeLevel(user){
  const t = user.totalEarned || 0;
  if(t>=50000) user.level='VIP';
  else if(t>=20000) user.level='Gold';
  else if(t>=5000) user.level='Silver';
  else user.level='Bronze';
}

// ---------- Public routes ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname,'public','dashboard.html')));
app.get('/withdraw', (req, res) => res.sendFile(path.join(__dirname,'public','withdraw.html')));

// ---------- API ---------- //

// signup (simulated: name + optional inviteCode)
app.post('/api/signup', (req,res)=>{
  const { name, inviteCode } = req.body;
  if(!name) return res.status(400).json({ error: 'name required' });
  const users = readJSON(USERS_FILE);
  let u = users.find(x=>x.name===name);
  if(!u){
    u = {
      id: uuidv4(), name, balance:0, watched:[], inviteCode: (name.replace(/\s+/g,'').slice(0,6).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase()),
      inviterId: null, totalEarned:0, lastWithdraw:null, createdAt:new Date().toISOString(), level:'Bronze',
      dailyCount:{ date: new Date().toISOString().slice(0,10), count:0 }, progress:{}, invites:0
    };
    // if inviteCode given, link inviter
    if(inviteCode){
      const inv = users.find(x=>x.inviteCode===inviteCode);
      if(inv){ u.inviterId = inv.id; inv.invites = (inv.invites||0) + 1; saveOrUpdateUser(inv); }
    }
    users.push(u); writeJSON(USERS_FILE, users);
  }
  // return minimal profile
  return res.json({ success:true, user:{ id:u.id, name:u.name, balance:u.balance, inviteCode:u.inviteCode }});
});

// login (by name)
app.post('/api/login', (req,res)=>{
  const { name } = req.body;
  if(!name) return res.status(400).json({ error:'name required' });
  const users = readJSON(USERS_FILE);
  const u = users.find(x=>x.name===name);
  if(!u) return res.status(404).json({ error:'notfound' });
  return res.json({ success:true, user:{ id:u.id, name:u.name, balance:u.balance, inviteCode:u.inviteCode }});
});

// get videos
app.get('/api/videos', (req,res)=>{
  const vids = readJSON(VIDEOS_FILE);
  res.json(vids);
});

// save progress (server-side record - simple)
app.post('/api/progress', (req,res)=>{
  const { userId, videoId, currentTime, completed } = req.body;
  if(!userId || !videoId) return res.status(400).json({ error:'bad' });
  const user = findUserById(userId);
  if(!user) return res.status(404).json({ error:'no_user' });
  user.progress = user.progress || {};
  user.progress[videoId] = { currentTime: currentTime || 0, completed: !!completed, updatedAt:new Date().toISOString() };
  saveOrUpdateUser(user);
  return res.json({ ok:true, progress:user.progress[videoId] });
});

// claim reward (server verifies recorded progress completed==true and not claimed)
app.post('/api/claim', (req,res)=>{
  const { userId, videoId } = req.body;
  if(!userId || !videoId) return res.status(400).json({ error:'bad' });
  const user = findUserById(userId); if(!user) return res.status(404).json({ error:'no_user' });
  user.progress = user.progress || {};
  const p = user.progress[videoId];
  if(!p || !p.completed) return res.status(403).json({ error:'not_completed' });
  // prevent double-claim via watched list
  user.watched = user.watched || [];
  if(user.watched.includes(videoId)) return res.status(409).json({ error:'already_claimed' });

  const videos = readJSON(VIDEOS_FILE);
  const v = videos.find(x=>x.id===videoId);
  if(!v) return res.status(404).json({ error:'video_not_found' });

  // economics per spec:
  // total value = v.value
  // platformRevenue = v.value * 0.9  (your share as platform owner)
  // viewerReward = platformRevenue * 0.10  (10% of platformRevenue goes to viewer)
  // platformNet = platformRevenue - viewerReward
  const platformRevenue = Number((v.value * 0.9).toFixed(2));
  const viewerReward = Number((platformRevenue * 0.10).toFixed(2));
  const platformNet = Number((platformRevenue - viewerReward).toFixed(2));

  // update viewer
  user.balance = Number(( (user.balance || 0) + viewerReward ).toFixed(2));
  user.watched.push(videoId);
  user.totalEarned = Number((user.totalEarned || 0) + viewerReward);
  // update daily count
  const today = new Date().toISOString().slice(0,10);
  if(!user.dailyCount || user.dailyCount.date !== today) user.dailyCount = { date: today, count:0 };
  user.dailyCount.count = (user.dailyCount.count||0) + 1;

  // inviter commission 10% of viewerReward (recurring)
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

  // note: platformNet aggregated only in memory (for demo)
  return res.json({ ok:true, reward: viewerReward, newBalance: user.balance, platformNet });
});

// withdraw request (weekly)
app.post('/api/withdraw', (req,res)=>{
  const { userId, amount } = req.body;
  if(!userId || !amount) return res.status(400).json({ error:'bad' });
  const user = findUserById(userId); if(!user) return res.status(404).json({ error:'no_user' });
  const amt = Number(amount);
  if(amt <= 0 || amt > (user.balance||0)) return res.status(400).json({ error:'invalid_amount' });
  // check weekly rule
  if(user.lastWithdraw){
    const last = new Date(user.lastWithdraw);
    const days = Math.floor((Date.now()-last.getTime())/(24*3600*1000));
    if(days < 7) return res.status(403).json({ error:'withdraw_weekly', daysRemaining: 7-days });
  }
  const fee = Number((amt * 0.05).toFixed(2));
  const net = Number((amt - fee).toFixed(2));
  // simulate withdraw: record and deduct
  user.balance = Number((user.balance - amt).toFixed(2));
  user.lastWithdraw = new Date().toISOString();
  saveOrUpdateUser(user);
  const withdraws = readJSON(WITHDRAWS_FILE);
  withdraws.push({ id: uuidv4(), userId:user.id, amount:amt, fee, net, createdAt:new Date().toISOString(), status:'processed' });
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

// admin: list users (local network only)
app.get('/api/admin/users', (req,res)=>{
  const users = readJSON(USERS_FILE);
  return res.json(users.map(u=>({ id:u.id, name:u.name, balance:u.balance, totalEarned:u.totalEarned||0 })));
});

// fallback
app.use((req,res)=> res.status(404).send('Not Found'));

// start
app.listen(PORT, '0.0.0.0', () => console.log(`Ycine SA server listening on 0.0.0.0:${PORT}`));