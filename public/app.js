// public/app.js
// Frontend logic: talks to /api/* endpoints
(function(){
  const API = {
    signup: '/api/signup',
    login: '/api/login',
    videos: '/api/videos',
    progress: '/api/progress',
    claim: '/api/claim',
    withdraw: '/api/withdraw',
    adminUsers: '/api/admin/users'
  };

  // helpers
  function $id(id){return document.getElementById(id)}
  function handleError(e){ console.error(e); alert('حدث خطأ، تحقق من الكونسول.'); }

  // ---------- index.html handlers ----------
  if($id('btnLocal')){
    // login/register
    $id('btnLocal').addEventListener('click', async ()=>{
      const name = $id('txtName').value.trim();
      const urlParams = new URLSearchParams(window.location.search);
      const ref = urlParams.get('ref') || null;
      if(!name){ alert('ادخل اسم'); return; }
      try{
        const res = await fetch(API.signup, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, inviteCode:ref})});
        const j = await res.json();
        if(j.success){
          sessionStorage.setItem('ycine_user', JSON.stringify(j.user));
          window.location.href = '/dashboard';
        } else alert('خطأ في التسجيل');
      }catch(e){ handleError(e); }
    });

    $id('btnGoogle').addEventListener('click', ()=> {
      const name = prompt('اسم حساب Google (محاكٍ)');
      if(name){ $id('txtName').value = name; $id('btnLocal').click(); }
    });
    $id('btnFacebook').addEventListener('click', ()=> {
      const name = prompt('اسم حساب Facebook (محاكٍ)');
      if(name){ $id('txtName').value = name; $id('btnLocal').click(); }
    });
  }

  // ---------- dashboard.html handlers ----------
  if(location.pathname.endsWith('/dashboard') || location.pathname.endsWith('/dashboard/')){
    // ensure user
    const raw = sessionStorage.getItem('ycine_user'); if(!raw){ location.href = '/'; return; }
    const me = JSON.parse(raw);
    // load profile fresh
    fetch(API.login, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:me.name})})
      .then(r=>r.json()).then(async j=>{
        if(j.error) { alert('خطأ: ' + j.error); sessionStorage.removeItem('ycine_user'); location.href='/'; return; }
        const user = j.user; sessionStorage.setItem('ycine_user', JSON.stringify(user));
        // render basic infos
        $id('userName').innerText = user.name;
        $id('navBalance').innerText = `رصيد: ${user.balance} دج`;
        $id('inviteBox').value = user.inviteCode;
        loadVideos(user.id);
        loadWithdraws(user.id);
      }).catch(handleError);

    $id('btnLogout').addEventListener('click', ()=>{ sessionStorage.removeItem('ycine_user'); location.href='/'; });
    $id('copyInvite').addEventListener('click', ()=>{ $id('inviteBox').select(); document.execCommand('copy'); alert('تم نسخ رمز الدعوة'); });

    $id('btnGoWithdraw').addEventListener('click', ()=> location.href = '/withdraw');

    $id('claimDaily') && $id('claimDaily').addEventListener('click', async ()=>{
      // ask server for current user
      const raw2 = sessionStorage.getItem('ycine_user'); if(!raw2) return;
      const u = JSON.parse(raw2);
      // simple local check: count daily watched via /api/admin/users (or in a real DB you'd query)
      try{
        const users = await (await fetch(API.adminUsers)).json();
        const my = users.find(x=>x.id===u.id);
        const progress = my && my.dailyCount ? my.dailyCount.count : 0;
        if(progress >=5){ alert('سيتم إضافة 500 دج'); // For simplicity: call /api/withdraw? (we didn't implement server daily bonus endpoint)
          // In this demo we won't implement a separate endpoint; user can simply watch 5 videos then we add bonus via claim logic
        } else alert('أكمل 5 فيديوهات اليوم ثم حاول مطالبة البونص');
      }catch(handleError);
    });

    // close modal
    const playerModal = document.getElementById('playerModal');
    const playerVideo = document.getElementById('playerVideo');
    let activeVid = null;
    const playerClaim = document.getElementById('btnClaim');
    document.getElementById('closeModal').addEventListener('click', ()=> { playerVideo.pause(); playerModal.style.display='none'; playerClaim.disabled=true; });

    async function loadVideos(userId){
      try{
        const res = await fetch(API.videos);
        const vids = await res.json();
        const list = $id('videosList'); list.innerHTML = '';
        // fetch fresh user data to determine watched
        const userRes = await fetch(API.login, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name: JSON.parse(sessionStorage.getItem('ycine_user')).name})});
        const user = (await userRes.json()).user;
        vids.forEach(v=>{
          const watched = (user.watched || []).includes(v.id);
          const btn = watched ? '<button class="btn btn-success btn-sm" disabled>مشاهد</button>' : `<button class="btn btn-primary btn-sm" data-id="${v.id}">شاهد واربح</button>`;
          const col = document.createElement('div'); col.className='col-12';
          col.innerHTML = `<div class="p-2 border rounded bg-dark d-flex justify-content-between align-items-center">
            <div><strong>${v.title}</strong><div class="text-muted small">${v.duration}s — قيمة: ${v.value} دج</div></div>
            <div>${btn}</div>
          </div>`;
          list.appendChild(col);
          const b = col.querySelector('button');
          if(b && !watched) b.addEventListener('click', ()=> openPlayer(v));
        });
      }catch(handleError){};
    }

    function openPlayer(v){
      activeVid = v;
      playerVideo.src = v.src;
      document.getElementById('pTitle').innerText = v.title + ` — ${v.value} دج`;
      playerVideo.currentTime = 0;
      playerModal.style.display = 'block';
      playerClaim.disabled = true;
      playerVideo.play().catch(()=>{});
    }

    // progress tracking - simple: every 5 sec send progress
    let reportInterval = null;
    playerVideo && playerVideo.addEventListener('timeupdate', ()=>{
      const ct = Math.floor(playerVideo.currentTime||0);
      if(ct && ct % 5 === 0 && activeVid){
        // send progress
        const userInfo = JSON.parse(sessionStorage.getItem('ycine_user'));
        fetch(API.progress, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:userInfo.id, videoId:activeVid.id, currentTime:ct, completed:false })}).catch(()=>{});
      }
    });

    playerVideo && playerVideo.addEventListener('ended', ()=>{
      // send completed
      const userInfo = JSON.parse(sessionStorage.getItem('ycine_user'));
      fetch(API.progress, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:userInfo.id, videoId:activeVid.id, currentTime: Math.floor(playerVideo.duration||0), completed:true })})
        .then(()=>{ playerClaim.disabled = false; }).catch(()=>{});
    });

    playerClaim.addEventListener('click', async ()=>{
      try{
        const userInfo = JSON.parse(sessionStorage.getItem('ycine_user'));
        const res = await fetch(API.claim, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:userInfo.id, videoId: activeVid.id })});
        const j = await res.json();
        if(j.ok){ alert('تم إضافة '+ j.reward + ' دج إلى رصيدك'); sessionStorage.setItem('ycine_user', JSON.stringify({id:userInfo.id, name:userInfo.name, balance:j.newBalance, inviteCode:userInfo.inviteCode})); location.reload(); }
        else alert('لم يتم التأكيد: ' + (j.error||'خطأ'));
      }catch(handleError);
    });

    function loadWithdraws(userId){
      // show list from /api/admin/users (we simplified)
      fetch(API.adminUsers).then(r=>r.json()).then(users=>{
        const u = users.find(x=>x.id === JSON.parse(sessionStorage.getItem('ycine_user')).id);
        if(u){ $id('todayCount').innerText = `${(u.dailyCount && u.dailyCount.count) || 0}/10`; $id('navBalance').innerText = `رصيد: ${u.balance} دج`; $id('inviteBox').value = u.inviteCode; $id('dailyProg').innerText = (u.dailyCount && u.dailyCount.count) || 0; }
      }).catch(()=>{});
    }
  }

  // ---------- withdraw.html handlers ----------
  if(location.pathname.endsWith('/withdraw')){
    const raw = sessionStorage.getItem('ycine_user'); if(!raw) { location.href='/'; return; }
    const u = JSON.parse(raw);
    $id('btnRequest').addEventListener('click', async ()=>{
      const amt = Number($id('amount').value);
      if(!amt || amt<=0){ alert('أدخل مبلغ صالح'); return; }
      try{
        const res = await fetch(API.withdraw, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:u.id, amount:amt })});
        const j = await res.json();
        if(j.ok){ $id('withdrawMsg').innerText = `تمت معالجة الطلب: سيتم تحويل ${j.net} دج بعد رسم ${j.fee} دج`; sessionStorage.setItem('ycine_user', JSON.stringify({id:u.id, name:u.name, balance:(u.balance-amt), inviteCode:u.inviteCode})); }
        else alert('لم تتم العملية: ' + (j.error||'خطأ'));
      }catch(handleError);
    });
  }

})();