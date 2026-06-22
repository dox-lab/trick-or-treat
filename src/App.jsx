import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, off, update, push } from "firebase/database";

// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCV9vwFJeHfQNPimaNVsqbApokGq_VlPU0",
  authDomain: "trick-or-treat-mci8104.firebaseapp.com",
  databaseURL: "https://trick-or-treat-mci8104-default-rtdb.firebaseio.com",
  projectId: "trick-or-treat-mci8104",
  storageBucket: "trick-or-treat-mci8104.firebasestorage.app",
  messagingSenderId: "958919283232",
  appId: "1:958919283232:web:82b5cc3061d8126c212245",
  measurementId: "G-KLMXHKWWL0"
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ─── CONSTANTES ──────────────────────────────────────────────────────────────
const AVATARS = ["🦇","🐺","🕷️","🦉","🐈‍⬛","💀","🐸","🦊","🐙","🐝"];
const COLORS  = ["#f97316","#22c55e","#a855f7","#3b82f6","#ef4444","#eab308","#06b6d4","#ec4899","#14b8a6","#f59e0b"];
const NICKNAMES = ["StatsWitch","DataGhost","BayesBat","ProbWolf","SigmaSpider","MeanOwl","VarCat","ModeFrog","ChiFox","HypoKraken","TestBee","NormZombie","PoissonPumpkin","RegressWitch","SampleCrow","ErrorDemon"];
const BOT_NAMES = ["Lucía","Mateo","Valeria","Sebastián","Camila","Diego","Renata","Andrés","Daniela","Tomás","Sofía","Nicolás","Mariana","Emilio","Paula","Santiago"];

function pickBotIdentity(index) {
  const name   = BOT_NAMES[index % BOT_NAMES.length];
  const avatar = AVATARS[(index * 3 + 7) % AVATARS.length];
  const color  = COLORS[(index * 3 + 2) % COLORS.length];
  return { nickname:name, avatar, color };
}

const BOT_STRATEGIES = [
  { id:"always_bet",   label:"Siempre apostar",      emoji:"💰", desc:"Apuesta en cada ronda sin importar nada" },
  { id:"always_fold",  label:"Siempre retirarse",     emoji:"🏳️", desc:"Se retira en la primera oportunidad" },
  { id:"ev_threshold", label:"Racional P>45%",        emoji:"🧮", desc:"Apuesta si su prob. de ganar supera 45%" },
  { id:"random",       label:"Aleatorio 50/50",       emoji:"🎲", desc:"Decide al azar en cada ronda" },
  { id:"aggressive",   label:"Agresivo P>30%",        emoji:"🔥", desc:"Apuesta con prob. de ganar >30%" },
  { id:"conservative", label:"Conservador P>58%",     emoji:"🛡️", desc:"Solo apuesta con ventaja clara (>58%)" },
];

// ─── UTILS ───────────────────────────────────────────────────────────────────
const roll    = () => Math.floor(Math.random() * 6) + 1;
const genCode = () => Math.random().toString(36).substring(2,7).toUpperCase();
const genUID  = () => "u_" + Math.random().toString(36).substring(2,10);
const sleep   = (ms) => new Promise(r => setTimeout(r, ms));

// ─── SONIDOS (Web Audio API) ─────────────────────────────────────────────────
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}
function playTone(freq, dur, delay=0, type="sine", vol=0.25) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type  = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime+delay);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+delay+dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(ctx.currentTime+delay);
    osc.stop(ctx.currentTime+delay+dur);
  } catch(_){}
}
function soundNewMatch() {
  playTone(523,0.12,0);      // C5
  playTone(659,0.12,0.10);   // E5
  playTone(784,0.20,0.20);   // G5
}
function soundWin() {
  playTone(523,0.10,0);       // C5
  playTone(659,0.10,0.09);    // E5
  playTone(784,0.10,0.18);    // G5
  playTone(1047,0.30,0.27);   // C6
}
function soundLose() {
  playTone(392,0.18,0,"triangle",0.20);    // G4
  playTone(330,0.22,0.15,"triangle",0.18); // E4
  playTone(262,0.35,0.32,"triangle",0.12); // C4
}

/**
 * MECÁNICA CENTRAL: top3score
 * Dado los 2 dados privados y los dados públicos visibles,
 * toma los 3 con mayor valor individual y devuelve su suma.
 * También verifica si entre esos 3 hay al menos 3 unos (victoria automática).
 */
function top3score(privados, publicosVisibles) {
  const pool = [...privados, ...publicosVisibles];
  const sorted = [...pool].sort((a,b) => b-a); // descendente
  const best3  = sorted.slice(0, 3);
  const score  = best3.reduce((a,b) => a+b, 0);
  const tresumos = best3.filter(v => v===1).length >= 3;
  return { score, best3, tresumos };
}

function calcEV(privados, publicosVisibles) {
  const { score } = top3score(privados, publicosVisibles);
  return score / 18;
}

function estimateWinProb(myPrivate, publicVisible, samples=600, knownRivalDice=[]) {
  const pubRemaining = 2 - publicVisible.length;
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const pub = [...publicVisible];
    for (let j = 0; j < pubRemaining; j++) pub.push(roll());
    const my  = top3score(myPrivate, pub).score;
    const rd  = [...knownRivalDice];
    while (rd.length < 2) rd.push(roll());
    const opp = top3score(rd, pub).score;
    if (my > opp) wins++;
  }
  return wins / samples;
}

function estimateProbs(myPrivate, publicVisible, knownRivalDice=[], samples=500) {
  const pubRemaining = 2 - publicVisible.length;
  const hasCheat = knownRivalDice.length > 0;
  let myW=0, rivW=0, myWC=0, rivWC=0;
  for (let i = 0; i < samples; i++) {
    const pub = [...publicVisible];
    for (let j = 0; j < pubRemaining; j++) pub.push(roll());
    const my = top3score(myPrivate, pub).score;
    const rd1 = [roll(), roll()];
    const o1  = top3score(rd1, pub).score;
    if (my > o1) myW++; else if (o1 > my) rivW++;
    if (hasCheat) {
      const rd2 = [...knownRivalDice]; while(rd2.length<2) rd2.push(roll());
      const o2  = top3score(rd2, pub).score;
      if (my > o2) myWC++; else if (o2 > my) rivWC++;
    }
  }
  return {
    me:myW/samples, rival:rivW/samples,
    meCheat:hasCheat?myWC/samples:null, rivalCheat:hasCheat?rivWC/samples:null,
  };
}

function botDecision(strategy, privados, publicosVisibles) {
  switch(strategy) {
    case "always_bet":   return "apostar";
    case "always_fold":  return "retirarse";
    case "random":       return Math.random() > 0.5 ? "apostar" : "retirarse";
    default: break;
  }
  const wp = estimateWinProb(privados, publicosVisibles);
  switch(strategy) {
    case "ev_threshold": return wp >= 0.45 ? "apostar" : "retirarse";
    case "aggressive":   return wp >= 0.30 ? "apostar" : "retirarse";
    case "conservative": return wp >= 0.58 ? "apostar" : "retirarse";
    default:             return "apostar";
  }
}

// Round-robin sin repetir rival
function buildSchedule(playerIds, totalPartidas) {
  const schedule = {};
  playerIds.forEach(p => { schedule[p] = []; });
  const ids = [...playerIds];
  if (ids.length % 2 !== 0) ids.push("BYE");
  const half = ids.length / 2;
  const rounds = [];
  for (let r = 0; r < ids.length - 1; r++) {
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const a = ids[i], b = ids[ids.length - 1 - i];
      if (a !== "BYE" && b !== "BYE") pairs.push([a, b]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop());
  }
  for (let p = 0; p < totalPartidas; p++) {
    const round = rounds[p % rounds.length];
    round.forEach(([a, b]) => {
      if (schedule[a] && schedule[b]) { schedule[a].push(b); schedule[b].push(a); }
    });
  }
  return schedule;
}

function buildFaseSchedule(playerIds, totalPartidas, cfg) {
  const fases = {};
  playerIds.forEach(pid => {
    const pool = [
      ...Array(cfg.control      ||0).fill("control"),
      ...Array(cfg.yo_trampo    ||0).fill("yo_trampo"),
      ...Array(cfg.rival_trampa ||0).fill("rival_trampa"),
      ...Array(cfg.ambos        ||0).fill("ambos"),
    ];
    for (let i = pool.length-1; i>0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [pool[i],pool[j]] = [pool[j],pool[i]];
    }
    fases[pid] = pool.slice(0, totalPartidas);
  });
  return fases;
}

// ─── DADO SVG ────────────────────────────────────────────────────────────────
const DOTS = {
  1:[[50,50]], 2:[[28,28],[72,72]], 3:[[28,28],[50,50],[72,72]],
  4:[[28,28],[72,28],[28,72],[72,72]], 5:[[28,28],[72,28],[50,50],[28,72],[72,72]],
  6:[[28,22],[72,22],[28,50],[72,50],[28,78],[72,78]],
};

function Die({ value, hidden=false, size=60, color="#f97316", shake=false, glow=false, selected=false }) {
  return (
    <div style={{position:"relative",display:"inline-block"}}>
      <svg width={size} height={size} viewBox="0 0 100 100" style={{
        borderRadius:14, background:hidden?"#1a1a2a":"#0f0f1a",
        border:`2px solid ${selected?"#fff":(glow||!hidden)?color:"#2a2a3a"}`,
        boxShadow:selected?`0 0 20px #fff8`:(glow||!hidden)?`0 0 16px ${color}44`:"none",
        flexShrink:0, transition:"all 0.3s",
        animation:shake?"shakeDie 0.5s ease":"none",
        display:"block",
      }}>
        {hidden
          ? <text x="50" y="65" textAnchor="middle" fontSize="40" fill="#333">?</text>
          : (DOTS[value]||[]).map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r={9} fill={selected?"#fff":color}/>)
        }
      </svg>
      {selected && (
        <div style={{position:"absolute",top:-8,right:-8,background:"#22c55e",
          borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",
          justifyContent:"center",fontSize:10,fontWeight:900,color:"#000"}}>✓</div>
      )}
    </div>
  );
}

// ─── COMPONENTES UI ──────────────────────────────────────────────────────────
const GlobalCSS = () => (
  <style>{`
    @keyframes float    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
    @keyframes fadeIn   { from{opacity:0;transform:scale(0.93)} to{opacity:1;transform:scale(1)} }
    @keyframes shakeDie { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-12deg)} 75%{transform:rotate(12deg)} }
    @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.35} }
    @keyframes spin     { from{transform:rotate(0)} to{transform:rotate(360deg)} }
    @keyframes slideUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
    @keyframes popIn    { 0%{transform:scale(0.5);opacity:0} 80%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
    @keyframes timerPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
    @keyframes cheatGlow { 0%,100%{box-shadow:0 0 30px #eab30844,0 0 60px #eab30822} 50%{box-shadow:0 0 50px #eab30888,0 0 100px #eab30844} }
    @keyframes cheatIcon { 0%{transform:scale(0) rotate(-30deg);opacity:0} 50%{transform:scale(1.3) rotate(10deg);opacity:1} 100%{transform:scale(1) rotate(0deg);opacity:1} }
    * { box-sizing:border-box; }
  `}</style>
);

function Card({ children, style={}, accent="#f97316" }) {
  return <div style={{background:"#12121e",border:`1px solid ${accent}44`,borderRadius:16,
    padding:"16px 20px",boxShadow:`0 0 24px ${accent}0d`,...style}}>{children}</div>;
}

function Btn({ children, onClick, variant="primary", disabled=false, style={} }) {
  const V = {
    primary:{ bg:"#f97316",color:"#000" }, success:{ bg:"#22c55e",color:"#000" },
    danger: { bg:"#ef4444",color:"#fff" }, ghost:{ bg:"transparent",color:"#f97316",border:"1px solid #f97316" },
    purple: { bg:"#a855f7",color:"#fff" }, dark:{ bg:"#1e1e2e",color:"#aaa",border:"1px solid #2a2a3a" },
    warning:{ bg:"#eab308",color:"#000" },
  };
  const v = V[variant]||V.primary;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:disabled?"#1e1e2e":v.bg, color:disabled?"#444":v.color,
      border:disabled?"1px solid #2a2a3a":v.border||"none",
      borderRadius:10, padding:"10px 20px", fontWeight:700, fontSize:14,
      cursor:disabled?"not-allowed":"pointer", transition:"all 0.15s", fontFamily:"inherit",...style,
    }}>{children}</button>
  );
}

