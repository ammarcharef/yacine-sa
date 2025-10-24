// public/app.js
(function(){
  const API = {
    signup: '/api/signup',
    login: '/api/login',
    videos: '/api/videos',
    progress: '/api/progress',
    claim: '/api/claim',
    withdraw: '/api/withdraw',
    linkCard: '/api/link-card',
    adminUsers: '/api/admin/users'
  };

  function $id(id){return document.getElementById(id)}
  function handleError(e){ console.error(e); alert('حدث خطأ، تحقق من الكونسول.'); }

  if($id('btnLocal')){
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
      const name = prompt('اسم حساب Facebook (محاكي)');
      if(name){ $id('txtName').value = name; $id('btnLocal').click(); }
    });
  }

  if(location.pathname.endsWith('/dashboard')){
    const raw = sessionStorage.getItem('ycine_user'); if(!raw){ location.href = '/'; return; }
    let me = JSON.parse(raw);

    // refresh profile
    fetch(API.login, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:me.name})})
      .then(r=>r.json()).then(j=>{
        if(j.error){ sessionStorage.removeItem('ycine_user'); location.href='/'; return; }
        me = j.user; sessionStorage.setItem('ycine_user', JSON.stringify(me));
        $id('userName').innerText = me.name;
        $id('navBalance').innerText = `رصيد: ${me.balance} دج`;
        $id('inviteBox').value = me.inviteCode;
        loadVideos(me.id);
        updateLinkStatus(me);
      }).catch(handleError);

    $id('btnLogout').addEventListener('click', ()=>{ sessionStorage.removeItem('ycine_user'); location.href = '/'; });
    $id('copyInvite').addEventListener('click', ()=>{ $id('inviteBox').select(); document.execCommand('copy'); alert('تم نسخ رمز الدعوة'); });
    $id('btnGoWithdraw').addEventListener('click', ()=> location.href = '/withdraw');

    // link card button
    $id('btnLinkCard').addEventListener('click', async ()=>{
      const user = JSON.parse(sessionStorage.getItem('ycine_user'));
      if(!user){ alert('سجل أولا'); return; }
      try{
        const r = await fetch(API.linkCard, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId: user.id }) });
        const j = await r.json();
        if(j.ok && j.url){
          window.open(j.url, '_blank');
          alert('تم فتح صفحة ربط البطاقة. بعد الإتمام سيتم تحديث حسابك تلقائياً.');
        } else alert('خطأ في إنشاء جلسة الربط');
      }catch(handleError);
    });

    function updateLinkStatus(user){
      if(user.linked_payment_id) $id('linkStatus').innerText = 'البطاقة مربوطة ✔️';
      else $id('linkStatus').innerText = 'لم يتم ربط البطاقة بعد';
    }

    // video player logic (same as earlier) ...
    // For brevity reuse earlier logic: loadVideos, openPlayer, progress, claim
    // loadVideos:
    async function loadVideos(userId){
      try{
        const res = await fetch(API.videos);
        const vids = await res.json();
        const list = $id('videosList'); list.innerHTML = '';
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

    // player modal handlers
    const playerModal = document.getElementById('playerModal');
    const playerVideo = document.getElementById('playerVideo');
    let activeVid = null;
    const playerClaim = document.getElementById('btnClaim');
    document.getElementById('closeModal').addEventListener('click', ()=> { playerVideo.pause(); playerModal.style.display='none'; playerClaim.disabled=true; });
    function openPlayer(v){
      activeVid = v;
      playerVideo.src = v.src;
      document.getElementById('pTitle').innerText = v.title + ` — ${v.value} دج`;
      playerVideo.currentTime = 0;
      playerModal.style.display = 'block';
      playerClaim.disabled = true;
      playerVideo.play().catch(()=>{});
    }

    playerVideo && playerVideo.addEventListener('timeupdate', ()=>{
      const ct = Math.floor(playerVideo.currentTime||0);
      if(ct && ct % 5 === 0 && activeVid){
        const userInfo = JSON.parse(sessionStorage.getItem('ycine_user'));
        fetch(API.progress, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:userInfo.id, videoId:activeVid.id, currentTime:ct, completed:false })}).catch(()=>{});
      }
    });

    playerVideo && playerVideo.addEventListener('ended', ()=>{
      const userInfo = JSON.parse(sessionStorage.getItem('ycine_user'));
      fetch(API.progress, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:userInfo.id, videoId:activeVid.id, currentTime: Math.floor(playerVideo.duration||0), completed:true })})
        .then(()=>{ playerClaim.disabled = false; }).catch(()=>{});
    });

    playerClaim.addEventListener('click', async ()=>{
      try{
        const userInfo = JSON.parse(sessionStorage.getItem('ycine_user'));
        const res = await fetch(API.claim, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:userInfo.id, videoId: activeVid.id })});
        const j = await res.json();
        if(j.ok){ alert('تم إضافة '+ j.reward + ' دج إلى رصيدك'); sessionStorage.setItem('ycine_user', JSON.stringify({id:userInfo.id, name:userInfo.name, balance:j.newBalance, inviteCode:userInfo.inviteCode, linked_payment_id:userInfo.linked_payment_id})); location.reload(); }
        else alert('لم يتم التأكيد: ' + (j.error||'خطأ'));
      }catch(handleError);
    });

    // claim daily placeholder
    $id('claimDaily') && $id('claimDaily').addEventListener('click', ()=> alert('ميزة البونص اليومي ستُفعّل قريباً'));
  }

  // withdraw page handlers
  if(location.pathname.endsWith('/withdraw')){
    const raw = sessionStorage.getItem('ycine_user'); if(!raw) { location.href='/'; return; }
    const u = JSON.parse(raw);
    $id('btnRequest').addEventListener('click', async ()=>{
      const amt = Number($id('amount').value);
      if(!amt || amt<=0){ alert('أدخل مبلغ صالح'); return; }
      try{
        const res = await fetch(API.withdraw, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId:u.id, amount:amt })});
        const j = await res.json();
        if(j.ok){ $id('withdrawMsg').innerText = `تمت معالجة الطلب: سيتم تحويل ${j.net} دج بعد رسم ${j.fee} دج`; sessionStorage.setItem('ycine_user', JSON.stringify({id:u.id, name:u.name, balance:(u.balance-amt), inviteCode:u.inviteCode, linked_payment_id:u.linked_payment_id})); }
        else alert('لم تتم العملية: ' + (j.error||'خطأ'));
      }catch(handleError);
    });
  }
})();
