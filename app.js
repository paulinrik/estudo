(function(){
'use strict';

/* ---------- constants ---------- */
const LEVELS=['Cinza','Verde','Azul','Amarelo','Laranja','Vermelho'];
const MONTHS=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MSHORT=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const WEEKDAYS=['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
const SCALES=['day','week','month'];
const SCALE_LABEL={day:'Dia',week:'Semana',month:'Mês'};
const DEFAULTS={day:[0.25,1,2,4,6],week:[2,8,12,16,24],month:[14,25,60,100,150]};
const KEY_RE=/^\d{4}-\d{2}-\d{2}$/;
const LS={days:'estudo:v1:days',timer:'estudo:v1:timer',settings:'estudo:v1:settings',demoOff:'estudo:v1:demoOff',changedAt:'estudo:v1:changedAt',cloudUser:'estudo:v1:cloudUser'};

/* ---------- helpers ---------- */
const $=id=>document.getElementById(id);
const clone=o=>JSON.parse(JSON.stringify(o));
const pad=n=>String(n).padStart(2,'0');
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
function lsGet(k){try{const v=localStorage.getItem(k);return v==null?null:JSON.parse(v);}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function dayKey(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function parseKey(k){const p=k.split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function mondayOf(d){const x=startOfDay(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
function hhmm(ms){const d=new Date(ms);return pad(d.getHours())+':'+pad(d.getMinutes());}

function fmtClock(ms){
  let s=Math.floor(Math.max(0,ms)/1000);
  const h=Math.floor(s/3600);s%=3600;
  const m=Math.floor(s/60);s%=60;
  return pad(h)+':'+pad(m)+':'+pad(s);
}
function fmtHM(sec){
  const m=Math.floor(Math.max(0,Math.round(sec))/60);
  const h=Math.floor(m/60),mm=m%60;
  if(h===0)return mm+'min';
  return mm===0?h+'h':h+'h '+pad(mm)+'min';
}
function fmtC(sec){
  const m=Math.floor(Math.max(0,Math.round(sec))/60);
  if(m<=0)return '';
  const h=Math.floor(m/60),mm=m%60;
  if(h===0)return mm+'m';
  return mm===0?h+'h':h+'h'+pad(mm);
}
function fmtH(h){
  if(h<1)return Math.round(h*60)+'min';
  const w=Math.floor(h),m=Math.round((h-w)*60);
  return m?w+'h'+pad(m):w+'h';
}

/* ---------- scoring ---------- */
function levelOf(sec,thr){
  let l=0;
  for(let i=0;i<5;i++){ if(sec>=thr[i]*3600-0.5)l=i+1; else break; }
  return l;
}
function progress(sec,thr){
  const l=levelOf(sec,thr);
  if(l>=5)return {level:5,frac:1,missing:0};
  const lower=l===0?0:thr[l-1]*3600,upper=thr[l]*3600;
  return {level:l,frac:(sec-lower)/(upper-lower),missing:Math.max(60,Math.ceil((upper-sec)/60)*60)};
}

/* ---------- sanitizers ---------- */
function sanitizeSessions(arr){
  const out=[];
  if(!Array.isArray(arr))return out;
  for(const s of arr){
    if(!s||typeof s!=='object')continue;
    const study=Number(s.study)||0,rest=Number(s.rest)||0;
    if(study<0||rest<0||study+rest<=0)continue;
    const o={id:Number(s.id)||0,at:Number(s.at)||0,study:Math.round(study),rest:Math.round(rest)};
    if(s.manual)o.manual=true;
    out.push(o);
  }
  return out;
}
function sanitizeDays(obj){
  const out={};
  if(!obj||typeof obj!=='object')return out;
  for(const k of Object.keys(obj)){
    if(!KEY_RE.test(k))continue;
    const ss=sanitizeSessions(obj[k]&&obj[k].sessions);
    if(ss.length)out[k]={sessions:ss};
  }
  return out;
}
function validScale(v){
  return Array.isArray(v)&&v.length===5&&v.every(x=>typeof x==='number'&&isFinite(x)&&x>0)&&v.every((x,i)=>i===0||x>v[i-1]);
}
function sanitizeSettings(o){
  if(!o||typeof o!=='object')return null;
  const out={};
  for(const sc of SCALES)out[sc]=validScale(o[sc])?o[sc].slice():DEFAULTS[sc].slice();
  return out;
}
function idleTimer(u){return {status:'idle',startedAt:null,segs:[],cur:null,updatedAt:u||0};}
function sanitizeTimer(o){
  if(!o||typeof o!=='object')return null;
  const u=Number(o.updatedAt)||0;
  if(!o.cur||(o.cur.t!=='study'&&o.cur.t!=='rest')||!isFinite(Number(o.cur.s)))return idleTimer(u);
  const segs=[];
  if(Array.isArray(o.segs)){
    for(const g of o.segs){
      if(g&&(g.t==='study'||g.t==='rest')&&isFinite(+g.s)&&isFinite(+g.e)&&+g.e>=+g.s)segs.push({t:g.t,s:+g.s,e:+g.e});
    }
  }
  return {status:o.cur.t,startedAt:Number(o.startedAt)||Number(o.cur.s),segs:segs,cur:{t:o.cur.t,s:+o.cur.s},updatedAt:u};
}

/* ---------- state ---------- */
let days=sanitizeDays(lsGet(LS.days));
let settings=sanitizeSettings(lsGet(LS.settings))||clone(DEFAULTS);
let timer=sanitizeTimer(lsGet(LS.timer))||idleTimer(0);
const nowD=new Date();
const st={
  mode:'local',synced:false,syncErr:false,
  demoOff:!!lsGet(LS.demoOff),useDemo:false,live:{},
  view:{y:nowD.getFullYear(),m:nowD.getMonth()},
  todayKey:dayKey(nowD),sel:dayKey(nowD),confirmDel:null
};/* ---------- time spans (a session can cross midnight) ---------- */
function spanDays(type,s,e,out){
  let cur=s;
  while(cur<e){
    const d=new Date(cur);
    const next=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime();
    const end=Math.min(e,next);
    const k=dayKey(d);
    const o=out[k]||(out[k]={study:0,rest:0,at:cur});
    o[type]+=(end-cur)/1000;
    cur=end;
  }
}
function spansOf(list){const out={};for(const g of list)spanDays(g.t,g.s,g.e,out);return out;}
function liveSpans(now){
  if(!timer.cur)return {};
  return spansOf(timer.segs.concat([{t:timer.cur.t,s:timer.cur.s,e:Math.max(now,timer.cur.s)}]));
}
function timerTotals(now){
  let study=0,rest=0;
  for(const g of timer.segs){if(g.t==='study')study+=g.e-g.s;else rest+=g.e-g.s;}
  if(timer.cur){
    const d=Math.max(0,now-timer.cur.s);
    if(timer.cur.t==='study')study+=d;else rest+=d;
  }
  return {study:study,rest:rest};
}

/* ---------- demo data (never saved) ---------- */
let demoCache=null;
function demoDays(){
  if(demoCache)return demoCache;
  const out={};
  let seed=20260;
  const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const pool=[0,0,0.3,0.8,1.2,1.8,2.4,2.9,3.4,3.9,4.5,5.2,6.4,7.1];
  const today=startOfDay(new Date());
  for(let i=1;i<=90;i++){
    const d=new Date(today);d.setDate(d.getDate()-i);
    let h=pool[Math.floor(rnd()*pool.length)];
    if(d.getDay()===0||d.getDay()===6)h*=0.6;
    if(h<=0)continue;
    const study=Math.round(h*3600);
    out[dayKey(d)]={sessions:[{id:-i,at:d.getTime()+19*3600000,study:study,rest:Math.round(study*0.14)}]};
  }
  demoCache=out;
  return out;
}
function showDemo(){return st.synced&&!st.demoOff&&Object.keys(days).length===0&&!timer.cur;}

/* ---------- totals ---------- */
function dayTotals(key){
  const rec=(st.useDemo?demoDays():days)[key];
  let study=0,rest=0,n=0;
  if(rec){for(const s of rec.sessions){study+=s.study||0;rest+=s.rest||0;n++;}}
  const lv=st.live[key];
  if(lv){study+=lv.study;rest+=lv.rest;}
  return {study:study,rest:rest,n:n};
}
function sumDays(start,count){
  let study=0,rest=0;
  const d=new Date(start);
  for(let i=0;i<count;i++){const t=dayTotals(dayKey(d));study+=t.study;rest+=t.rest;d.setDate(d.getDate()+1);}
  return {study:study,rest:rest};
}
function monthTotal(y,m){return sumDays(new Date(y,m,1),new Date(y,m+1,0).getDate()).study;}
function streakDays(){
  const d=startOfDay(new Date());
  if(levelOf(dayTotals(dayKey(d)).study,settings.day)===0)d.setDate(d.getDate()-1);
  let n=0;
  while(n<3660&&levelOf(dayTotals(dayKey(d)).study,settings.day)>0){n++;d.setDate(d.getDate()-1);}
  return n;
}

/* ---------- local and cloud persistence ---------- */
let supabase=null,authUser=null,authMode='signin',handledUserId=null;
let cloudQueue=Promise.resolve(),cloudSaveTimer=null;
let localChangedAt=Number(lsGet(LS.changedAt))||0;
const SUPABASE_URL='https://qtupublxssisrzfalaij.supabase.co';
const SUPABASE_KEY='sb_publishable_7N_5ILhk0C79VPAu7FiWMw_Qfz6ERSN';
const CLOUD_TABLE='estudo_dados';
function touchLocal(){localChangedAt=Date.now();lsSet(LS.changedAt,localChangedAt);}
function scheduleCloudSave(){
  if(!supabase||!authUser)return;
  clearTimeout(cloudSaveTimer);
  $('authStatus').textContent='Salvando na nuvem…';
  cloudSaveTimer=setTimeout(()=>{
    cloudQueue=cloudQueue.then(saveCloudNow).catch(err=>{
      st.syncErr=true;
      setAuthMessage('Salvo neste aparelho. Falha na nuvem: '+(err.message||'verifique a conexão.'),true);
      renderFoot();
    });
  },450);
}
async function saveCloudNow(){
  if(!supabase||!authUser)return;
  const userId=authUser.id;
  const payload={user_id:userId,dados:{days:days,settings:settings},updated_at:new Date().toISOString()};
  const {error}=await supabase.from(CLOUD_TABLE).upsert(payload,{onConflict:'user_id'});
  if(error)throw error;
  if(!authUser||authUser.id!==userId)return;
  st.syncErr=false;st.synced=true;lsSet(LS.cloudUser,userId);
  $('authStatus').textContent='Sincronizado com a nuvem';renderFoot();
}
function saveDay(key){lsSet(LS.days,days);touchLocal();scheduleCloudSave();}
function saveTimer(){lsSet(LS.timer,timer);}
function saveSettings(){lsSet(LS.settings,settings);touchLocal();scheduleCloudSave();}
function mergeDays(primary,secondary){
  const merged=sanitizeDays(primary),extra=sanitizeDays(secondary);
  for(const key of Object.keys(extra)){
    const target=merged[key]||(merged[key]={sessions:[]});
    const seen=new Set(target.sessions.map(s=>[s.id,s.at,s.study,s.rest].join(':')));
    for(const session of extra[key].sessions){
      const sig=[session.id,session.at,session.study,session.rest].join(':');
      if(!seen.has(sig)){target.sessions.push(session);seen.add(sig);}
    }
    target.sessions.sort((a,b)=>a.at-b.at);
  }
  return merged;
}
function setAuthMessage(message,isError){
  $('authStatus').textContent=message;
  $('authStatus').className='auth-status'+(isError?' err':'');
}
function renderAuth(){
  const signedIn=!!authUser;
  $('authForm').hidden=signedIn;$('authModeToggle').hidden=signedIn;$('authSignedIn').hidden=!signedIn;
  $('authUserLabel').textContent=signedIn?'Conectado como '+(authUser.email||'sua conta'):'';
  $('authSubmit').textContent=authMode==='signup'?'Criar conta':'Entrar';
  $('authModeToggle').textContent=authMode==='signup'?'Já tenho conta · Entrar':'Criar conta';
}
async function handleCloudSession(session){
  if(!session||!session.user||handledUserId===session.user.id)return;
  handledUserId=session.user.id;authUser=session.user;
  st.mode='connecting';st.synced=false;st.syncErr=false;renderAuth();setAuthMessage('Buscando seus dados na nuvem…',false);renderFoot();
  try{
    const previousAccount=lsGet(LS.cloudUser),keepLocal=!previousAccount||previousAccount===authUser.id;
    const localDays=keepLocal?days:{},localSettings=keepLocal?settings:clone(DEFAULTS);
    const hasLocalSettings=keepLocal&&!!lsGet(LS.settings),localTimestamp=keepLocal?(Number(lsGet(LS.changedAt))||0):0;
    const {data,error}=await supabase.from(CLOUD_TABLE).select('dados,updated_at').eq('user_id',authUser.id).maybeSingle();
    if(error)throw error;
    const remote=data&&data.dados;
    if(remote&&typeof remote==='object'){
      days=mergeDays(sanitizeDays(remote.days),localDays);
      const remoteSettings=sanitizeSettings(remote.settings),remoteAt=Date.parse(data.updated_at)||0;
      settings=hasLocalSettings&&localTimestamp>remoteAt?localSettings:(remoteSettings||localSettings);
    }else{days=sanitizeDays(localDays);settings=localSettings;}
    lsSet(LS.days,days);lsSet(LS.settings,settings);lsSet(LS.cloudUser,authUser.id);touchLocal();
    st.mode='remote';st.synced=true;fillSettings();renderAll();setAuthMessage('Dados do aparelho e da nuvem conferidos.',false);
    await saveCloudNow();
  }catch(err){
    st.mode='local';st.synced=false;st.syncErr=true;
    setAuthMessage('Não foi possível sincronizar. Confira a tabela estudo_dados e a conexão: '+(err.message||'erro desconhecido'),true);renderAll();
  }
}
function initializeCloud(){
  st.mode='local';
  if(!window.supabase||typeof window.supabase.createClient!=='function'){
    setAuthMessage('Não foi possível carregar o serviço de nuvem.',true);renderAll();return;
  }
  supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  supabase.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){
      authUser=null;handledUserId=null;st.mode='local';st.synced=false;st.syncErr=false;
      renderAuth();setAuthMessage('Saiu da conta. Os dados deste aparelho continuam salvos localmente.',false);renderAll();
    }else if(session&&(event==='SIGNED_IN'||event==='TOKEN_REFRESHED'||event==='INITIAL_SESSION')){
      handleCloudSession(session);
    }else if(event==='INITIAL_SESSION'){
      authUser=null;renderAuth();setAuthMessage('Entre com a mesma conta do Livro Caixa para sincronizar.',false);
    }
  });
  supabase.auth.getSession().then(({data,error})=>{
    if(error)throw error;
    if(data&&data.session)handleCloudSession(data.session);
    else{authUser=null;renderAuth();setAuthMessage('Entre com a mesma conta do Livro Caixa para sincronizar.',false);}
  }).catch(err=>setAuthMessage('Não foi possível verificar sua conta: '+(err.message||'erro desconhecido'),true));
}

/* ---------- timer actions ---------- *//* ---------- timer actions ---------- */
function startStudy(){
  const now=Date.now();
  timer={status:'study',startedAt:now,segs:[],cur:{t:'study',s:now},updatedAt:now};
  saveTimer();renderAll();
}
function toggleRest(){
  if(!timer.cur)return;
  const now=Date.now(),prev=timer.cur;
  timer.segs.push({t:prev.t,s:prev.s,e:Math.max(now,prev.s)});
  const nt=prev.t==='study'?'rest':'study';
  timer.cur={t:nt,s:now};timer.status=nt;timer.updatedAt=now;
  saveTimer();renderAll();
}
function finish(){
  if(!timer.cur)return;
  const now=Date.now();
  const segs=timer.segs.concat([{t:timer.cur.t,s:timer.cur.s,e:Math.max(now,timer.cur.s)}]);
  const spans=spansOf(segs);
  const id=timer.startedAt||now;
  const tot=timerTotals(now);
  let total=0;
  for(const k in spans)total+=spans[k].study+spans[k].rest;
  timer=idleTimer(now);
  saveTimer();
  if(total<5){toast('Sessão muito curta, não foi salva.');renderAll();return;}
  for(const k of Object.keys(spans)){
    const sp=spans[k],study=Math.round(sp.study),rest=Math.round(sp.rest);
    if(study+rest<=0)continue;
    (days[k]||(days[k]={sessions:[]})).sessions.push({id:id,at:Math.round(sp.at),study:study,rest:rest});
    saveDay(k);
  }
  toast('Sessão salva: '+fmtHM(tot.study/1000)+' de estudo e '+fmtHM(tot.rest/1000)+' de descanso.');
  renderAll();
}
function removeSession(key,id){
  const rec=days[key];
  if(!rec)return;
  rec.sessions=rec.sessions.filter(s=>s.id!==id);
  if(!rec.sessions.length)delete days[key];
  saveDay(key);
  toast('Sessão removida.');
  renderDerived();
}

/* ---------- toast ---------- */
let toastT;
function toast(msg){
  $('toastMsg').textContent=msg;
  $('toast').classList.add('show');
  clearTimeout(toastT);
  toastT=setTimeout(()=>$('toast').classList.remove('show'),3800);
}

/* ---------- rendering ---------- */
function updateClocks(){
  const t=timerTotals(Date.now());
  $('studyClock').textContent=fmtClock(t.study);
  $('restClock').textContent=fmtClock(t.rest);
}
function renderTimer(){
  const s=timer.status;
  $('pill').dataset.s=s;
  $('pillText').textContent=s==='study'?'Estudando':s==='rest'?'Descansando':'Parado';
  $('clockStudy').classList.toggle('active',s==='study');
  $('clockRest').classList.toggle('active',s==='rest');
  $('btnMain').textContent=s==='idle'?'Iniciar estudo':s==='study'?'Descansar':'Voltar a estudar';
  $('btnFinish').hidden=s==='idle';
  let foot;
  if(s==='idle'){
    foot='Toque em Descansar nas pausas. O descanso fica registrado junto, mas não conta para a cor do dia.';
  }else{
    const sd=new Date(timer.startedAt||Date.now());
    const same=dayKey(sd)===dayKey(new Date());
    foot='Sessão iniciada '+(same?'às ':'em '+pad(sd.getDate())+'/'+pad(sd.getMonth()+1)+' às ')+hhmm(sd.getTime())+'.';
  }
  $('timerFoot').textContent=foot;
  updateClocks();
}
function renderHeader(){
  const n=new Date();
  $('todayLabel').textContent=cap(WEEKDAYS[n.getDay()])+', '+n.getDate()+' de '+MONTHS[n.getMonth()];
  const s=streakDays();
  $('streak').innerHTML='<span class="streak-n">'+s+'</span><span class="streak-l">'+(s===1?'dia seguido':'dias seguidos')+'</span>';
}
function renderBanner(){$('demoBanner').hidden=!st.useDemo;}

function scoreRow(name,t,thr){
  const p=progress(t.study,thr);
  let segs='';
  for(let i=0;i<5;i++){
    const f=i<p.level?1:(i===p.level?p.frac:0);
    segs+='<span class="seg"><i style="width:'+Math.round(Math.max(0,Math.min(1,f))*100)+'%;background:var(--h'+(i+1)+')"></i></span>';
  }
  const hint=p.level>=5?'Faixa máxima atingida':'faltam '+fmtHM(p.missing)+' para '+LEVELS[p.level+1];
  return '<div class="score"><div class="score-top"><span class="score-name">'+name+'</span><span class="score-val">'+fmtHM(t.study)+'</span></div>'
    +'<div class="meter" aria-hidden="true">'+segs+'</div>'
    +'<div class="score-bot"><span class="chip" data-l="'+p.level+'">'+LEVELS[p.level]+'</span><span class="score-hint">'+hint+'</span><span class="score-rest">descanso '+fmtHM(t.rest)+'</span></div></div>';
}
function renderScores(){
  const n=new Date();
  const dt=dayTotals(dayKey(n));
  const wk=sumDays(mondayOf(n),7);
  const mo=sumDays(new Date(n.getFullYear(),n.getMonth(),1),new Date(n.getFullYear(),n.getMonth()+1,0).getDate());
  $('scoreList').innerHTML=scoreRow('Hoje',dt,settings.day)+scoreRow('Esta semana',wk,settings.week)+scoreRow('Este mês',mo,settings.month);
}

function renderCalendar(){
  const y=st.view.y,m=st.view.m,today=st.todayKey;
  const now=new Date(),cur=now.getFullYear()*12+now.getMonth();
  const last=new Date(y,m+1,0);
  const d=mondayOf(new Date(y,m,1));
  let h=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom','Sem.'].map(n=>'<div class="dow" aria-hidden="true">'+n+'</div>').join('');
  while(d<=last){
    let wk=0,allFuture=true;
    for(let i=0;i<7;i++){
      const k=dayKey(d),t=dayTotals(k),lvl=levelOf(t.study,settings.day);
      const future=k>today,out=d.getMonth()!==m;
      wk+=t.study;
      if(!future)allFuture=false;
      const cls='cell'+(out?' out':'')+(k===today?' today':'')+(k===st.sel?' sel':'')+(future?' future':'');
      const label=d.getDate()+' de '+MONTHS[d.getMonth()]+': '+(future?'dia futuro':fmtHM(t.study)+' de estudo, '+LEVELS[lvl]);
      h+='<button type="button" class="'+cls+'" data-key="'+k+'" data-l="'+lvl+'" aria-label="'+label+'" aria-pressed="'+(k===st.sel)+'"'+(future?' disabled':'')+'>'
        +'<span class="n">'+d.getDate()+'</span><span class="t">'+(future?'':fmtC(t.study))+'</span></button>';
      d.setDate(d.getDate()+1);
    }
    const wl=levelOf(wk,settings.week);
    h+='<div class="cell wk'+(allFuture?' future':'')+'" data-l="'+wl+'" role="img" aria-label="Total da semana: '+fmtHM(wk)+', '+LEVELS[wl]+'"><span class="t">'+(allFuture?'':(fmtC(wk)||'–'))+'</span></div>';
  }
  $('calGrid').innerHTML=h;

  const mt=monthTotal(y,m),ml=levelOf(mt,settings.month);
  $('monthTitle').textContent=cap(MONTHS[m])+' de '+y;
  $('monthTotal').textContent=fmtHM(mt);
  const chip=$('monthChip');
  chip.textContent=LEVELS[ml];
  chip.dataset.l=ml;
  $('nextM').disabled=y*12+m>=cur;
  const sd=parseKey(st.sel);
  $('addFor').textContent='Dia selecionado: '+pad(sd.getDate())+'/'+pad(sd.getMonth()+1)+'/'+sd.getFullYear();
}

function renderLegend(){
  const thr=settings.day;
  $('legend').innerHTML=LEVELS.map((n,i)=>'<li><i style="background:var(--h'+i+')"></i><span><b>'+n+'</b><small>'+(i===0?'&lt; '+fmtH(thr[0]):fmtH(thr[i-1])+'+')+'</small></span></li>').join('');
}

function renderDetail(){
  const k=st.sel,t=dayTotals(k),lvl=levelOf(t.study,settings.day),d=parseKey(k);
  const rec=(st.useDemo?demoDays():days)[k];
  const list=(rec?rec.sessions.slice():[]).sort((a,b)=>a.at-b.at);
  const isToday=k===st.todayKey;
  let li=list.map(s=>{
    const when=s.manual?'Manual':hhmm(s.at);
    const confirming=st.confirmDel===s.id;
    const del=st.useDemo?'':'<button type="button" class="link-btn'+(confirming?' danger':'')+'" data-del="'+s.id+'">'+(confirming?'Confirmar remoção':'Remover')+'</button>';
    return '<li><span class="s-when">'+when+'</span><span class="s-val">'+fmtHM(s.study)+' de estudo'+(s.rest?' · '+fmtHM(s.rest)+' de descanso':'')+'</span>'+del+'</li>';
  }).join('');
  if(isToday&&timer.cur){
    const lt=timerTotals(Date.now());
    li+='<li><span class="s-when">Agora</span><span class="s-val">'+fmtHM(lt.study/1000)+' de estudo · '+fmtHM(lt.rest/1000)+' de descanso</span><span class="s-tag">em andamento</span></li>';
  }
  const yearPart=d.getFullYear()!==new Date().getFullYear()?' de '+d.getFullYear():'';
  $('dayDetail').innerHTML=
    '<div class="detail-head"><h3 class="detail-title">'+cap(WEEKDAYS[d.getDay()])+', '+d.getDate()+' de '+MONTHS[d.getMonth()]+yearPart+(isToday?' (hoje)':'')+'</h3><span class="chip" data-l="'+lvl+'">'+LEVELS[lvl]+'</span></div>'
    +'<dl class="detail-nums"><div><dt>Estudo</dt><dd>'+fmtHM(t.study)+'</dd></div><div><dt>Descanso</dt><dd>'+fmtHM(t.rest)+'</dd></div><div><dt>Sessões</dt><dd>'+(t.n+(isToday&&timer.cur?1:0))+'</dd></div></dl>'
    +(li?'<ul class="sess">'+li+'</ul>':'<p class="empty">Nenhuma sessão registrada neste dia.</p>');
}

function renderYear(){
  const y=st.view.y,now=new Date(),cur=now.getFullYear()*12+now.getMonth();
  let total=0,h='';
  for(let m=0;m<12;m++){
    const t=monthTotal(y,m);
    total+=t;
    const future=y*12+m>cur,lvl=levelOf(t,settings.month);
    h+='<button type="button" class="tile'+(m===st.view.m?' sel':'')+(future?' future':'')+'" data-m="'+m+'" data-l="'+lvl+'"'+(future?' disabled':'')
      +' aria-label="'+cap(MONTHS[m])+' de '+y+': '+fmtHM(t)+', '+LEVELS[lvl]+'"><span class="tm">'+MSHORT[m]+'</span><span class="tv">'+(fmtC(t)||'–')+'</span></button>';
  }
  $('monthTiles').innerHTML=h;
  $('yearTitle').textContent='Ano '+y;
  $('yearTotal').textContent=fmtHM(total);
}

function renderFoot(){
  $('foot').textContent=st.mode==='remote'
    ?(st.syncErr?'Sem conexão com a nuvem agora. Os dados continuam salvos neste aparelho.':'Dados salvos e sincronizados com sua conta.')
    :'Dados salvos neste aparelho. Entre na sua conta para sincronizar entre dispositivos.';
}
function renderDerived(){
  st.useDemo=showDemo();
  st.live=liveSpans(Date.now());
  st.todayKey=dayKey(new Date());
  renderHeader();renderBanner();renderScores();renderCalendar();renderLegend();renderDetail();renderYear();
}
function renderAll(){renderTimer();renderDerived();renderFoot();}

/* ---------- settings panel ---------- */
function buildSettings(){
  let h='<thead><tr><th scope="col"><span class="sr">Cor</span></th>';
  for(const sc of SCALES)h+='<th scope="col">'+SCALE_LABEL[sc]+' (h)</th>';
  h+='</tr></thead><tbody>';
  for(let i=0;i<5;i++){
    h+='<tr><th scope="row"><span class="sw" style="background:var(--h'+(i+1)+')"></span>'+LEVELS[i+1]+'</th>';
    for(const sc of SCALES){
      h+='<td><input id="thr-'+sc+'-'+i+'" data-sc="'+sc+'" type="number" inputmode="decimal" min="0" step="'+(sc==='day'?'0.25':'0.5')+'" aria-label="'+SCALE_LABEL[sc]+': '+LEVELS[i+1]+' a partir de (horas)"></td>';
    }
    h+='</tr>';
  }
  $('thrTable').innerHTML=h+'</tbody>';
  fillSettings();
}
function fillSettings(){
  for(const sc of SCALES){
    for(let i=0;i<5;i++){
      const el=$('thr-'+sc+'-'+i);
      if(el&&document.activeElement!==el)el.value=String(settings[sc][i]);
    }
  }
}
function applyScale(sc){
  const v=[];
  for(let i=0;i<5;i++)v.push(parseFloat(String($('thr-'+sc+'-'+i).value).replace(',','.')));
  const ok=validScale(v);
  for(let i=0;i<5;i++)$('thr-'+sc+'-'+i).setAttribute('aria-invalid',ok?'false':'true');
  if(!ok){
    $('thrMsg').textContent='Em '+SCALE_LABEL[sc]+', cada faixa precisa ser maior que a anterior. A alteração não foi salva.';
    return;
  }
  $('thrMsg').textContent='';
  settings[sc]=v;
  saveSettings();
  renderDerived();
}

/* ---------- events ---------- */
$('settingsTrigger').addEventListener('click',()=>{
  $('settingsBox').open=!$('settingsBox').open;
  $('settingsTrigger').setAttribute('aria-expanded',String($('settingsBox').open));
  if($('settingsBox').open)$('settingsBox').scrollIntoView({behavior:'smooth',block:'nearest'});
});
$('settingsBox').addEventListener('toggle',()=>$('settingsTrigger').setAttribute('aria-expanded',String($('settingsBox').open)));
$('exportBackup').addEventListener('click',()=>{
  const backup={format:'mapa-de-estudo-backup',version:1,exportedAt:new Date().toISOString(),days:days,settings:settings};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='mapa-de-estudo-backup-'+dayKey(new Date())+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('backupMsg').textContent='Backup exportado com seus lançamentos e faixas.';
});
$('importBackup').addEventListener('click',()=>$('backupFile').click());
$('backupFile').addEventListener('change',async e=>{
  const file=e.target.files&&e.target.files[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    const rawDays=data&&data.format==='mapa-de-estudo-backup'?data.days:data;
    if(!rawDays||typeof rawDays!=='object'||Array.isArray(rawDays))throw new Error('invalid');
    const imported=sanitizeDays(rawDays);
    if(!Object.keys(imported).length)throw new Error('empty');
    if(!confirm('Importar '+Object.values(imported).reduce((n,d)=>n+d.sessions.length,0)+' lançamentos? Os lançamentos atuais serão substituídos.'))return;
    days=imported;
    if(data.format==='mapa-de-estudo-backup'&&data.settings){settings=sanitizeSettings(data.settings)||clone(DEFAULTS);lsSet(LS.settings,settings);fillSettings();}
    lsSet(LS.days,days);
    touchLocal();scheduleCloudSave();
    st.demoOff=true;lsSet(LS.demoOff,true);st.sel=dayKey(new Date());
    renderAll();$('backupMsg').textContent='Backup importado. Os lançamentos atuais foram substituídos.';
  }catch(err){$('backupMsg').textContent='Não foi possível importar. Escolha um backup JSON válido do Mapa de Estudo.';}
  finally{e.target.value='';}
});
$('btnMain').addEventListener('click',()=>{if(timer.status==='idle')startStudy();else toggleRest();});
$('btnFinish').addEventListener('click',finish);

function setView(y,m){
  st.view={y:y,m:m};
  const now=new Date();
  if(y===now.getFullYear()&&m===now.getMonth())st.sel=dayKey(now);
  else st.sel=dayKey(new Date(y,m,1));
  st.confirmDel=null;
  renderDerived();
}
$('prevM').addEventListener('click',()=>{const m=st.view.m-1;if(m<0)setView(st.view.y-1,11);else setView(st.view.y,m);});
$('nextM').addEventListener('click',()=>{const m=st.view.m+1;if(m>11)setView(st.view.y+1,0);else setView(st.view.y,m);});
$('todayBtn').addEventListener('click',()=>{const n=new Date();setView(n.getFullYear(),n.getMonth());});
$('calGrid').addEventListener('click',e=>{
  const b=e.target.closest('button[data-key]');
  if(!b||b.disabled)return;
  st.sel=b.dataset.key;st.confirmDel=null;
  renderCalendar();renderDetail();
});
$('monthTiles').addEventListener('click',e=>{
  const b=e.target.closest('button[data-m]');
  if(!b||b.disabled)return;
  setView(st.view.y,+b.dataset.m);
});
let delT;
$('dayDetail').addEventListener('click',e=>{
  const b=e.target.closest('[data-del]');
  if(!b)return;
  const id=Number(b.dataset.del);
  if(st.confirmDel===id){
    st.confirmDel=null;
    removeSession(st.sel,id);
  }else{
    st.confirmDel=id;
    renderDetail();
    clearTimeout(delT);
    delT=setTimeout(()=>{st.confirmDel=null;renderDetail();},4000);
  }
});
$('hideDemo').addEventListener('click',()=>{st.demoOff=true;lsSet(LS.demoOff,true);renderDerived();});
$('thrTable').addEventListener('change',e=>{const sc=e.target&&e.target.dataset?e.target.dataset.sc:null;if(sc)applyScale(sc);});
$('thrReset').addEventListener('click',()=>{
  settings=clone(DEFAULTS);
  for(const sc of SCALES)for(let i=0;i<5;i++)$('thr-'+sc+'-'+i).setAttribute('aria-invalid','false');
  $('thrMsg').textContent='';
  fillSettings();saveSettings();renderDerived();
});
$('addForm').addEventListener('submit',e=>{
  e.preventDefault();
  const num=id=>Math.max(0,Math.floor(Number($(id).value)||0));
  const study=num('addH')*3600+num('addM')*60;
  const rest=num('addR')*60;
  const msg=$('addMsg');
  if(study+rest===0){msg.textContent='Informe o tempo de estudo ou de descanso.';return;}
  if(study>86400||rest>86400){msg.textContent='O tempo de um dia não pode passar de 24 horas.';return;}
  const k=st.sel;
  const at=parseKey(k).getTime()+12*3600000;
  (days[k]||(days[k]={sessions:[]})).sessions.push({id:Date.now(),at:at,study:study,rest:rest,manual:true});
  saveDay(k);
  ['addH','addM','addR'].forEach(id=>{$(id).value='';});
  msg.textContent='';
  const d=parseKey(k);
  toast('Tempo adicionado a '+pad(d.getDate())+'/'+pad(d.getMonth()+1)+'.');
  renderDerived();
});

/* ---------- clock tick ---------- */
let lastMin=-1;
function tick(){
  const now=Date.now();
  updateClocks();
  const tk=dayKey(new Date(now));
  const min=Math.floor(now/60000);
  if(tk!==st.todayKey){
    if(st.sel===st.todayKey)st.sel=tk;
    lastMin=min;
    renderDerived();
    return;
  }
  if(timer.cur&&min!==lastMin){lastMin=min;renderDerived();}
}
setInterval(tick,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});

/* ---------- account and cloud actions ---------- */
$('authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!supabase){setAuthMessage('Serviço de nuvem indisponível. Confira sua conexão.',true);return;}
  const email=$('authEmail').value.trim(),password=$('authPassword').value;
  if(!email||!password){setAuthMessage('Informe e-mail e senha.',true);return;}
  $('authSubmit').disabled=true;setAuthMessage('Aguarde…',false);
  try{
    const response=authMode==='signup'
      ?await supabase.auth.signUp({email,password,options:{emailRedirectTo:'https://paulinrik.github.io/estudo/'}})
      :await supabase.auth.signInWithPassword({email,password});
    if(response.error)throw response.error;
    if(authMode==='signup'&&response.data&&!response.data.session)
      setAuthMessage('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.',false);
    else if(response.data&&response.data.session)await handleCloudSession(response.data.session);
    else setAuthMessage('Confira seu e-mail para continuar.',false);
  }catch(err){setAuthMessage(err.message||'Não foi possível entrar. Confira os dados e tente novamente.',true);}
  finally{$('authSubmit').disabled=false;}
});
$('authModeToggle').addEventListener('click',()=>{
  authMode=authMode==='signin'?'signup':'signin';renderAuth();
  setAuthMessage(authMode==='signup'?'Crie sua conta com o mesmo e-mail e senha do Livro Caixa.':'Entre com a mesma conta do Livro Caixa.',false);
});
$('authSignOut').addEventListener('click',async()=>{
  if(!supabase)return;
  $('authSignOut').disabled=true;const {error}=await supabase.auth.signOut();$('authSignOut').disabled=false;
  if(error)setAuthMessage('Não foi possível sair da conta: '+error.message,true);
});/* ---------- start ---------- */
buildSettings();
renderAuth();
renderAll();
initializeCloud();})();