function EVBar({ value, label, color="#f97316" }) {
  const pct = Math.round(value*100);
  return (
    <div style={{marginBottom:6}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#666",marginBottom:3}}>
        <span>{label}</span><span style={{color}}>{pct}%</span>
      </div>
      <div style={{background:"#1e1e2e",borderRadius:6,height:7}}>
        <div style={{width:`${pct}%`,background:color,borderRadius:6,height:"100%",transition:"width 0.5s"}}/>
      </div>
    </div>
  );
}

function Badge({ children, color="#f97316" }) {
  return <span style={{display:"inline-block",padding:"3px 10px",borderRadius:20,
    background:`${color}22`,color,fontSize:12,fontWeight:700}}>{children}</span>;
}

function Overlay({ show, children }) {
  if (!show) return null;
  return (
    <div style={{position:"fixed",inset:0,background:"#0a0a0fee",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:200,backdropFilter:"blur(8px)",
      animation:"fadeIn 0.2s ease"}}>{children}</div>
  );
}

// Reloj circular animado
function TimerCircle({ seconds, total }) {
  if (!total || seconds === null) return null;
  const pct   = seconds / total;
  const r     = 28;
  const circ  = 2 * Math.PI * r;
  const dash  = circ * pct;
  const color = seconds <= 5 ? "#ef4444" : seconds <= 10 ? "#eab308" : "#22c55e";
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",margin:"6px 0"}}>
      <svg width={72} height={72} style={{animation:seconds<=5?"timerPulse 0.5s infinite":"none"}}>
        <circle cx={36} cy={36} r={r} fill="none" stroke="#1e1e2e" strokeWidth={5}/>
        <circle cx={36} cy={36} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ/4}
          strokeLinecap="round"
          style={{transition:"stroke-dasharray 1s linear, stroke 0.3s"}}/>
        <text x={36} y={42} textAnchor="middle" fontSize={18} fontWeight={900} fill={color}
          fontFamily="monospace">{seconds}</text>
      </svg>
    </div>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function HomeScreen({ onGestor, onJoin }) {
  const [code, setCode] = useState("");
  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"48px 20px"}}>
      <GlobalCSS/>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{fontSize:72,display:"inline-block",animation:"float 3s ease-in-out infinite"}}>🎃</div>
        <h1 style={{fontSize:34,fontWeight:900,color:"#f97316",margin:"8px 0 0",letterSpacing:-1}}>TRICK OR TREAT</h1>
        <p style={{color:"#555",marginTop:6,fontSize:13,letterSpacing:1}}>EXPERIMENTO · TEORÍA DE JUEGOS · UTEC</p>
      </div>
      <Card accent="#a855f7" style={{marginBottom:12}}>
        <p style={{color:"#777",margin:"0 0 12px",fontSize:13}}>¿Eres el investigador?</p>
        <Btn onClick={onGestor} variant="purple" style={{width:"100%"}}>🔬 Crear sala como Gestor</Btn>
      </Card>
      <Card accent="#f97316">
        <p style={{color:"#777",margin:"0 0 12px",fontSize:13}}>¿Eres jugador? Ingresa el código de sala:</p>
        <div style={{display:"flex",gap:8}}>
          <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="XXXXX" maxLength={5}
            style={{flex:1,background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
              padding:"11px 14px",color:"#f97316",fontFamily:"monospace",fontSize:22,
              letterSpacing:6,outline:"none",textAlign:"center"}}/>
          <Btn onClick={()=>onJoin(code)} disabled={code.length<4}>Entrar</Btn>
        </div>
      </Card>
      <Card accent="#2a2a3a" style={{marginTop:12}}>
        <div style={{fontSize:13,color:"#f97316",fontWeight:700,marginBottom:10}}>📖 ¿Cómo se juega?</div>
        {[
          ["🎲","Recibes 2 dados privados que solo tú ves."],
          ["🌐","Hay 2 dados públicos compartidos que se revelan uno por ronda."],
          ["🏆","Tu score es la suma de los 3 dados más altos entre tus privados y los públicos visibles."],
          ["💰","En cada ronda decides: apostar (+1 ficha al pozo) o retirarte y ceder el pozo al rival."],
          ["⚔️","Si ambos apuestan las 3 rondas, gana quien tenga mayor score. Empate = la casa gana."],
          ["👁️","En algunas partidas tendrás ventaja: podrás espiar un dado de tu rival."],
        ].map(([icon,text])=>(
          <div key={icon} style={{display:"flex",gap:8,marginBottom:6,alignItems:"flex-start"}}>
            <span style={{fontSize:14,flexShrink:0,marginTop:1}}>{icon}</span>
            <span style={{color:"#666",fontSize:12,lineHeight:1.5}}>{text}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── CREAR SALA ───────────────────────────────────────────────────────────────
function CreateRoomScreen({ onCreated }) {
  const [pw, setPw]       = useState("");
  const [total, setTotal] = useState(5);
  const [cfg, setCfg]     = useState({control:1,yo_trampo:2,rival_trampa:1,ambos:1});
  const [botCount, setBotCount]           = useState(0);
  const [botStrategies, setBotStrategies] = useState([]);
  const [loading, setLoading]         = useState(false);
  const suma = Object.values(cfg).reduce((a,b)=>a+b,0);
  const upd  = (k,v) => setCfg(c=>({...c,[k]:Math.max(0,v)}));

  const create = async () => {
    if (!pw || suma!==total) return;
    setLoading(true);
    const code = genCode();
    const botPlayers = {};
    for (let i=0; i<botCount; i++) {
      const bid = `bot_${i}`;
      const identity = pickBotIdentity(i);
      botPlayers[bid] = { uid:bid, ...identity, isBot:true, strategy:botStrategies[i]||"ev_threshold" };
    }
    await set(ref(db,`rooms/${code}`), {
      code, password:pw,
      config:{ totalPartidas:total, faseConfig:cfg, showEV:false, showRivalEV:false, timerSecs:0,
               open:false, botCount, botStrategies },
      status:{ phase:"lobby", partidaActual:0 },
      players:botPlayers, pairs:{}, faseSchedule:{}, balance:{}, logs:{},
      createdAt:Date.now(),
    });
    setLoading(false);
    onCreated(code);
  };

  return (
    <div style={{maxWidth:480,margin:"0 auto",padding:"32px 20px"}}>
      <GlobalCSS/>
      <h2 style={{color:"#a855f7",marginBottom:20}}>🔬 Nueva Sala Experimental</h2>

      <Card accent="#a855f7" style={{marginBottom:12}}>
        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>Contraseña del gestor</label>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Solo el gestor la sabe"
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
            padding:"10px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:20,boxSizing:"border-box",outline:"none"}}/>
        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>
          Total de partidas: <span style={{color:"#f97316"}}>{total}</span>
        </label>
        <input type="range" min={2} max={10} value={total}
          onChange={e=>{ const v=+e.target.value; setTotal(v);
            const q=Math.floor(v/4)||1; setCfg({control:q,yo_trampo:q,rival_trampa:q,ambos:v-3*q}); }}
          style={{width:"100%",marginBottom:20,accentColor:"#f97316"}}/>
        <div style={{fontSize:13,color:"#777",marginBottom:10}}>
          Fases <span style={{color:suma===total?"#22c55e":"#ef4444",fontWeight:700}}>({suma}/{total})</span>
        </div>
        {[
          {k:"control",      label:"🎯 Ninguno tramposo",   color:"#aaa"},
          {k:"yo_trampo",    label:"🃏 Yo tramposo",        color:"#eab308"},
          {k:"rival_trampa", label:"👁️ Rival tramposo",     color:"#ef4444"},
          {k:"ambos",        label:"⚔️ Ambos tramposos",    color:"#a855f7"},
        ].map(({k,label,color})=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <span style={{flex:1,fontSize:13,color}}>{label}</span>
            <button onClick={()=>upd(k,cfg[k]-1)} style={{background:"#1e1e2e",border:"1px solid #2a2a3a",
              borderRadius:6,color:"#aaa",width:28,height:28,cursor:"pointer",fontSize:16}}>−</button>
            <span style={{color:"#fff",fontWeight:700,minWidth:24,textAlign:"center"}}>{cfg[k]}</span>
            <button onClick={()=>upd(k,cfg[k]+1)} style={{background:"#1e1e2e",border:"1px solid #2a2a3a",
              borderRadius:6,color:"#aaa",width:28,height:28,cursor:"pointer",fontSize:16}}>+</button>
          </div>
        ))}
        {suma!==total&&<p style={{color:"#ef4444",fontSize:12,marginTop:4,textAlign:"center"}}>La suma debe ser {total}</p>}
      </Card>

      <BotConfig botCount={botCount} setBotCount={setBotCount}
        botStrategies={botStrategies} setBotStrategies={setBotStrategies}/>

      <Btn onClick={create} disabled={!pw||loading||suma!==total} variant="purple" style={{width:"100%",marginTop:12}}>
        {loading?"Creando...":"Crear sala 🎃"}
      </Btn>
    </div>
  );
}

// Componente reutilizable para configurar bots (usado en crear sala Y en gestor)
function BotConfig({ botCount, setBotCount, botStrategies, setBotStrategies }) {
  const handleCountChange = (n) => {
    setBotCount(n);
    setBotStrategies(prev => {
      const next = [...prev];
      while (next.length < n) next.push("ev_threshold");
      return next.slice(0, n);
    });
  };
  const setOne = (i, id) => setBotStrategies(prev => {
    const next = [...prev]; next[i] = id; return next;
  });
  return (
    <Card accent="#22c55e" style={{marginBottom:12}}>
      <div style={{fontSize:13,color:"#22c55e",fontWeight:700,marginBottom:12}}>🤖 Bots</div>
      <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>
        Número de bots: <span style={{color:"#22c55e"}}>{botCount}</span>
      </label>
      <input type="range" min={0} max={6} value={botCount} onChange={e=>handleCountChange(+e.target.value)}
        style={{width:"100%",marginBottom:12,accentColor:"#22c55e"}}/>
      {botCount>0 && (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {Array.from({length:botCount},(_,i)=>{
            const cur = botStrategies[i]||"ev_threshold";
            const info = BOT_STRATEGIES.find(s=>s.id===cur)||BOT_STRATEGIES[0];
            const id = pickBotIdentity(i);
            return (
              <div key={i} style={{background:"#1a1a2a",borderRadius:10,padding:"10px 12px",
                border:"1px solid #22c55e33"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontSize:16}}>{id.avatar}</span>
                  <span style={{color:id.color,fontWeight:700,fontSize:13}}>{id.nickname}</span>
                  <span style={{color:"#555",fontSize:11,marginLeft:"auto"}}>{info.emoji} {info.label}</span>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {BOT_STRATEGIES.map(s=>(
                    <button key={s.id} onClick={()=>setOne(i,s.id)} title={s.desc} style={{
                      background:cur===s.id?"#22c55e22":"#12121e",
                      border:`1px solid ${cur===s.id?"#22c55e":"#2a2a3a"}`,
                      borderRadius:8,padding:"5px 10px",cursor:"pointer",
                      display:"flex",alignItems:"center",gap:5,
                    }}>
                      <span style={{fontSize:14}}>{s.emoji}</span>
                      <span style={{color:cur===s.id?"#22c55e":"#666",fontWeight:700,fontSize:11}}>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─── PERFIL JUGADOR ───────────────────────────────────────────────────────────
function ProfileScreen({ roomCode, onJoined }) {
  const [nickname, setNickname] = useState(()=>NICKNAMES[Math.floor(Math.random()*NICKNAMES.length)]);
  const [avatar,   setAvatar]   = useState(()=>AVATARS[Math.floor(Math.random()*AVATARS.length)]);
  const [color,    setColor]    = useState(()=>COLORS[Math.floor(Math.random()*COLORS.length)]);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const join = async () => {
    if (!nickname.trim()) return;
    setLoading(true);
    const snap = await get(ref(db,`rooms/${roomCode}`));
    if (!snap.exists()) { setError("Sala no encontrada"); setLoading(false); return; }
    if (!snap.val().config?.open) { setError("La sala aún no está abierta."); setLoading(false); return; }
    const uid = genUID();
    const profile = { uid, nickname:nickname.trim(), avatar, color, isBot:false, joinedAt:Date.now() };
    await set(ref(db,`rooms/${roomCode}/players/${uid}`), profile);
    sessionStorage.setItem(`tot_uid_${roomCode}`, uid);
    setLoading(false);
    onJoined(uid, profile);
  };

  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"32px 20px"}}>
      <GlobalCSS/>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>SALA</div>
        <div style={{fontSize:26,fontWeight:900,color:"#f97316",fontFamily:"monospace",letterSpacing:4}}>{roomCode}</div>
      </div>
      <Card>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:80,filter:`drop-shadow(0 0 18px ${color})`,lineHeight:1}}>{avatar}</div>
          <div style={{fontWeight:700,color,fontSize:20,marginTop:8}}>{nickname||"Tu nombre aquí"}</div>
        </div>
        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>Nickname</label>
        <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Ej: StatsWitch" maxLength={16}
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
            padding:"10px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:16,boxSizing:"border-box",outline:"none"}}/>
        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:8}}>Avatar</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
          {AVATARS.map(a=>(
            <button key={a} onClick={()=>setAvatar(a)} style={{fontSize:26,
              background:avatar===a?"#1e1e2e":"transparent",
              border:`2px solid ${avatar===a?color:"#2a2a3a"}`,
              borderRadius:10,padding:5,cursor:"pointer"}}>{a}</button>
          ))}
        </div>
        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:8}}>Color</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
          {COLORS.map(c=>(
            <button key={c} onClick={()=>setColor(c)} style={{width:30,height:30,background:c,borderRadius:"50%",
              border:`3px solid ${color===c?"#fff":"transparent"}`,cursor:"pointer"}}/>
          ))}
        </div>
        {error&&<p style={{color:"#ef4444",fontSize:13,marginBottom:12}}>{error}</p>}
        <Btn onClick={join} disabled={!nickname.trim()||loading} style={{width:"100%"}}>
          {loading?"Entrando...":"Entrar al juego 🎃"}
        </Btn>
      </Card>
    </div>
  );
}

// ─── PERFIL GESTOR ────────────────────────────────────────────────────────────
function GestorProfileScreen({ roomCode, onJoined }) {
  const [gNick, setGNick] = useState("El Ojo");
  const [gCol,  setGCol]  = useState("#a855f7");
  const [gLoad, setGLoad] = useState(false);

  const joinGestor = async () => {
    if (!gNick.trim()) return;
    setGLoad(true);
    const prof = { uid:"gestor", nickname:gNick.trim(), avatar:"🔺", color:gCol, role:"gestor", isBot:false };
    await set(ref(db,`rooms/${roomCode}/players/gestor`), prof);
    setGLoad(false);
    onJoined(prof);
  };

  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"32px 20px"}}>
      <GlobalCSS/>
      <div style={{textAlign:"center",marginBottom:16}}>
        <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>SALA</div>
        <div style={{fontSize:26,fontWeight:900,color:"#a855f7",fontFamily:"monospace",letterSpacing:4}}>{roomCode}</div>
      </div>
      <Card accent="#a855f7">
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:64,filter:`drop-shadow(0 0 14px ${gCol})`}}>🔺</div>
          <div style={{color:gCol,fontWeight:700,fontSize:18,marginTop:4}}>{gNick||"El Ojo"}</div>
        </div>
        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>Tu nombre</label>
        <input value={gNick} onChange={e=>setGNick(e.target.value)} placeholder="El Ojo"
          onKeyDown={e=>e.key==="Enter"&&joinGestor()}
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
            padding:"10px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:16,boxSizing:"border-box",outline:"none"}}/>
        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:8}}>Color</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
          {COLORS.map(c=>(
            <button key={c} onClick={()=>setGCol(c)} style={{width:28,height:28,background:c,
              borderRadius:"50%",border:`3px solid ${gCol===c?"#fff":"transparent"}`,cursor:"pointer"}}/>
          ))}
        </div>
        <Btn onClick={joinGestor} disabled={!gNick.trim()||gLoad} variant="purple" style={{width:"100%"}}>
          {gLoad?"Entrando...":"Entrar como Gestor 🔬"}
        </Btn>
      </Card>
    </div>
  );
}

// ─── MOTOR DEL JUEGO ─────────────────────────────────────────────────────────
/**
 * Evalúa el resultado final de un par.
 * Reglas:
 *  1. Ambos se retiran → casa gana (ganador="casa", motivo="Ambos retirados")
 *  2. Uno se retira → el otro gana
 *  3. Empate en top3 → casa gana (ganador="casa", motivo="Empate")
 *  4. Mayor top3 gana
 *  5. 3-unos en top3 → victoria automática (solo si el rival no también tiene)
 */
async function resolveRondaDB(roomCode, room, n, pairKey, pd, ronda, pidA, decA, pidB, decB) {
  const ambosFold = decA==="retirarse" && decB==="retirarse";
  const aFold     = decA==="retirarse";
  const bFold     = decB==="retirarse";

  if (ambosFold) {
    await finalizarPartidaDB(roomCode, room, n, pairKey, pd, "casa", "Ambos retirados");
    return;
  }
  if (aFold) { await finalizarPartidaDB(roomCode, room, n, pairKey, pd, pidB, "Retirada"); return; }
  if (bFold) { await finalizarPartidaDB(roomCode, room, n, pairKey, pd, pidA, "Retirada"); return; }

  // Ambos apostaron
  const newPot = (pd.pot||2) + 2;
  const balA   = room.balance?.[pidA]??10;
  const balB   = room.balance?.[pidB]??10;
  const upds   = { [`balance/${pidA}`]:balA-1, [`balance/${pidB}`]:balB-1 };

  if (ronda >= 3) {
    // Evaluación final con top3
    const pub = pd.publicos||[];
    const dA  = pd.dados?.[pidA]||[];
    const dB  = pd.dados?.[pidB]||[];
    const resA = top3score(dA, pub);
    const resB = top3score(dB, pub);

    let ganador;
    if (resA.tresumos && !resB.tresumos) ganador = pidA;
    else if (resB.tresumos && !resA.tresumos) ganador = pidB;
    else if (resA.score > resB.score)  ganador = pidA;
    else if (resB.score > resA.score)  ganador = pidB;
    else ganador = "casa"; // empate → casa

    upds[`partidas/${n}/${pairKey}/pot`]          = newPot;
    upds[`partidas/${n}/${pairKey}/ronda`]         = 4;
    upds[`partidas/${n}/${pairKey}/scoreA`]        = resA.score;
    upds[`partidas/${n}/${pairKey}/scoreB`]        = resB.score;
    upds[`partidas/${n}/${pairKey}/best3A`]        = resA.best3;
    upds[`partidas/${n}/${pairKey}/best3B`]        = resB.best3;
    await update(ref(db,`rooms/${roomCode}`), upds);
    const motivo = resA.tresumos||resB.tresumos ? "Tres unos" :
                   ganador==="casa"              ? "Empate"    : "Mayor suma";
    await finalizarPartidaDB(roomCode, {...room, balance:{...room.balance,...{[pidA]:balA-1,[pidB]:balB-1}}},
      n, pairKey, {...pd, pot:newPot}, ganador, motivo);
  } else {
    upds[`partidas/${n}/${pairKey}/pot`]        = newPot;
    upds[`partidas/${n}/${pairKey}/ronda`]      = ronda+1;
    upds[`partidas/${n}/${pairKey}/startedAt`]  = Date.now();
    upds[`partidas/${n}/${pairKey}/decisiones`] = null;
    await update(ref(db,`rooms/${roomCode}`), upds);
  }
}

async function finalizarPartidaDB(roomCode, room, n, pairKey, pd, ganador, motivo) {
  const [p1,p2] = pd.jugadores||[];
  const pot      = pd.pot||2;
  let b1=room.balance?.[p1]??10, b2=room.balance?.[p2]??10;
  let res;

  if (ganador==="casa") {
    // Casa se lleva todo: ningún jugador gana fichas extra, el pot desaparece
    res = motivo==="Empate" ? "🏠 Empate — La casa gana el pozo" :
          motivo==="Ambos retirados" ? "🏠 Ambos se retiraron — La casa gana" :
          `🏠 Casa gana (${motivo})`;
  } else {
    if (ganador===p1) b1+=pot; else b2+=pot;
    const nick = room.players?.[ganador]?.nickname||ganador;
    res = `Ganó ${nick} (${motivo})`;
  }

  await update(ref(db,`rooms/${roomCode}`), {
    [`balance/${p1}`]:b1, [`balance/${p2}`]:b2,
    [`partidas/${n}/${pairKey}/resultado`]:res,
    [`partidas/${n}/${pairKey}/ganador`]:ganador,
    [`partidas/${n}/${pairKey}/ronda`]:4,
  });

  const logRef = push(ref(db,`rooms/${roomCode}/logs`));
  await set(logRef,{
    partida:n, pairKey, jugador:ganador, rival:"",
    nickname_jugador:ganador==="casa"?"casa":room.players?.[ganador]?.nickname||"",
    nickname_rival:"",
    accion:"resultado", ronda:4, ev:0, tiempo_ms:0,
    fase:pd.fases?.[ganador]||"control",
    scoreA:pd.scoreA||0, scoreB:pd.scoreB||0,
    resultado:res, ts:Date.now(),
  });
}

// ─── GESTOR SCREEN ────────────────────────────────────────────────────────────
function GestorScreen({ roomCode }) {
  const [room,       setRoom]      = useState(null);
  const [tab,        setTab]       = useState("control");
  const [cfgLocal,   setCfgLocal]  = useState(null);
  const [botCountL,  setBotCountL]  = useState(0);
  const [botStratsL, setBotStratsL] = useState([]);

  useEffect(()=>{
    const r = ref(db,`rooms/${roomCode}`);
    onValue(r, snap=>{ if(snap.exists()){ const d=snap.val(); setRoom(d);
      if(!cfgLocal){
        setCfgLocal(d.config); setBotCountL(d.config?.botCount||0);
        const bc = d.config?.botCount||0;
        setBotStratsL(d.config?.botStrategies || Array(bc).fill(d.config?.botStrategy||"ev_threshold"));
      }
    }});
    return ()=>off(r);
  },[roomCode]);

  // Auto-avance cuando todos los pares terminan
  useEffect(()=>{
    if (!room) return;
    const { status, partidas, config } = room;
    if (status?.phase!=="playing") return;
    const n = status?.partidaActual||0;
    const pairs = Object.values(partidas?.[n]||{});
    if (!pairs.length||!pairs.every(p=>p.resultado)) return;

    const timer = setTimeout(async ()=>{
      const snap = await get(ref(db,`rooms/${roomCode}`));
      const r = snap.val();
      const next = (r.status?.partidaActual||1)+1;
      if (next > r.config.totalPartidas) {
        await update(ref(db,`rooms/${roomCode}/status`),{phase:"finished"});
      } else {
        const players = Object.keys(r.players||{}).filter(k=>k!=="gestor");
        await launchPartida(next, players, r.pairs, r.faseSchedule, r.config.totalPartidas, r);
      }
    }, 3000);
    return ()=>clearTimeout(timer);
  },[room?.partidas, room?.status?.partidaActual]);

  // Detectar bots con decisiones pendientes (cubre jugadores convertidos a bot mid-partida)
  const botHandledRef = useRef(new Set());
  useEffect(()=>{
    if (!room||room.status?.phase!=="playing") return;
    const n = room.status?.partidaActual||0;
    const pData = room.partidas?.[n];
    if (!pData) return;
    Object.entries(pData).forEach(([pairKey,pd])=>{
      if (pd.resultado) return;
      const ronda = pd.ronda||1;
      if (ronda>3) return;
      const [pidA,pidB] = pd.jugadores||[];
      [pidA,pidB].forEach(pid=>{
        if (!room.players?.[pid]?.isBot) return;
        const decKey = `${ronda}_${pid}`;
        if (pd.decisiones?.[decKey]) return;
        const hk = `${n}_${pairKey}_${ronda}_${pid}`;
        if (botHandledRef.current.has(hk)) return;
        botHandledRef.current.add(hk);
        (async ()=>{
          const strategy = room.players[pid].strategy||"ev_threshold";
          const myDice   = pd.dados?.[pid]||[];
          const pub      = (pd.publicos||[]).slice(0,ronda-1);
          const decision = botDecision(strategy, myDice, pub);
          const delay    = 800+Math.random()*1400;
          await sleep(delay);
          const snap = await get(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}`));
          if (!snap.exists()||snap.val().resultado) return;
          if (snap.val().decisiones?.[decKey]) return;
          await update(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}/decisiones`),{[decKey]:decision});
          const rival  = pid===pidA?pidB:pidA;
          const ev     = calcEV(myDice,pub);
          const logRef = push(ref(db,`rooms/${roomCode}/logs`));
          await set(logRef,{
            partida:n,pairKey,jugador:pid,rival,
            nickname_jugador:room.players?.[pid]?.nickname||pid,
            nickname_rival:room.players?.[rival]?.nickname||rival,
            accion:decision,ronda,ev,tiempo_ms:Math.floor(delay),
            fase:pd.fases?.[pid]||"control",
            suma_propia:myDice.reduce((a,b)=>a+b,0),
            suma_publica:pub.reduce((a,b)=>a+b,0),
            resultado:null,ts:Date.now(),
          });
          const snap2 = await get(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}`));
          if (!snap2.exists()||snap2.val().resultado) return;
          const pd2 = snap2.val();
          const rivalDec = pd2.decisiones?.[`${ronda}_${rival}`];
          if (rivalDec) {
            const rSnap = await get(ref(db,`rooms/${roomCode}`));
            await resolveRondaDB(roomCode,rSnap.val(),n,pairKey,pd2,ronda,
              pidA, pd2.decisiones?.[`${ronda}_${pidA}`],
              pidB, pd2.decisiones?.[`${ronda}_${pidB}`]);
          }
        })();
      });
    });
  },[room?.partidas, room?.players]);

  // Resolver rondas donde ambos jugadores ya decidieron pero nadie resolvió
  const resolveWatchRef = useRef(new Set());
  useEffect(()=>{
    if (!room||room.status?.phase!=="playing") return;
    const n = room.status?.partidaActual||0;
    const pData = room.partidas?.[n];
    if (!pData) return;
    Object.entries(pData).forEach(([pairKey,pd])=>{
      if (pd.resultado) return;
      const ronda = pd.ronda||1;
      if (ronda>3) return;
      const [pidA,pidB] = pd.jugadores||[];
      const decA = pd.decisiones?.[`${ronda}_${pidA}`];
      const decB = pd.decisiones?.[`${ronda}_${pidB}`];
      if (!decA||!decB) return;
      const rk = `${n}_${pairKey}_${ronda}`;
      if (resolveWatchRef.current.has(rk)) return;
      resolveWatchRef.current.add(rk);
      (async ()=>{
        await sleep(500);
        const snap = await get(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}`));
        if (!snap.exists()) return;
        const fresh = snap.val();
        if (fresh.resultado||(fresh.ronda||1)!==ronda) return;
        const rSnap = await get(ref(db,`rooms/${roomCode}`));
        await resolveRondaDB(roomCode,rSnap.val(),n,pairKey,fresh,ronda,pidA,decA,pidB,decB);
      })();
    });
  },[room]);

  const openRoom  = ()=>update(ref(db,`rooms/${roomCode}/config`),{open:true});
  const closeRoom = ()=>update(ref(db,`rooms/${roomCode}/config`),{open:false});

  // Parar todo → volver al lobby
  const stopAll = async () => {
    await update(ref(db,`rooms/${roomCode}/status`),{phase:"lobby",partidaActual:0});
  };

  const launchPartida = async (numPartida, players, schedule, faseSchedule, totalPartidas, r) => {
    const idx = numPartida-1;
    const done = new Set();
    const partidaData = {};
    players.forEach(pid=>{
      if (done.has(pid)) return;
      const rival = (schedule[pid]||[])[idx];
      if (!rival||done.has(rival)) return;
      done.add(pid); done.add(rival);
      const pairKey = [pid,rival].sort().join("_");
      partidaData[pairKey] = {
        jugadores:[pid,rival],
        dados:{ [pid]:[roll(),roll()], [rival]:[roll(),roll()] },
        publicos:[roll(),roll()],
        fases:{
          [pid]:(faseSchedule[pid]||[])[idx]||"control",
          [rival]:(faseSchedule[rival]||[])[idx]||"control",
        },
        ronda:1, pot:2, decisiones:{}, resultado:null,
        scoreA:null, scoreB:null, best3A:null, best3B:null,
        startedAt:Date.now(),
      };
    });
    await update(ref(db,`rooms/${roomCode}/partidas/${numPartida}`), partidaData);
    await update(ref(db,`rooms/${roomCode}/status`),{partidaActual:numPartida, phase:"playing"});
    Object.entries(partidaData).forEach(([pairKey,pd])=>scheduleBotDecisions(numPartida,pairKey,pd,r));
  };

  const scheduleBotDecisions = async (n, pairKey, pd, r) => {
    const [pidA,pidB] = pd.jugadores||[];
    const isA = r?.players?.[pidA]?.isBot;
    const isB = r?.players?.[pidB]?.isBot;
    if (!isA && !isB) return;

    for (let ronda=1; ronda<=3; ronda++) {
      if (ronda>1) await waitForRonda(n, pairKey, ronda);
      const snap = await get(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}`));
      if (!snap.exists()||snap.val().resultado) return;
      const pdC = snap.val();
      const pub = (pdC.publicos||[]).slice(0,ronda-1);

      for (const [pid,isBot] of [[pidA,isA],[pidB,isB]]) {
        if (!isBot) continue;
        const strategy = r?.players?.[pid]?.strategy||"ev_threshold";
        const myDice   = pdC.dados?.[pid]||[];
        const decision = botDecision(strategy, myDice, pub);
        const delay    = 800+Math.random()*1400;
        await sleep(delay);

        const snap2 = await get(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}`));
        if (!snap2.exists()||snap2.val().resultado) return;

        const decKey = `${ronda}_${pid}`;
        await update(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}/decisiones`),{[decKey]:decision});

        const rival   = pid===pidA?pidB:pidA;
        const ev      = calcEV(myDice,pub);
        const logRef  = push(ref(db,`rooms/${roomCode}/logs`));
        await set(logRef,{
          partida:n,pairKey,jugador:pid,rival,
          nickname_jugador:r?.players?.[pid]?.nickname||pid,
          nickname_rival:r?.players?.[rival]?.nickname||rival,
          accion:decision,ronda,ev,tiempo_ms:Math.floor(delay),
          fase:pdC.fases?.[pid]||"control",
          suma_propia:myDice.reduce((a,b)=>a+b,0),
          suma_publica:pub.reduce((a,b)=>a+b,0),
          resultado:null,ts:Date.now(),
        });

        const snap3   = await get(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}`));
        if (!snap3.exists()||snap3.val().resultado) return;
        const pd3     = snap3.val();
        const rivalDec= pd3.decisiones?.[`${ronda}_${rival}`];
        if (rivalDec) {
          const rSnap = await get(ref(db,`rooms/${roomCode}`));
          await resolveRondaDB(roomCode,rSnap.val(),n,pairKey,pd3,ronda,
            pidA, pd3.decisiones?.[`${ronda}_${pidA}`],
            pidB, pd3.decisiones?.[`${ronda}_${pidB}`]);
          if (decision==="retirarse"||rivalDec==="retirarse") return;
        }
      }
    }
  };

  const waitForRonda = (n,pairKey,target) => new Promise(resolve=>{
    const r = ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}/ronda`);
    onValue(r, snap=>{ if((snap.val()||1)>=target){ off(r); resolve(); }});
  });

  const startExperiment = async () => {
    const players = Object.keys(room.players||{}).filter(k=>k!=="gestor");
    if (players.length<2){ alert("Necesitas al menos 2 jugadores"); return; }
    const tp           = room.config.totalPartidas;
    const schedule     = buildSchedule(players,tp);
    const faseSchedule = buildFaseSchedule(players,tp,room.config.faseConfig);
    const balanceInit  = {};
    players.forEach(p=>{ balanceInit[p]=10; });
    await update(ref(db,`rooms/${roomCode}`),{
      pairs:schedule, faseSchedule, "status/phase":"playing","status/partidaActual":1, balance:balanceInit,
    });
    await launchPartida(1,players,schedule,faseSchedule,tp,room);
  };

  const resetSession = async ()=>{
    const players = Object.keys(room?.players||{}).filter(k=>k!=="gestor");
    const bal={}; players.forEach(p=>{bal[p]=10;});
    await update(ref(db,`rooms/${roomCode}`),{
      partidas:null,logs:null,balance:bal,pairs:null,faseSchedule:null,
      "status/phase":"lobby","status/partidaActual":0,
    });
  };

  const saveBotConfig = async () => {
    // Reconstruir bots en players
    const snap    = await get(ref(db,`rooms/${roomCode}/players`));
    const players = snap.val()||{};
    // Eliminar bots anteriores
    const updates = {};
    Object.keys(players).filter(k=>players[k].isBot).forEach(k=>{ updates[`players/${k}`]=null; });
    for (let i=0; i<botCountL; i++) {
      const bid = `bot_${i}`;
      const identity = pickBotIdentity(i);
      updates[`players/${bid}`] = { uid:bid, ...identity, isBot:true, strategy:botStratsL[i]||"ev_threshold" };
    }
    updates[`config/botCount`]      = botCountL;
    updates[`config/botStrategies`] = botStratsL;
    await update(ref(db,`rooms/${roomCode}`), updates);
  };

  const kickPlayer = async (uid) => {
    await update(ref(db,`rooms/${roomCode}`),{[`players/${uid}`]:null,[`balance/${uid}`]:null});
  };

  const saveConfig = ()=>update(ref(db,`rooms/${roomCode}/config`),cfgLocal);

  const exportCSV = ()=>{
    const pl = room?.players||{};
    const bal = room?.balance||{};
    const pts = room?.partidas||{};
    const rawLogs = Object.values(room?.logs||{}).sort((a,b)=>a.ts-b.ts);

    const cols = [
      "sala","partida","par","ronda",
      "jugador_id","jugador_nick","jugador_avatar","jugador_es_bot",
      "rival_id","rival_nick","rival_es_bot",
      "decision","rival_decision",
      "dado_priv_1","dado_priv_2","rival_dado_priv_1","rival_dado_priv_2",
      "dado_pub_1","dado_pub_2","dados_pub_visibles",
      "top3_score","ev",
      "fase_jugador","fase_rival",
      "pozo","tiempo_ms",
      "partida_ganador_id","partida_ganador_nick","partida_resultado","partida_motivo",
      "score_final_jugador","score_final_rival",
      "best3_jugador","best3_rival",
      "balance_jugador","balance_rival",
      "timestamp",
    ];

    const esc = v => {
      const s = String(v??"");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const rows = [];

    const sortedPartidas = Object.keys(pts).map(Number).sort((a,b)=>a-b);
    sortedPartidas.forEach(nPart => {
      Object.entries(pts[nPart]||{}).forEach(([pairKey, pd]) => {
        const [pA,pB] = pd.jugadores||[];
        const pub = pd.publicos||[];
        const ganador = pd.ganador||"";
        const resultado = pd.resultado||"";
        const motivo = resultado.includes("Empate") ? "empate"
          : resultado.includes("retirar") || resultado.includes("Retirada") ? "retiro"
          : resultado.includes("Tres unos") ? "tres_unos"
          : resultado.includes("Mayor suma") ? "mayor_suma"
          : resultado.includes("Casa") ? "casa" : "";

        [pA,pB].forEach(pid => {
          const rival = pid===pA ? pB : pA;
          const pInfo = pl[pid]||{};
          const rInfo = pl[rival]||{};
          const myDice = pd.dados?.[pid]||[];
          const rivDice = pd.dados?.[rival]||[];
          const faseJ = pd.fases?.[pid]||"control";
          const faseR = pd.fases?.[rival]||"control";
          const isJugA = pid===pA;
          const scoreFJ = isJugA ? pd.scoreA : pd.scoreB;
          const scoreFR = isJugA ? pd.scoreB : pd.scoreA;
          const best3J = isJugA ? pd.best3A : pd.best3B;
          const best3R = isJugA ? pd.best3B : pd.best3A;

          for (let ronda=1; ronda<=3; ronda++) {
            const decKey = `${ronda}_${pid}`;
            const dec = pd.decisiones?.[decKey];
            if (dec===undefined) continue;

            const rivDecKey = `${ronda}_${rival}`;
            const rivDec = pd.decisiones?.[rivDecKey]||"";

            const pubVis = pub.slice(0, ronda-1);
            const { score } = top3score(myDice, pubVis);
            const ev = calcEV(myDice, pubVis);

            const logMatch = rawLogs.find(l =>
              l.partida===nPart && l.jugador===pid && l.ronda===ronda && l.accion===dec && l.pairKey===pairKey
            );
            const tiempo = logMatch?.tiempo_ms ?? "";
            const ts = logMatch?.ts ?? "";

            rows.push([
              roomCode, nPart, pairKey, ronda,
              pid, pInfo.nickname||pid, pInfo.avatar||"", pInfo.isBot?"TRUE":"FALSE",
              rival, rInfo.nickname||rival, rInfo.isBot?"TRUE":"FALSE",
              dec, rivDec,
              myDice[0]??"", myDice[1]??"", rivDice[0]??"", rivDice[1]??"",
              pub[0]??"", pub[1]??"", ronda-1,
              score, (ev*100).toFixed(1),
              faseJ, faseR,
              pd.pot||2, tiempo,
              ganador, ganador==="casa"?"casa":(pl[ganador]?.nickname||ganador), resultado, motivo,
              scoreFJ??"", scoreFR??"",
              (best3J||[]).join("+"), (best3R||[]).join("+"),
              bal[pid]??10, bal[rival]??10,
              ts,
            ].map(esc).join(","));
          }
        });
      });
    });

    if (!rows.length) return;
    const bom = "﻿";
    const blob = new Blob([bom + cols.join(",") + "\n" + rows.join("\n")], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `trick_or_treat_${roomCode}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  };

  if (!room) return <div style={{color:"#666",padding:40,textAlign:"center"}}>Cargando sala…</div>;

  const {config,status,players,balance,partidas,logs:logsObj}=room;
  const logs        = Object.values(logsObj||{}).sort((a,b)=>a.ts-b.ts);
  const allPlayers  = Object.entries(players||{}).filter(([k])=>k!=="gestor");
  const humanPl     = allPlayers.filter(([,p])=>!p.isBot);
  const botPl       = allPlayers.filter(([,p])=>p.isBot);
  const phase       = status?.phase||"lobby";
  const pActual     = status?.partidaActual||0;
  const pData       = partidas?.[pActual]||{};
  const TABS = [{id:"control",label:"🎮 Control"},{id:"partidas",label:"🎲 Partidas"},
                {id:"stats",label:"📈 Stats"},{id:"datos",label:"📊 Datos"},{id:"config",label:"⚙️ Config"}];

  return (
    <div style={{maxWidth:740,margin:"0 auto",padding:"20px 16px"}}>
      <GlobalCSS/>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>GESTOR · SALA</div>
          <div style={{fontSize:24,fontWeight:900,color:"#a855f7",fontFamily:"monospace",letterSpacing:3}}>{roomCode}</div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <Badge color={config?.open?"#22c55e":"#ef4444"}>{config?.open?"● ABIERTA":"● CERRADA"}</Badge>
          <Badge color={phase==="playing"?"#f97316":phase==="finished"?"#22c55e":"#666"}>
            {phase==="lobby"?"LOBBY":phase==="playing"?`PARTIDA ${pActual}/${config?.totalPartidas}`:"FIN"}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:16,background:"#1a1a2a",borderRadius:12,padding:4}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"8px 4px",
            background:tab===t.id?"#a855f7":"transparent",border:"none",borderRadius:8,
            color:tab===t.id?"#fff":"#555",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CONTROL ── */}
      {tab==="control" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card accent="#a855f7">
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {!config?.open
                ? <Btn onClick={openRoom} variant="success">Abrir sala</Btn>
                : <Btn onClick={closeRoom} variant="danger">Cerrar sala</Btn>}
              {phase==="lobby"&&config?.open&&<Btn onClick={startExperiment}>▶ Iniciar</Btn>}
              {phase==="playing"&&(
                <Btn onClick={stopAll} variant="warning">⏹ Parar → Lobby</Btn>
              )}
              <Btn onClick={resetSession} variant="ghost">↺ Reiniciar sesión</Btn>
            </div>
            {phase==="playing"&&(
              <div style={{marginTop:8,fontSize:12,color:"#555"}}>
                ⚡ Auto-avance activo — las partidas avanzan solas
              </div>
            )}
          </Card>

          {/* Jugadores humanos */}
          <Card>
            <div style={{fontSize:11,color:"#555",marginBottom:10}}>JUGADORES HUMANOS ({humanPl.length})</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {humanPl.map(([uid,p])=>(
                <div key={uid} style={{background:"#1a1a2a",borderRadius:10,padding:"8px 14px",
                  border:`1px solid ${p.color}44`,display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:22}}>{p.avatar}</span>
                  <div>
                    <div style={{color:p.color,fontWeight:700,fontSize:13}}>{p.nickname}</div>
                    <div style={{color:"#555",fontSize:11}}>💰 {balance?.[uid]??10}</div>
                  </div>
                  {phase==="lobby"&&(
                    <button onClick={()=>kickPlayer(uid)} title="Expulsar" style={{background:"none",border:"none",
                      color:"#ef444488",cursor:"pointer",fontSize:14,padding:"2px 4px",marginLeft:4}}>✕</button>
                  )}
                </div>
              ))}
              {!humanPl.length&&<span style={{color:"#444",fontSize:13}}>Esperando jugadores…</span>}
            </div>
          </Card>

          {botPl.length>0&&(
            <Card accent="#22c55e">
              <div style={{fontSize:11,color:"#22c55e",marginBottom:10}}>
                BOTS ({botPl.length})
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {botPl.map(([uid,p])=>{
                  const si = BOT_STRATEGIES.find(s=>s.id===p.strategy);
                  return (
                    <div key={uid} style={{background:"#1a1a2a",borderRadius:10,padding:"7px 12px",
                      border:"1px solid #22c55e33",display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:18}}>{p.avatar} 🤖</span>
                      <div>
                        <div style={{color:p.color||"#22c55e",fontWeight:700,fontSize:12}}>{p.nickname}</div>
                        <div style={{color:"#555",fontSize:10}}>💰 {balance?.[uid]??10} · {si?.emoji||"🧮"} {si?.label||p.strategy}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Pares en juego */}
          {phase==="playing"&&Object.entries(pData).map(([pairKey,pd])=>{
            const [pA,pB]=pd.jugadores||[];
            const plA=players?.[pA]; const plB=players?.[pB];
            const pub=pd.publicos||[];
            return (
              <Card key={pairKey} accent={pd.resultado?"#22c55e":"#f97316"}>
                <div style={{fontSize:11,color:"#555",marginBottom:8}}>
                  {pd.resultado?"✓ TERMINADO":"EN JUEGO"} · R{pd.ronda}/3
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                  {[[pA,plA,pd.scoreA,pd.best3A],[pB,plB,pd.scoreB,pd.best3B]].map(([pid,pl,score,best3])=>pl&&(
                    <div key={pid}>
                      <div style={{color:pl.color,fontWeight:700,fontSize:13}}>
                        {pl.avatar} {pl.nickname}{pl.isBot?" 🤖":""}
                      </div>
                      <div style={{fontSize:11,color:"#555",fontFamily:"monospace",marginTop:2}}>
                        Dados: {(pd.dados?.[pid]||[]).join(" | ")}
                      </div>
                      {score!==null&&score!==undefined&&(
                        <div style={{fontSize:11,color:"#f97316",marginTop:2}}>
                          Top3: [{(best3||[]).join(",")}] = <b>{score}</b>
                        </div>
                      )}
                      <div style={{fontSize:11,color:pd.decisiones?.[`${pd.ronda}_${pid}`]?"#22c55e":"#555",marginTop:2}}>
                        R{pd.ronda}: {pd.decisiones?.[`${pd.ronda}_${pid}`]||"⏳"}
                      </div>
                      <div style={{fontSize:11,color:"#555",marginTop:2}}>
                        Fase: <span style={{color:"#aaa"}}>{pd.fases?.[pid]||"-"}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:11,color:"#a855f7"}}>
                  Públicos: [{pub.map((v,i)=>i<(pd.ronda||1)-1?v:"?").join(",")}] · Pozo: {pd.pot}
                </div>
                {pd.resultado&&<div style={{marginTop:6,color:"#22c55e",fontWeight:700}}>{pd.resultado}</div>}
              </Card>
            );
          })}

          {phase==="finished"&&(
            <Card style={{textAlign:"center",padding:32}}>
              <div style={{fontSize:48}}>🏆</div>
              <h2 style={{color:"#22c55e",marginTop:8}}>Experimento completado</h2>
              <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:16,flexWrap:"wrap"}}>
                <Btn onClick={exportCSV} variant="success">⬇ Exportar CSV</Btn>
                <Btn onClick={resetSession} variant="ghost">↺ Nueva sesión</Btn>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── PARTIDAS ── */}
      {tab==="partidas"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {Array.from({length:config?.totalPartidas||5},(_,i)=>i+1).map(n=>{
            const done=n<pActual, cur=n===pActual, pd=partidas?.[n]||{};
            const pairs = Object.entries(pd);
            return (
              <Card key={n} accent={cur?"#f97316":done?"#22c55e44":"#2a2a3a"}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:pairs.length?10:0}}>
                  <span style={{fontWeight:700,color:cur?"#f97316":done?"#22c55e":"#555"}}>
                    Partida {n}{cur&&" ← actual"}{done&&" ✓"}
                  </span>
                  <Badge color={cur?"#f97316":done?"#22c55e":"#444"}>
                    {cur?"EN JUEGO":done?"COMPLETADA":"PENDIENTE"}
                  </Badge>
                </div>
                {pairs.map(([pk,d])=>{
                  const [pA,pB] = d.jugadores||[];
                  const plA = players?.[pA], plB = players?.[pB];
                  const ronda = d.ronda||1;
                  const pub   = d.publicos||[];
                  const ended = !!d.resultado;
                  return (
                    <div key={pk} style={{background:"#0f0f1a",borderRadius:10,padding:"10px 12px",
                      marginTop:6,border:`1px solid ${ended?"#22c55e22":"#2a2a3a"}`}}>
                      {/* Ronda + pozo */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{display:"flex",gap:4}}>
                          {[1,2,3].map(r=>(
                            <span key={r} style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:6,
                              background:ronda>r||ended?"#22c55e22":ronda===r?"#f9731622":"#1a1a2a",
                              color:ronda>r||ended?"#22c55e":ronda===r?"#f97316":"#333"}}>
                              R{r}{ronda>r||ended?" ✓":""}
                            </span>
                          ))}
                        </div>
                        <span style={{fontSize:11,color:"#a855f7",fontWeight:700}}>Pozo: {d.pot||2}</span>
                      </div>
                      {/* Jugadores lado a lado */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {[[pA,plA],[pB,plB]].map(([pid,pl])=>{
                          if (!pl) return null;
                          const dice = d.dados?.[pid]||[];
                          const fase = d.fases?.[pid]||"control";
                          const fColor = {control:"#666",yo_trampo:"#eab308",rival_trampa:"#ef4444",ambos:"#a855f7"}[fase]||"#666";
                          const fLabel = {control:"Ninguno",yo_trampo:"Yo trampo",rival_trampa:"Rival trampa",ambos:"Ambos"}[fase]||fase;
                          return (
                            <div key={pid}>
                              <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
                                <span style={{fontSize:14}}>{pl.avatar}</span>
                                <span style={{color:pl.color,fontWeight:700,fontSize:12,flex:1,
                                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                  {pl.nickname}{pl.isBot?" 🤖":""}
                                </span>
                              </div>
                              {/* Dados privados */}
                              <div style={{display:"flex",gap:4,marginBottom:4}}>
                                {dice.map((v,i)=><Die key={i} value={v} size={28} color={pl.color}/>)}
                              </div>
                              {/* Decisiones por ronda */}
                              <div style={{display:"flex",gap:3,marginBottom:4}}>
                                {[1,2,3].map(r=>{
                                  const dec = d.decisiones?.[`${r}_${pid}`];
                                  const isCur = r===ronda && !ended;
                                  return (
                                    <span key={r} style={{fontSize:10,padding:"1px 6px",borderRadius:4,fontWeight:700,
                                      background:dec?(dec==="apostar"?"#22c55e22":"#ef444422"):(isCur?"#f9731615":"#1a1a2a"),
                                      color:dec?(dec==="apostar"?"#22c55e":"#ef4444"):(isCur?"#f97316":"#333"),
                                      border:`1px solid ${dec?(dec==="apostar"?"#22c55e33":"#ef444433"):(isCur?"#f9731633":"transparent")}`}}>
                                      {dec?(dec==="apostar"?"💰":"🏳"):(isCur?"⏳":"·")}
                                    </span>
                                  );
                                })}
                              </div>
                              {/* Fase */}
                              <div style={{fontSize:9,color:fColor}}>{fLabel}</div>
                              {/* Score si terminó */}
                              {ended && d.scoreA!=null && (
                                <div style={{fontSize:11,color:"#f97316",fontWeight:700,marginTop:3}}>
                                  Top3: {(pid===pA?d.best3A:d.best3B||[]).join("+")} = {pid===pA?d.scoreA:d.scoreB}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Dados públicos */}
                      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8,
                        borderTop:"1px solid #1e1e2e",paddingTop:6}}>
                        <span style={{fontSize:10,color:"#555"}}>Públicos:</span>
                        <div style={{display:"flex",gap:4}}>
                          {pub.map((v,i)=>(
                            <Die key={i} value={v} size={24} color="#22c55e"
                              hidden={!ended && i>=ronda-1} glow={!ended && i<ronda-1}/>
                          ))}
                        </div>
                      </div>
                      {/* Resultado */}
                      {ended&&<div style={{marginTop:6,color:"#22c55e",fontWeight:700,fontSize:12}}>{d.resultado}</div>}
                    </div>
                  );
                })}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── STATS ── */}
      {tab==="stats"&&(()=>{
        const totalP = config?.totalPartidas||0;
        const jugadas = Object.keys(partidas||{}).filter(k=>{
          const pairs = Object.values(partidas[k]||{});
          return pairs.length>0 && pairs.every(p=>p.resultado);
        }).length;
        const faltantes = Math.max(0, totalP - jugadas);
        const enCurso  = phase==="playing" && jugadas < totalP ? 1 : 0;

        const statsMap = {};
        allPlayers.forEach(([uid,p])=>{
          statsMap[uid] = { nick:p.nickname, avatar:p.avatar, color:p.color, isBot:!!p.isBot,
            wins:0, losses:0, draws:0, played:0, bets:0, folds:0, totalEarned:0 };
        });
        Object.values(partidas||{}).forEach(partidaObj=>{
          Object.values(partidaObj||{}).forEach(pd=>{
            if (!pd.resultado) return;
            const [pA,pB] = pd.jugadores||[];
            [pA,pB].forEach(pid=>{
              if (!statsMap[pid]) return;
              statsMap[pid].played++;
            });
            const gan = pd.ganador;
            if (gan==="casa") {
              [pA,pB].forEach(pid=>{ if(statsMap[pid]) statsMap[pid].draws++; });
            } else {
              const loser = gan===pA?pB:pA;
              if (statsMap[gan])  statsMap[gan].wins++;
              if (statsMap[loser]) statsMap[loser].losses++;
            }
          });
        });
        logs.forEach(l=>{
          if (!statsMap[l.jugador]) return;
          if (l.accion==="apostar") statsMap[l.jugador].bets++;
          if (l.accion==="retirarse") statsMap[l.jugador].folds++;
        });
        allPlayers.forEach(([uid])=>{
          if (statsMap[uid]) statsMap[uid].totalEarned = (balance?.[uid]??10) - 10;
        });

        const sorted = Object.entries(statsMap).sort((a,b)=>(balance?.[b[0]]??10)-(balance?.[a[0]]??10));
        const maxBal = Math.max(1, ...sorted.map(([uid])=>balance?.[uid]??10));
        const maxWins= Math.max(1, ...sorted.map(([,s])=>s.wins));
        const maxPlayed = Math.max(1, ...sorted.map(([,s])=>s.played));

        return (
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {/* Resumen general */}
            <Card accent="#a855f7">
              <div style={{fontSize:11,color:"#555",marginBottom:10}}>RESUMEN DEL EXPERIMENTO</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {[
                  {label:"Jugadas",  val:jugadas,   color:"#22c55e"},
                  {label:"En curso", val:enCurso,   color:"#f97316"},
                  {label:"Faltantes",val:faltantes,  color:"#666"},
                  {label:"Total",    val:totalP,     color:"#a855f7"},
                ].map(s=>(
                  <div key={s.label} style={{background:"#0f0f1a",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                    <div style={{fontSize:22,fontWeight:900,color:s.color}}>{s.val}</div>
                    <div style={{fontSize:10,color:"#555",marginTop:2}}>{s.label}</div>
                  </div>
                ))}
              </div>
              {totalP>0&&(
                <div style={{marginTop:10,background:"#1e1e2e",borderRadius:6,height:8}}>
                  <div style={{width:`${(jugadas/totalP)*100}%`,background:"#22c55e",borderRadius:6,
                    height:"100%",transition:"width 0.5s"}}/>
                </div>
              )}
            </Card>

            {/* Tabla de stats por jugador */}
            <Card>
              <div style={{fontSize:11,color:"#555",marginBottom:10}}>ESTADÍSTICAS POR JUGADOR</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {sorted.map(([uid,s],i)=>{
                  const bal = balance?.[uid]??10;
                  const wr  = s.played ? Math.round((s.wins/s.played)*100) : 0;
                  return (
                    <div key={uid} style={{background:"#0f0f1a",borderRadius:10,padding:"10px 12px",
                      border:`1px solid ${s.color}22`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <span style={{color:i===0?"#eab308":i===1?"#aaa":i===2?"#cd7f32":"#555",
                          fontWeight:900,fontSize:14,width:20,textAlign:"center"}}>{i+1}</span>
                        <span style={{fontSize:16}}>{s.avatar}</span>
                        <span style={{color:s.color,fontWeight:700,fontSize:13,flex:1}}>
                          {s.nick}{s.isBot?" 🤖":""}
                        </span>
                        <span style={{color:"#f97316",fontWeight:900,fontSize:15}}>💰 {bal}</span>
                      </div>
                      {/* Stats row */}
                      <div style={{display:"flex",gap:12,fontSize:11,color:"#555",marginBottom:6}}>
                        <span>🏆 <span style={{color:"#22c55e"}}>{s.wins}W</span></span>
                        <span>💀 <span style={{color:"#ef4444"}}>{s.losses}L</span></span>
                        <span>🏠 <span style={{color:"#a855f7"}}>{s.draws}D</span></span>
                        <span>💰 <span style={{color:"#22c55e"}}>{s.bets}</span></span>
                        <span>🏳 <span style={{color:"#ef4444"}}>{s.folds}</span></span>
                        <span style={{marginLeft:"auto"}}>WR: <span style={{color:wr>=50?"#22c55e":"#ef4444",fontWeight:700}}>{wr}%</span></span>
                      </div>
                      {/* Bar: win rate */}
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:"#444",width:18}}>WR</span>
                        <div style={{flex:1,background:"#1e1e2e",borderRadius:4,height:6}}>
                          <div style={{width:`${wr}%`,background:s.color,borderRadius:4,height:"100%",
                            transition:"width 0.5s",minWidth:wr>0?4:0}}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Gráfica de barras: fichas */}
            <Card accent="#f97316">
              <div style={{fontSize:11,color:"#555",marginBottom:12}}>FICHAS POR JUGADOR</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {sorted.map(([uid,s])=>{
                  const bal = balance?.[uid]??10;
                  const pct = (bal/maxBal)*100;
                  return (
                    <div key={uid} style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12,width:20,textAlign:"center"}}>{s.avatar}</span>
                      <span style={{color:s.color,fontWeight:700,fontSize:11,width:80,overflow:"hidden",
                        textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.nick}</span>
                      <div style={{flex:1,background:"#1e1e2e",borderRadius:4,height:14,position:"relative"}}>
                        <div style={{width:`${pct}%`,background:s.color,borderRadius:4,height:"100%",
                          transition:"width 0.5s",minWidth:bal>0?4:0}}/>
                        <span style={{position:"absolute",right:6,top:0,fontSize:10,fontWeight:700,
                          color:"#fff",lineHeight:"14px"}}>{bal}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Gráfica de barras: victorias */}
            <Card accent="#22c55e">
              <div style={{fontSize:11,color:"#555",marginBottom:12}}>VICTORIAS POR JUGADOR</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {sorted.map(([uid,s])=>{
                  const pct = (s.wins/maxWins)*100;
                  return (
                    <div key={uid} style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12,width:20,textAlign:"center"}}>{s.avatar}</span>
                      <span style={{color:s.color,fontWeight:700,fontSize:11,width:80,overflow:"hidden",
                        textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.nick}</span>
                      <div style={{flex:1,background:"#1e1e2e",borderRadius:4,height:14,position:"relative"}}>
                        <div style={{width:`${pct}%`,background:"#22c55e",borderRadius:4,height:"100%",
                          transition:"width 0.5s",minWidth:s.wins>0?4:0}}/>
                        <span style={{position:"absolute",right:6,top:0,fontSize:10,fontWeight:700,
                          color:"#fff",lineHeight:"14px"}}>{s.wins}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Gráfica de barras: partidas jugadas */}
            <Card accent="#3b82f6">
              <div style={{fontSize:11,color:"#555",marginBottom:12}}>PARTIDAS JUGADAS POR JUGADOR</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {sorted.map(([uid,s])=>{
                  const pct = (s.played/maxPlayed)*100;
                  return (
                    <div key={uid} style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12,width:20,textAlign:"center"}}>{s.avatar}</span>
                      <span style={{color:s.color,fontWeight:700,fontSize:11,width:80,overflow:"hidden",
                        textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.nick}</span>
                      <div style={{flex:1,background:"#1e1e2e",borderRadius:4,height:14,position:"relative"}}>
                        <div style={{width:`${pct}%`,background:"#3b82f6",borderRadius:4,height:"100%",
                          transition:"width 0.5s",minWidth:s.played>0?4:0}}/>
                        <span style={{position:"absolute",right:6,top:0,fontSize:10,fontWeight:700,
                          color:"#fff",lineHeight:"14px"}}>{s.played}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        );
      })()}

      {/* ── DATOS ── */}
      {tab==="datos"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{color:"#555",fontSize:13}}>{logs.length} eventos</span>
            <Btn onClick={exportCSV} variant="success" style={{fontSize:13,padding:"7px 16px"}}>⬇ CSV</Btn>
          </div>
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
                <thead>
                  <tr>{["Part.","Jugador","Rival","Acción","Ronda","EV","T(ms)","Fase","ScA","ScB","Resultado"].map(h=>(
                    <th key={h} style={{color:"#444",padding:"5px 6px",textAlign:"left",borderBottom:"1px solid #1e1e2e"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {logs.slice(-80).reverse().map((l,i)=>(
                    <tr key={i} style={{borderBottom:"1px solid #141420"}}>
                      <td style={{padding:"3px 6px",color:"#555"}}>{l.partida}</td>
                      <td style={{padding:"3px 6px",color:players?.[l.jugador]?.color||"#aaa",fontWeight:700}}>
                        {players?.[l.jugador]?.nickname||l.jugador}
                      </td>
                      <td style={{padding:"3px 6px",color:players?.[l.rival]?.color||"#555"}}>
                        {players?.[l.rival]?.nickname||l.rival}
                      </td>
                      <td style={{padding:"3px 6px",color:l.accion==="apostar"?"#22c55e":"#ef4444"}}>{l.accion}</td>
                      <td style={{padding:"3px 6px",color:"#aaa"}}>{l.ronda}</td>
                      <td style={{padding:"3px 6px",color:"#a855f7"}}>{((l.ev||0)*100).toFixed(0)}%</td>
                      <td style={{padding:"3px 6px",color:"#555"}}>{l.tiempo_ms}</td>
                      <td style={{padding:"3px 6px",color:"#555",fontSize:10}}>{l.fase}</td>
                      <td style={{padding:"3px 6px",color:"#f97316"}}>{l.scoreA??""}</td>
                      <td style={{padding:"3px 6px",color:"#3b82f6"}}>{l.scoreB??""}</td>
                      <td style={{padding:"3px 6px",color:"#22c55e"}}>{l.resultado||""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!logs.length&&<div style={{color:"#444",padding:20,textAlign:"center"}}>Sin datos aún</div>}
            </div>
          </Card>
        </div>
      )}

      {/* ── CONFIG ── */}
      {tab==="config"&&cfgLocal&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card accent="#a855f7">
            <div style={{fontSize:12,color:"#555",marginBottom:16}}>OPCIONES DE JUEGO</div>
            <label style={{color:"#777",fontSize:13,display:"flex",alignItems:"center",gap:10,marginBottom:10,cursor:"pointer"}}>
              <input type="checkbox" checked={!!cfgLocal.showEV}
                onChange={e=>setCfgLocal(c=>({...c,showEV:e.target.checked}))}
                style={{accentColor:"#f97316",width:16,height:16}}/>
              Mostrar prob. de victoria del jugador
            </label>
            <label style={{color:"#777",fontSize:13,display:"flex",alignItems:"center",gap:10,marginBottom:14,cursor:"pointer"}}>
              <input type="checkbox" checked={!!cfgLocal.showRivalEV}
                onChange={e=>setCfgLocal(c=>({...c,showRivalEV:e.target.checked}))}
                style={{accentColor:"#ef4444",width:16,height:16}}/>
              Mostrar prob. de victoria del rival
            </label>
            <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>
              Temporizador por ronda:{" "}
              <span style={{color:"#f97316"}}>{cfgLocal.timerSecs===0?"Sin límite":`${cfgLocal.timerSecs}s`}</span>
              {cfgLocal.timerSecs>0&&<span style={{color:"#555",fontSize:11}}> (al vencer → se asume apostar)</span>}
            </label>
            <input type="range" min={0} max={60} step={5} value={cfgLocal.timerSecs||0}
              onChange={e=>setCfgLocal(c=>({...c,timerSecs:+e.target.value}))}
              style={{width:"100%",marginBottom:16,accentColor:"#f97316"}}/>
            <Btn onClick={saveConfig} variant="purple" style={{width:"100%"}}>Guardar cambios</Btn>
          </Card>

          <Card accent="#3b82f6">
            <div style={{fontSize:12,color:"#3b82f6",fontWeight:700,marginBottom:10}}>📊 Cómo se calcula la probabilidad</div>
            <div style={{fontSize:12,color:"#666",lineHeight:1.6}}>
              Se usa <span style={{color:"#aaa"}}>simulación Monte Carlo (500 escenarios)</span>: se completan los dados públicos
              faltantes y se generan dados aleatorios para el rival. La prob. es el % de escenarios donde el jugador gana.
            </div>
            <div style={{fontSize:12,color:"#666",lineHeight:1.6,marginTop:8}}>
              <span style={{color:"#eab308"}}>Con ventaja:</span> se usa el dado real del rival (el que el jugador puede ver)
              en lugar de uno aleatorio. El jugador ve dos barras — su prob. normal vs. con info extra — para medir el
              impacto de la ventaja.
            </div>
            <div style={{fontSize:12,color:"#666",lineHeight:1.6,marginTop:8}}>
              <span style={{color:"#ef4444"}}>Prob. rival:</span> es el % de escenarios donde el rival supera al jugador.
              La diferencia hasta 100% son empates (la casa gana).
            </div>
          </Card>

          <BotConfig botCount={botCountL} setBotCount={setBotCountL}
            botStrategies={botStratsL} setBotStrategies={setBotStratsL}/>
          <Btn onClick={saveBotConfig} variant="success" style={{width:"100%"}}>
            Aplicar configuración de bots
          </Btn>

          <Card>
            <div style={{fontSize:11,color:"#555",marginBottom:8}}>CÓDIGO DE SALA</div>
            <div style={{fontFamily:"monospace",fontSize:30,letterSpacing:8,color:"#f97316",
              fontWeight:900,background:"#0a0a0f",padding:"14px 20px",borderRadius:10,textAlign:"center"}}>
              {roomCode}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── PLAYER SCREEN ────────────────────────────────────────────────────────────
function PlayerScreen({ roomCode, playerId, profile, onLeave }) {
  const [room,     setRoom]     = useState(null);
  const [decidido, setDecidido] = useState(false);
  const [overlay,  setOverlay]  = useState(null);
  const [timerLeft,setTimer]    = useState(null);
  const [kicked,   setKicked]   = useState(false);
  const prevRondaRef    = useRef(null);
  const prevPartidaRef  = useRef(null);
  const timerRef        = useRef(null);
  const resolvedRef     = useRef(new Set());
  const autoFoldRef     = useRef(null);
  const cheatShownRef   = useRef(null);
  const cheatTimerRef   = useRef(null);
  const matchSoundRef   = useRef(null);
  const resultSoundRef  = useRef(null);
  const decidirRef      = useRef(null);
  const graceRef        = useRef(null);
  const wasInRoomRef    = useRef(false);

  const leaveGame = async () => {
    await update(ref(db,`rooms/${roomCode}/players/${playerId}`),{ isBot:true, strategy:"ev_threshold" });
    onLeave?.();
  };

  useEffect(()=>{
    const r=ref(db,`rooms/${roomCode}`);
    onValue(r,snap=>{
      if(!snap.exists()) return;
      const d = snap.val();
      const stillIn = !!d.players?.[playerId];
      if (wasInRoomRef.current && !stillIn) { setKicked(true); return; }
      if (stillIn) wasInRoomRef.current = true;
      setRoom(d);
    });
    return ()=>off(r);
  },[roomCode,playerId]);

  const getMyPair  = useCallback((r,n)=>Object.values(r?.partidas?.[n]||{}).find(p=>(p.jugadores||[]).includes(playerId))||null,[playerId]);
  const getPairKey = useCallback((r,n)=>Object.keys(r?.partidas?.[n]||{}).find(k=>(r.partidas[n][k].jugadores||[]).includes(playerId))||null,[playerId]);

  // Animaciones por cambio de ronda/partida
  useEffect(()=>{
    if (!room) return;
    const n = room.status?.partidaActual||0;
    const myPair = getMyPair(room,n);
    if (!myPair) return;
    const ronda = myPair.ronda||1;
    const fase  = myPair.fases?.[playerId]||"control";
    const isCheat = fase==="yo_trampo"||fase==="ambos";

    if (prevRondaRef.current!==null && ronda!==prevRondaRef.current) {
      setDecidido(false);
      clearTimeout(autoFoldRef.current);
      if (ronda<=3&&!myPair.resultado) {
        setOverlay({type:"rolling",msg:
          ronda===1?"🎲 ¡Dados lanzados!":
          ronda===2?"🌐 Primer dado público revelado":
                    "🌐 Segundo dado público — ¡última ronda!"});
        setTimeout(()=>setOverlay(null),1800);
      }
    }

    let nextDelay = 0;
    if (prevPartidaRef.current!==null && n!==prevPartidaRef.current && n>0) {
      setDecidido(false);
      resolvedRef.current.clear();
      clearTimeout(autoFoldRef.current);
      clearTimeout(cheatTimerRef.current);
      setOverlay({type:"next",msg:`⚔️ ¡Partida ${n} comenzando!`});
      setTimeout(()=>setOverlay(null),1800);
      nextDelay = 2100;
    }

    if (isCheat && cheatShownRef.current!==n) {
      cheatShownRef.current = n;
      const msg = "¡Tienes ventaja secreta!\nPuedes ver uno de los dados privados de tu rival";
      cheatTimerRef.current = setTimeout(()=>{
        setOverlay({type:"cheat",msg});
        setTimeout(()=>setOverlay(null),3000);
      }, nextDelay||400);
    }

    // Sonido al entrar a nueva partida
    if (n>0 && !myPair.resultado && matchSoundRef.current!==n) {
      matchSoundRef.current = n;
      soundNewMatch();
    }
    // Sonido al ganar/perder
    const res = myPair.resultado||null;
    const gan = myPair.ganador||null;
    if (res) {
      const rk = `${n}_result`;
      if (resultSoundRef.current!==rk) {
        resultSoundRef.current = rk;
        if (gan===playerId) soundWin(); else soundLose();
      }
    }

    prevRondaRef.current   = ronda;
    prevPartidaRef.current = n;
  },[room]);

  // Timer circular + auto-apostar al vencer
  useEffect(()=>{
    clearInterval(timerRef.current);
    clearTimeout(autoFoldRef.current);
    clearTimeout(graceRef.current);
    if (!room) return;
    const secs = room.config?.timerSecs||0;
    if (!secs) { setTimer(null); return; }
    const myPair = getMyPair(room,room.status?.partidaActual||0);
    if (!myPair||myPair.resultado) { setTimer(null); return; }
    const ronda = myPair.ronda||1;
    if (ronda>3) { setTimer(null); return; }
    const GRACE = 3000;
    setTimer(secs);
    graceRef.current = setTimeout(()=>{
      timerRef.current = setInterval(()=>setTimer(l=>Math.max(0,(l||0)-1)),1000);
      autoFoldRef.current = setTimeout(()=>{
        setTimer(0);
        decidirRef.current?.("apostar");
      }, secs*1000);
    }, GRACE);
    return ()=>{ clearTimeout(graceRef.current); clearInterval(timerRef.current); clearTimeout(autoFoldRef.current); };
  },[room?.status?.partidaActual, room?.config?.timerSecs, (getMyPair(room, room?.status?.partidaActual||0)||{}).ronda]);

  // Detectar cuando el rival decidió mientras yo ya había decidido
  useEffect(()=>{
    if (!room||!decidido) return;
    const n = room.status?.partidaActual||0;
    const pairKey = getPairKey(room,n);
    if (!pairKey) return;
    const pd = room.partidas?.[n]?.[pairKey];
    if (!pd||pd.resultado) { setOverlay(null); return; }
    const ronda  = pd.ronda||1;
    const rival  = (pd.jugadores||[]).find(j=>j!==playerId);
    const myDec  = pd.decisiones?.[`${ronda}_${playerId}`];
    const rivDec = pd.decisiones?.[`${ronda}_${rival}`];
    const rk     = `${n}_${pairKey}_${ronda}`;
    if (myDec&&rivDec&&!resolvedRef.current.has(rk)) {
      resolvedRef.current.add(rk);
      setOverlay(null);
      resolveRondaDB(roomCode,room,n,pairKey,pd,ronda,
        playerId<rival?playerId:rival, playerId<rival?myDec:rivDec,
        playerId<rival?rival:playerId, playerId<rival?rivDec:myDec);
    }
  },[room,decidido]);

  const decidir = useCallback(async (accion) => {
    if (decidido) return;
    if (!room) return;
    const n = room.status?.partidaActual||0;
    const pairKey = getPairKey(room,n);
    if (!pairKey) return;
    const pd    = room.partidas?.[n]?.[pairKey];
    if (!pd||pd.resultado) return;
    const ronda = pd.ronda||1;
    const rival = (pd.jugadores||[]).find(j=>j!==playerId);
    const myDice= pd.dados?.[playerId]||[];
    const pubVis= (pd.publicos||[]).slice(0,ronda-1);
    const ev    = calcEV(myDice,pubVis);
    const tiempo= Date.now()-(pd.startedAt||Date.now());

    setDecidido(true);
    clearTimeout(autoFoldRef.current);
    clearInterval(timerRef.current);
    setTimer(null);
    setOverlay({type:"waiting",msg:"Esperando al otro jugador…"});

    const decKey = `${ronda}_${playerId}`;
    await update(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}/decisiones`),{[decKey]:accion});

    const logRef = push(ref(db,`rooms/${roomCode}/logs`));
    await set(logRef,{
      partida:n,pairKey,jugador:playerId,rival,
      nickname_jugador:profile?.nickname||"",
      nickname_rival:room.players?.[rival]?.nickname||"",
      accion,ronda,ev,tiempo_ms:tiempo,
      fase:pd.fases?.[playerId]||"control",
      suma_propia:myDice.reduce((a,b)=>a+b,0),
      suma_publica:pubVis.reduce((a,b)=>a+b,0),
      resultado:null,ts:Date.now(),
    });

    const rivalDec = pd.decisiones?.[`${ronda}_${rival}`];
    const rk = `${n}_${pairKey}_${ronda}`;
    if (rivalDec&&!resolvedRef.current.has(rk)) {
      resolvedRef.current.add(rk);
      setOverlay(null);
      await resolveRondaDB(roomCode,room,n,pairKey,pd,ronda,
        playerId<rival?playerId:rival, playerId<rival?accion:rivalDec,
        playerId<rival?rival:playerId, playerId<rival?rivalDec:accion);
    }
  },[decidido,room,playerId,roomCode,profile]);
  decidirRef.current = decidir;

  // ── RENDER ──────────────────────────────────────────────────────────────────
  if (kicked) return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"60px 20px",textAlign:"center"}}>
      <GlobalCSS/>
      <div style={{fontSize:72,animation:"popIn 0.4s ease"}}>🚫</div>
      <h2 style={{color:"#ef4444",marginTop:12}}>Has sido expulsado</h2>
      <p style={{color:"#666",fontSize:14,marginTop:8}}>El gestor te ha removido de la sala.</p>
      <Btn onClick={()=>onLeave?.()} variant="ghost" style={{marginTop:20}}>Volver al inicio</Btn>
    </div>
  );

  if (!room) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"70vh",color:"#555",gap:16}}>
      <GlobalCSS/>
      <div style={{fontSize:40,animation:"spin 1s linear infinite",display:"inline-block"}}>⚙️</div>
      <div>Conectando…</div>
    </div>
  );

  const {config,status,players,balance}=room;
  const phase   = status?.phase||"lobby";
  const n       = status?.partidaActual||0;
  const myPair  = getMyPair(room,n);
  const myBal   = balance?.[playerId]??10;
  const myColor = profile?.color||"#f97316";

  if (phase==="lobby"||phase==="finished") return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"48px 20px",textAlign:"center"}}>
      <GlobalCSS/>
      <div style={{display:"flex",justifyContent:"flex-end"}}>
        <PlayerMenu onLeave={leaveGame} players={players} balance={balance} playerId={playerId} roomCode={roomCode}/>
      </div>
      <div style={{fontSize:64,display:"inline-block",animation:"float 3s ease-in-out infinite"}}>
        {phase==="finished"?"🏆":"🎃"}
      </div>
      <h2 style={{color:phase==="finished"?"#22c55e":"#f97316",marginTop:8}}>
        {phase==="finished"?"¡Experimento terminado!":"Esperando al gestor…"}
      </h2>
      <Card style={{marginTop:20}}>
        <div style={{fontSize:44}}>{profile?.avatar}</div>
        <div style={{color:myColor,fontWeight:700,fontSize:20,marginTop:6}}>{profile?.nickname}</div>
        <div style={{color:"#555",fontSize:13,marginTop:2}}>Sala {roomCode}</div>
        <div style={{fontSize:24,fontWeight:900,color:"#f97316",marginTop:12}}>💰 {myBal}</div>
      </Card>
    </div>
  );

  if (!myPair) return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"60px 20px",textAlign:"center"}}>
      <GlobalCSS/>
      <div style={{fontSize:48,display:"inline-block",animation:"pulse 1.5s infinite"}}>⏳</div>
      <p style={{color:"#555",marginTop:16}}>Esperando emparejamiento…</p>
    </div>
  );

  const rival     = (myPair.jugadores||[]).find(j=>j!==playerId);
  const rivalInfo = players?.[rival];
  const myDice    = myPair.dados?.[playerId]||[];
  const ronda     = myPair.ronda||1;
  const pubAll    = myPair.publicos||[];
  const pubVisible= pubAll.slice(0,ronda-1);
  const pubHidden = pubAll.slice(ronda-1);
  const pot       = myPair.pot||0;
  const resultado = myPair.resultado||null;
  const ganador   = myPair.ganador||null;
  const fase      = myPair.fases?.[playerId]||"control";
  const canCheat  = fase==="yo_trampo"||fase==="ambos";
  const rivalDice = myPair.dados?.[rival]||[];
  const yaDecidio = !!myPair.decisiones?.[`${ronda}_${playerId}`];
  const rivDecidio= !!myPair.decisiones?.[`${ronda}_${rival}`];
  const isShaking = overlay?.type==="rolling";
  const timerSecs = config?.timerSecs||0;

  // Calcular top3 para mostrar al jugador
  const { score:myScore, best3:myBest3 } = top3score(myDice, pubVisible);
  const ev = myDice.length ? calcEV(myDice, pubVisible) : 0;
  const probs = myDice.length
    ? estimateProbs(myDice, pubVisible, canCheat?[rivalDice[0]]:[])
    : {me:0,rival:0,meCheat:null,rivalCheat:null};

  // RESULTADO
  if (resultado) {
    const gane   = ganador===playerId;
    const casa   = ganador==="casa";
    const pub    = myPair.publicos||[];
    const myFinalScore = myPair.scoreA!==undefined
      ? (myPair.jugadores[0]===playerId ? myPair.scoreA : myPair.scoreB) : null;
    const rivalFinalScore = myPair.scoreA!==undefined
      ? (myPair.jugadores[0]===playerId ? myPair.scoreB : myPair.scoreA) : null;
    const myBest3Final = myPair.jugadores[0]===playerId ? myPair.best3A : myPair.best3B;
    const rivalBest3   = myPair.jugadores[0]===playerId ? myPair.best3B : myPair.best3A;

    return (
      <div style={{maxWidth:420,margin:"0 auto",padding:"24px 16px"}}>
        <GlobalCSS/>
        <Overlay show={true}>
          <Card style={{maxWidth:350,textAlign:"center",padding:36,animation:"popIn 0.4s ease",
            border:`1px solid ${gane?"#22c55e":casa?"#a855f7":"#ef4444"}44`,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontSize:72,animation:"popIn 0.5s ease 0.1s both"}}>
              {casa?"🏠":gane?"🏆":"💀"}
            </div>
            <h2 style={{color:gane?"#22c55e":casa?"#a855f7":"#ef4444",marginBottom:8,fontSize:22,marginTop:8}}>
              {casa?"La casa gana":gane?"¡Ganaste!":"¡Perdiste!"}
            </h2>
            <p style={{color:"#666",fontSize:13,marginBottom:16}}>{resultado}</p>

            {/* Comparación de manos */}
            {myFinalScore!==null && (
              <div style={{background:"#0a0a0f",borderRadius:12,padding:14,marginBottom:14,textAlign:"left"}}>
                <div style={{fontSize:11,color:"#555",marginBottom:8,textAlign:"center"}}>RESULTADO FINAL</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:11,color:myColor,marginBottom:4}}>{profile?.nickname}</div>
                    <div style={{display:"flex",gap:4,justifyContent:"center",flexWrap:"wrap"}}>
                      {(myBest3Final||[]).map((v,i)=>(
                        <Die key={i} value={v} size={32} color={myColor} glow selected/>
                      ))}
                    </div>
                    <div style={{fontSize:18,fontWeight:900,color:myColor,marginTop:6}}>= {myFinalScore}</div>
                    <div style={{fontSize:10,color:"#555"}}>dados: {myDice.join("+")} | pub: {pub.join("+")}</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:11,color:rivalInfo?.color||"#aaa",marginBottom:4}}>{rivalInfo?.nickname}</div>
                    <div style={{display:"flex",gap:4,justifyContent:"center",flexWrap:"wrap"}}>
                      {(rivalBest3||[]).map((v,i)=>(
                        <Die key={i} value={v} size={32} color={rivalInfo?.color||"#aaa"} glow selected/>
                      ))}
                    </div>
                    <div style={{fontSize:18,fontWeight:900,color:rivalInfo?.color||"#aaa",marginTop:6}}>= {rivalFinalScore}</div>
                    <div style={{fontSize:10,color:"#555"}}>dados: {rivalDice.join("+")} | pub: {pub.join("+")}</div>
                  </div>
                </div>
              </div>
            )}

            <div style={{fontSize:22,fontWeight:900,color:"#f97316",marginBottom:4}}>💰 {myBal} fichas</div>
            <p style={{color:"#555",fontSize:12}}>Espera la siguiente partida…</p>
          </Card>
        </Overlay>
        <PlayerHeader profile={profile} balance={myBal} roomCode={roomCode} partida={n} total={config?.totalPartidas}/>
      </div>
    );
  }

  // EN JUEGO
  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"16px 16px 80px"}}>
      <GlobalCSS/>

      <Overlay show={overlay?.type==="rolling"}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:88,display:"inline-block",animation:"shakeDie 0.4s ease infinite"}}>🎲</div>
          <div style={{color:"#f97316",fontWeight:700,fontSize:18,marginTop:12,maxWidth:280,animation:"slideUp 0.3s ease"}}>
            {overlay?.msg}
          </div>
        </div>
      </Overlay>

      <Overlay show={overlay?.type==="waiting"}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:60,display:"inline-block",animation:"pulse 1.2s infinite"}}>⏳</div>
          <div style={{color:"#aaa",fontSize:16,marginTop:14}}>{overlay?.msg}</div>
          {rivDecidio&&<Badge color="#22c55e" style={{marginTop:10}}>✓ Rival ya decidió</Badge>}
        </div>
      </Overlay>

      <Overlay show={overlay?.type==="next"}>
        <div style={{textAlign:"center",animation:"popIn 0.4s ease"}}>
          <div style={{fontSize:72}}>⚔️</div>
          <div style={{color:"#f97316",fontWeight:900,fontSize:22,marginTop:12}}>{overlay?.msg}</div>
        </div>
      </Overlay>

      <Overlay show={overlay?.type==="cheat"}>
        <div style={{textAlign:"center",animation:"popIn 0.4s ease"}}>
          <div style={{background:"#1a1a0a",border:"2px solid #eab308",borderRadius:20,
            padding:"36px 32px",maxWidth:320,animation:"cheatGlow 1.5s ease infinite"}}>
            <div style={{fontSize:72,animation:"cheatIcon 0.6s ease both"}}>👁️</div>
            <div style={{color:"#eab308",fontWeight:900,fontSize:22,marginTop:12,lineHeight:1.4,
              textShadow:"0 0 20px #eab30866"}}>
              {(overlay?.msg||"").split("\n").map((l,i)=><div key={i}>{l}</div>)}
            </div>
            <div style={{marginTop:16,display:"flex",gap:6,justifyContent:"center"}}>
              <Die value={3} size={40} color="#eab308" glow/>
              <Die value={0} hidden size={40}/>
            </div>
            <div style={{color:"#eab30888",fontSize:11,marginTop:10}}>
              Mira la sección del rival más abajo
            </div>
          </div>
        </div>
      </Overlay>

      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:4}}>
        <PlayerMenu onLeave={leaveGame} players={players} balance={balance} playerId={playerId} roomCode={roomCode}/>
      </div>
      <PlayerHeader profile={profile} balance={myBal} roomCode={roomCode} partida={n} total={config?.totalPartidas}/>

      {/* Timer circular */}
      {timerSecs>0&&timerLeft!==null&&!yaDecidio&&(
        <TimerCircle seconds={timerLeft} total={timerSecs}/>
      )}

      {/* Progress rondas */}
      <div style={{display:"flex",gap:5,marginBottom:10}}>
        {[{n:1,l:"Dados"},{n:2,l:"Pub·1"},{n:3,l:"Pub·2"},{n:4,l:"Final"}].map(r=>(
          <div key={r.n} style={{flex:1,textAlign:"center",padding:"6px 2px",borderRadius:10,
            background:ronda>r.n?"#22c55e18":ronda===r.n?"#f9731618":"#12121e",
            border:`1px solid ${ronda>r.n?"#22c55e55":ronda===r.n?"#f9731655":"#1e1e2e"}`}}>
            <div style={{fontSize:9,color:"#444"}}>R{r.n}</div>
            <div style={{fontSize:10,fontWeight:700,color:ronda>r.n?"#22c55e":ronda===r.n?"#f97316":"#333"}}>
              {r.l}
            </div>
          </div>
        ))}
      </div>

      {/* Mis dados + top3 */}
      <Card accent={myColor} style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#555",marginBottom:8}}>TUS DADOS</div>
        <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:12}}>
          {myDice.map((v,i)=>(
            <Die key={i} value={v} size={58} color={myColor} shake={isShaking}
              selected={myBest3.includes(v)&&myBest3.indexOf(v)===myDice.slice(0,i+1).filter(x=>myBest3.includes(x)&&myDice.slice(0,myDice.indexOf(x)+1).filter(y=>y===x).length<=myBest3.filter(y=>y===x).length).length-1}
            />
          ))}
        </div>
        {/* Suma visual */}
        <div style={{display:"flex",justifyContent:"center",gap:5,alignItems:"center",
          flexWrap:"wrap",fontSize:15,fontWeight:700}}>
          {myBest3.map((v,i)=>[
            <span key={i} style={{color:myColor}}>{v}</span>,
            i<myBest3.length-1&&<span key={`op${i}`} style={{color:"#333"}}>+</span>
          ])}
          <span style={{color:"#fff",fontSize:20,marginLeft:4}}>
            = <span style={{color:"#f97316"}}>{myScore}</span>
          </span>
        </div>
        {ronda===1&&<div style={{fontSize:11,color:"#555",textAlign:"center",marginTop:4}}>
          (score provisional — solo con tus dados)
        </div>}
        {(config?.showEV||config?.showRivalEV)&&(
          <div style={{marginTop:10}}>
            {config?.showEV&&(
              <EVBar value={canCheat&&probs.meCheat!==null?probs.meCheat:probs.me}
                label="Tu prob. victoria" color={myColor}/>
            )}
            {config?.showRivalEV&&(
              <EVBar value={canCheat&&probs.rivalCheat!==null?probs.rivalCheat:probs.rival}
                label="Prob. victoria rival" color={rivalInfo?.color||"#ef4444"}/>
            )}
          </div>
        )}
      </Card>

      {/* Dados públicos */}
      <Card accent="#22c55e" style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#555",marginBottom:8}}>DADOS PÚBLICOS (compartidos)</div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          {pubVisible.map((v,i)=>(
            <Die key={i} value={v} size={52} color="#22c55e" shake={isShaking} glow
              selected={myBest3.includes(v)}/>
          ))}
          {pubHidden.map((_,i)=>(
            <Die key={`h${i}`} value={0} hidden size={52}/>
          ))}
        </div>
        {pubVisible.length>0&&(
          <div style={{fontSize:11,color:"#555",textAlign:"center",marginTop:6}}>
            Los dados con ✓ forman parte de tu top 3
          </div>
        )}
      </Card>

      {/* Rival */}
      <Card accent={canCheat?"#eab308":"#1e1e2e"} style={{marginBottom:10}}>
        <div style={{fontSize:11,color:canCheat?"#eab308":"#444",marginBottom:8}}>
          {canCheat?"🃏 VES UN DADO DEL RIVAL":"RIVAL"}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          {rivalInfo&&<>
            <span style={{fontSize:24}}>{rivalInfo.avatar}</span>
            <span style={{color:rivalInfo.color,fontWeight:700}}>{rivalInfo.nickname}</span>
          </>}
          {rivDecidio&&!yaDecidio&&<Badge color="#22c55e">✓ Ya decidió</Badge>}
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <Die value={rivalDice[0]} hidden={!canCheat} size={50} color="#eab308" glow={canCheat}/>
          <Die value={rivalDice[1]} hidden size={50}/>
        </div>
      </Card>

      <div style={{textAlign:"center",color:"#a855f7",fontWeight:700,fontSize:16,margin:"8px 0"}}>
        🏆 Pozo: {pot} fichas
      </div>

      {ronda<=3&&(
        yaDecidio
          ? <Card style={{textAlign:"center",padding:20,background:"#0f0f1a",border:"1px solid #1e1e2e"}}>
              <div style={{color:"#444",fontSize:14,animation:"pulse 1.5s infinite"}}>⏳ Esperando al otro jugador…</div>
            </Card>
          : <div style={{display:"flex",gap:10,marginTop:4}}>
              <Btn onClick={()=>decidir("apostar")} variant="success"
                style={{flex:1,fontSize:16,padding:"15px 0",borderRadius:12}}>
                💰 Apostar +1
              </Btn>
              <Btn onClick={()=>decidir("retirarse")} variant="danger"
                style={{flex:1,fontSize:16,padding:"15px 0",borderRadius:12}}>
                🏳 Retirarse
              </Btn>
            </div>
      )}

      {ronda>=4&&!resultado&&(
        <Card style={{textAlign:"center",padding:20}}>
          <div style={{color:"#555",fontSize:14,animation:"pulse 1.5s infinite"}}>⏳ Calculando resultado…</div>
        </Card>
      )}
    </div>
  );
}

function PlayerMenu({ onLeave, players, balance, playerId, roomCode }) {
  const [open, setOpen]       = useState(false);
  const [panel, setPanel]     = useState(null);
  const menuRef               = useRef(null);

  useEffect(()=>{
    if (!open) return;
    const close = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return ()=>document.removeEventListener("mousedown", close);
  },[open]);

  const toggleFS = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
    setOpen(false);
  };

  const sorted = Object.entries(players||{})
    .filter(([k])=>k!=="gestor")
    .map(([uid,p])=>({...p, uid, bal:balance?.[uid]??10}))
    .sort((a,b)=>b.bal-a.bal);

  const items = [
    {label:"Reglas del juego", icon:"📖", action:()=>{ setPanel("rules");  setOpen(false); }},
    {label:"Probabilidades",   icon:"📊", action:()=>{ setPanel("probs");  setOpen(false); }},
    {label:"Ranking",          icon:"🏅", action:()=>{ setPanel("ranking");setOpen(false); }},
    {label:"Pantalla completa",icon:"⛶",  action:toggleFS},
    {label:"Salir del juego",  icon:"🚪", action:()=>{ setPanel("confirm");setOpen(false); }, danger:true},
  ];

  return (
    <>
      <div ref={menuRef} style={{position:"relative",zIndex:100}}>
        <button onClick={()=>setOpen(o=>!o)} style={{background:"none",border:"1px solid #2a2a3a",
          borderRadius:8,padding:"4px 8px",cursor:"pointer",fontSize:18,lineHeight:1,color:"#666"}}>☰</button>
        {open&&(
          <div style={{position:"absolute",right:0,top:"110%",background:"#1a1a2a",border:"1px solid #2a2a3a",
            borderRadius:12,padding:6,minWidth:200,boxShadow:"0 8px 32px #000a",animation:"fadeIn 0.15s ease"}}>
            {items.map(it=>(
              <button key={it.label} onClick={it.action} style={{display:"flex",alignItems:"center",gap:10,
                width:"100%",background:"none",border:"none",borderRadius:8,padding:"10px 12px",
                cursor:"pointer",color:it.danger?"#ef4444":"#ccc",fontSize:13,fontFamily:"inherit",
                textAlign:"left",fontWeight:it.danger?700:400}}>
                <span style={{fontSize:16,width:22,textAlign:"center"}}>{it.icon}</span>{it.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <Overlay show={panel==="rules"}>
        <Card style={{maxWidth:380,padding:28,maxHeight:"85vh",overflowY:"auto",animation:"popIn 0.3s ease"}}>
          <h3 style={{color:"#f97316",marginTop:0,marginBottom:12}}>📖 Reglas del juego</h3>
          {[
            ["🎲 Dados","Recibes 2 dados privados. Hay 2 dados públicos compartidos que se revelan uno por ronda."],
            ["🏆 Top 3","De tus 2 dados + los públicos visibles, se toman los 3 de mayor valor. Tu score es su suma (máx 18)."],
            ["💰 Rondas","Hay 3 rondas. En cada una decides: apostar (+1 ficha al pozo) o retirarte."],
            ["🏠 Retirarse","Si te retiras, el rival gana el pozo. Si ambos se retiran, la casa gana."],
            ["⚖️ Empate","Si ambos apuestan las 3 rondas y el score es igual, la casa gana el pozo."],
            ["👁️ Fases","En algunas partidas puedes ver un dado del rival (o él ve el tuyo). Esto es parte del experimento."],
          ].map(([t,d])=>(
            <div key={t} style={{marginBottom:10}}>
              <div style={{color:"#aaa",fontWeight:700,fontSize:13}}>{t}</div>
              <div style={{color:"#666",fontSize:12,lineHeight:1.5}}>{d}</div>
            </div>
          ))}
          <Btn onClick={()=>setPanel(null)} style={{width:"100%",marginTop:8}}>Cerrar</Btn>
        </Card>
      </Overlay>

      <Overlay show={panel==="probs"}>
        <Card style={{maxWidth:400,padding:28,maxHeight:"85vh",overflowY:"auto",animation:"popIn 0.3s ease"}}>
          <h3 style={{color:"#a855f7",marginTop:0,marginBottom:12}}>📊 Cálculo de probabilidades</h3>
          {[
            ["🎯 Método","Se usa simulación Monte Carlo con 500 escenarios aleatorios para estimar tu probabilidad de ganar el duelo."],
            ["🔄 Simulación","En cada escenario: se completan los dados públicos que faltan con tiradas aleatorias, se generan 2 dados aleatorios para el rival, y se calcula el top-3 score de ambos."],
            ["📈 Tu probabilidad","Es el % de escenarios donde TU score top-3 supera al del rival. Considera los dados que aún no se revelan."],
            ["📉 Prob. del rival","Es el % de escenarios donde el rival te supera. La diferencia hasta 100% son empates (gana la casa)."],
            ["👁️ Con ventaja","Si puedes ver un dado del rival, la simulación usa ese dato real en vez de uno aleatorio. Verás dos barras: tu prob. normal vs. tu prob. con la info extra, para medir cuánto te ayuda la ventaja."],
            ["⚖️ Ejemplo","Si tienes [5,6] y no hay dados públicos aún, la simulación prueba todas las combinaciones posibles de públicos y dados rivales. Resultado: ~70% de ganar."],
          ].map(([t,d])=>(
            <div key={t} style={{marginBottom:10}}>
              <div style={{color:"#aaa",fontWeight:700,fontSize:13}}>{t}</div>
              <div style={{color:"#666",fontSize:12,lineHeight:1.5}}>{d}</div>
            </div>
          ))}
          <Btn onClick={()=>setPanel(null)} style={{width:"100%",marginTop:8}}>Cerrar</Btn>
        </Card>
      </Overlay>

      <Overlay show={panel==="ranking"}>
        <Card style={{maxWidth:360,padding:24,maxHeight:"85vh",overflowY:"auto",animation:"popIn 0.3s ease"}}>
          <h3 style={{color:"#f97316",marginTop:0,marginBottom:12}}>🏅 Ranking</h3>
          {sorted.map((p,i)=>(
            <div key={p.uid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",
              borderBottom:"1px solid #1e1e2e"}}>
              <span style={{color:i===0?"#eab308":i===1?"#aaa":i===2?"#cd7f32":"#555",
                fontWeight:900,fontSize:16,width:24,textAlign:"center"}}>{i+1}</span>
              <span style={{fontSize:20}}>{p.avatar}</span>
              <div style={{flex:1}}>
                <div style={{color:p.uid===playerId?p.color:"#aaa",fontWeight:700,fontSize:13}}>
                  {p.nickname}{p.uid===playerId?" (tú)":""}
                </div>
              </div>
              <span style={{color:"#f97316",fontWeight:900,fontSize:15}}>💰 {p.bal}</span>
            </div>
          ))}
          <Btn onClick={()=>setPanel(null)} style={{width:"100%",marginTop:14}}>Cerrar</Btn>
        </Card>
      </Overlay>

      <Overlay show={panel==="confirm"}>
        <Card style={{maxWidth:320,padding:28,textAlign:"center",animation:"popIn 0.3s ease"}}>
          <div style={{fontSize:48,marginBottom:8}}>🚪</div>
          <h3 style={{color:"#ef4444",marginTop:0}}>¿Salir del juego?</h3>
          <p style={{color:"#666",fontSize:13,marginBottom:20}}>
            Un bot tomará tu lugar y seguirá jugando por ti.
          </p>
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={()=>setPanel(null)} variant="ghost" style={{flex:1}}>Cancelar</Btn>
            <Btn onClick={onLeave} variant="danger" style={{flex:1}}>Salir</Btn>
          </div>
        </Card>
      </Overlay>
    </>
  );
}

function PlayerHeader({ profile, balance, roomCode, partida, total }) {
  return (
    <Card accent={profile?.color} style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:30}}>{profile?.avatar}</span>
          <div>
            <div style={{color:profile?.color,fontWeight:700,fontSize:16}}>{profile?.nickname}</div>
            <div style={{color:"#444",fontSize:11}}>{roomCode} · Partida {partida}/{total}</div>
          </div>
        </div>
        <div>
          <div style={{fontSize:22,fontWeight:900,color:"#f97316"}}>💰 {balance}</div>
          <div style={{fontSize:10,color:"#444",textAlign:"right"}}>fichas</div>
        </div>
      </div>
    </Card>
  );
}

// ─── JOIN FLOW ────────────────────────────────────────────────────────────────
function JoinFlow({ roomCode, onBack }) {
  const [step,    setStep]    = useState("role");
  const [role,    setRole]    = useState(null);
  const [pw,      setPw]      = useState("");
  const [pwErr,   setPwErr]   = useState("");
  const [uid,     setUid]     = useState(null);
  const [profile, setProfile] = useState(null);

  const checkPw = async () => {
    const snap = await get(ref(db,`rooms/${roomCode}/password`));
    if (snap.val()===pw) setStep("profile_gestor");
    else setPwErr("Contraseña incorrecta");
  };

  if (step==="role") return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"40px 20px"}}>
      <GlobalCSS/>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#555",cursor:"pointer",marginBottom:20,fontSize:14}}>← Volver</button>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>SALA</div>
        <div style={{fontSize:28,fontWeight:900,color:"#f97316",fontFamily:"monospace",letterSpacing:4}}>{roomCode}</div>
      </div>
      <h2 style={{color:"#fff",marginBottom:16}}>¿Quién eres?</h2>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {[
          {r:"jugador",label:"Jugador",color:"#f97316",emoji:"🎲",desc:"Participante del experimento"},
          {r:"gestor", label:"Gestor / Investigador",color:"#a855f7",emoji:"🔬",desc:"Control de la sala"},
        ].map(({r,label,color,emoji,desc})=>(
          <button key={r} onClick={()=>{ setRole(r); setStep(r==="gestor"?"pw":"profile_jugador"); }}
            style={{background:"#12121e",border:`1px solid ${color}33`,borderRadius:12,
              padding:"16px 20px",display:"flex",alignItems:"center",gap:14,cursor:"pointer"}}>
            <span style={{fontSize:32}}>{emoji}</span>
            <div style={{textAlign:"left"}}>
              <div style={{color,fontWeight:700,fontSize:16}}>{label}</div>
              <div style={{color:"#444",fontSize:12}}>{desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  if (step==="pw") return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"40px 20px"}}>
      <GlobalCSS/>
      <h2 style={{color:"#a855f7",marginBottom:20}}>🔐 Acceso de Gestor</h2>
      <Card accent="#a855f7">
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
          placeholder="Contraseña del gestor" onKeyDown={e=>e.key==="Enter"&&checkPw()}
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
            padding:"11px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:12,boxSizing:"border-box",outline:"none"}}/>
        {pwErr&&<p style={{color:"#ef4444",fontSize:13,marginBottom:12}}>{pwErr}</p>}
        <Btn onClick={checkPw} variant="purple" style={{width:"100%"}}>Verificar</Btn>
      </Card>
    </div>
  );

  if (step==="profile_jugador") return (
    <ProfileScreen roomCode={roomCode}
      onJoined={(newUid,prof)=>{ setUid(newUid); setProfile(prof); setStep("play"); }}/>
  );

  if (step==="profile_gestor") return (
    <GestorProfileScreen roomCode={roomCode}
      onJoined={prof=>{ setProfile(prof); setStep("play"); }}/>
  );

  if (step==="play") {
    if (role==="gestor") return <GestorScreen roomCode={roomCode}/>;
    return <PlayerScreen roomCode={roomCode} playerId={uid} profile={profile} onLeave={onBack}/>;
  }
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,   setScreen]   = useState("home");
  const [roomCode, setRoomCode] = useState(null);

  if (screen==="home")   return <HomeScreen onGestor={()=>setScreen("create")} onJoin={c=>{ setRoomCode(c); setScreen("join"); }}/>;
  if (screen==="create") return <CreateRoomScreen onCreated={code=>{ setRoomCode(code); setScreen("join"); }}/>;
  if (screen==="join")   return <JoinFlow roomCode={roomCode} onBack={()=>setScreen("home")}/>;
}
