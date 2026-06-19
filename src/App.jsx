import { useState, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  off,
  update,
  push,
  serverTimestamp,
} from "firebase/database";

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
// Reemplaza con tu config de Firebase
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
const db = getDatabase(app);

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const AVATARS = ["🦇","🐺","🕷️","🦉","🐈‍⬛","💀","🐸","🦊","🐙","🐝"];
const COLORS  = ["#f97316","#22c55e","#a855f7","#3b82f6","#ef4444","#eab308","#06b6d4","#ec4899","#14b8a6","#f59e0b"];

// ─── UTILS ────────────────────────────────────────────────────────────────────
const roll   = () => Math.floor(Math.random() * 6) + 1;
const genCode = () => Math.random().toString(36).substring(2,7).toUpperCase();
const calcEV  = (dice) => dice.length ? dice.reduce((a,b)=>a+b,0)/(6*dice.length) : 0;
const sleep   = (ms) => new Promise(r => setTimeout(r, ms));

// Emparejamiento round-robin aleatorizado sin repetir rival
function buildSchedule(playerIds, totalPartidas) {
  const n = playerIds.length;
  const schedule = {}; // schedule[pid] = [rival_pid, ...]
  playerIds.forEach(p => schedule[p] = []);

  // Generar rondas round-robin
  const rounds = [];
  const ids = [...playerIds];
  if (n % 2 !== 0) ids.push("BYE");
  const half = ids.length / 2;
  for (let r = 0; r < ids.length - 1; r++) {
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const a = ids[i], b = ids[ids.length - 1 - i];
      if (a !== "BYE" && b !== "BYE") pairs.push([a, b]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop()); // rotate
  }

  // Llenar hasta totalPartidas repitiendo rondas si es necesario
  let ri = 0;
  for (let p = 0; p < totalPartidas; p++) {
    const round = rounds[ri % rounds.length];
    round.forEach(([a, b]) => {
      if (schedule[a] && schedule[b]) {
        schedule[a].push(b);
        schedule[b].push(a);
      }
    });
    ri++;
  }
  return schedule;
}

// Distribución de fases por jugador por partida
function buildFaseSchedule(playerIds, totalPartidas, cfg) {
  // cfg: { control, yo_trampo, rival_trampa, ambos } — suman totalPartidas
  const fases = {};
  playerIds.forEach(pid => {
    const pool = [
      ...Array(cfg.control   || 0).fill("control"),
      ...Array(cfg.yo_trampo || 0).fill("yo_trampo"),
      ...Array(cfg.rival_trampa || 0).fill("rival_trampa"),
      ...Array(cfg.ambos     || 0).fill("ambos"),
    ];
    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i+1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    fases[pid] = pool.slice(0, totalPartidas);
  });
  return fases;
}

// ─── DADO SVG ─────────────────────────────────────────────────────────────────
const DOTS = {
  1:[[50,50]],2:[[28,28],[72,72]],3:[[28,28],[50,50],[72,72]],
  4:[[28,28],[72,28],[28,72],[72,72]],5:[[28,28],[72,28],[50,50],[28,72],[72,72]],
  6:[[28,22],[72,22],[28,50],[72,50],[28,78],[72,78]],
};

function Die({ value, hidden=false, size=60, color="#f97316", shake=false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100"
      style={{
        borderRadius:14, background: hidden?"#1e1e2e":"#0f0f1a",
        border:`2px solid ${hidden?"#333":color}`,
        boxShadow: hidden ? "none" : `0 0 14px ${color}66`,
        flexShrink:0, transition:"all 0.3s",
        animation: shake ? "shakeDie 0.4s ease" : "none",
      }}>
      {hidden
        ? <text x="50" y="65" textAnchor="middle" fontSize="42" fill="#333">?</text>
        : (DOTS[value]||[]).map(([cx,cy],i) =>
            <circle key={i} cx={cx} cy={cy} r={9} fill={color}/>
          )
      }
    </svg>
  );
}

function DiceRow({ dice, hidden=false, size=56, color="#f97316", shake=false }) {
  return (
    <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
      {dice.map((v,i) => <Die key={i} value={v} hidden={hidden} size={size} color={color} shake={shake}/>)}
    </div>
  );
}

// ─── COMPONENTES UI ───────────────────────────────────────────────────────────
function Card({ children, style={}, accent="#f97316" }) {
  return (
    <div style={{
      background:"#12121e", border:`1px solid ${accent}44`,
      borderRadius:16, padding:"16px 20px",
      boxShadow:`0 0 20px ${accent}11`, ...style,
    }}>{children}</div>
  );
}

function Btn({ children, onClick, variant="primary", disabled=false, style={} }) {
  const V = {
    primary:{bg:"#f97316",color:"#000"},
    success:{bg:"#22c55e",color:"#000"},
    danger: {bg:"#ef4444",color:"#fff"},
    ghost:  {bg:"transparent",color:"#f97316",border:"1px solid #f97316"},
    purple: {bg:"#a855f7",color:"#fff"},
    dark:   {bg:"#1e1e2e",color:"#aaa",border:"1px solid #333"},
  };
  const v = V[variant]||V.primary;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:disabled?"#222":v.bg, color:disabled?"#555":v.color,
      border:v.border||"none", borderRadius:10, padding:"11px 22px",
      fontWeight:700, fontSize:15, cursor:disabled?"not-allowed":"pointer",
      transition:"all 0.15s", fontFamily:"inherit", ...style,
    }}>{children}</button>
  );
}

function EVBar({ value, label, color="#f97316" }) {
  const pct = Math.round(value*100);
  return (
    <div style={{marginBottom:6}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#aaa",marginBottom:3}}>
        <span>{label}</span><span style={{color}}>{pct}%</span>
      </div>
      <div style={{background:"#222",borderRadius:6,height:7}}>
        <div style={{width:`${pct}%`,background:color,borderRadius:6,height:"100%",transition:"width 0.5s"}}/>
      </div>
    </div>
  );
}

function Badge({ children, color="#f97316" }) {
  return (
    <span style={{
      display:"inline-block", padding:"3px 10px", borderRadius:20,
      background:`${color}22`, color, fontSize:12, fontWeight:700,
    }}>{children}</span>
  );
}

function AnimOverlay({ show, children }) {
  if (!show) return null;
  return (
    <div style={{
      position:"fixed", inset:0, background:"#0a0a0fcc",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:100, backdropFilter:"blur(4px)",
      animation:"fadeIn 0.2s ease",
    }}>{children}</div>
  );
}

// ─── PANTALLA: INICIO ─────────────────────────────────────────────────────────
function HomeScreen({ onGestor, onJoin }) {
  const [code, setCode] = useState("");
  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"48px 20px"}}>
      <style>{`
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes fadeIn { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
        @keyframes shakeDie { 0%,100%{transform:rotate(0deg)} 25%{transform:rotate(-8deg)} 75%{transform:rotate(8deg)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{fontSize:72,animation:"float 3s ease-in-out infinite",display:"inline-block"}}>🎃</div>
        <h1 style={{fontSize:34,fontWeight:900,color:"#f97316",margin:"8px 0 0",letterSpacing:-1}}>
          TRICK OR TREAT
        </h1>
        <p style={{color:"#555",marginTop:6,fontSize:13,letterSpacing:1}}>
          EXPERIMENTO · TEORÍA DE JUEGOS · UTEC
        </p>
      </div>
      <Card accent="#a855f7" style={{marginBottom:12}}>
        <p style={{color:"#888",margin:"0 0 12px",fontSize:13}}>¿Eres el investigador?</p>
        <Btn onClick={onGestor} variant="purple" style={{width:"100%"}}>🔬 Crear sala como Gestor</Btn>
      </Card>
      <Card accent="#f97316">
        <p style={{color:"#888",margin:"0 0 12px",fontSize:13}}>¿Eres jugador? Ingresa el código de sala:</p>
        <div style={{display:"flex",gap:8}}>
          <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())}
            placeholder="XXXXX" maxLength={5}
            style={{flex:1,background:"#0a0a0f",border:"1px solid #333",borderRadius:10,
              padding:"11px 14px",color:"#f97316",fontFamily:"monospace",fontSize:22,
              letterSpacing:6,outline:"none",textAlign:"center"}}/>
          <Btn onClick={()=>onJoin(code)} disabled={code.length<4}>Entrar</Btn>
        </div>
      </Card>
    </div>
  );
}

// ─── PANTALLA: CREAR SALA ─────────────────────────────────────────────────────
function CreateRoomScreen({ onCreated }) {
  const [pw, setPw] = useState("");
  const [totalPartidas, setTotalPartidas] = useState(5);
  const [cfg, setCfg] = useState({control:1, yo_trampo:2, rival_trampa:1, ambos:1});
  const [loading, setLoading] = useState(false);
  const suma = Object.values(cfg).reduce((a,b)=>a+b,0);

  const update_ = (k,v) => setCfg(c=>({...c,[k]:Math.max(0,v)}));

  const create = async () => {
    if (!pw) return;
    setLoading(true);
    const code = genCode();
    await set(ref(db,`rooms/${code}`), {
      code, password:pw,
      config:{ totalPartidas, faseConfig:cfg, showEV:false, timerSecs:0, open:false },
      status:{ phase:"lobby", partidaActual:0 },
      players:{}, pairs:{}, faseSchedule:{}, logs:{},
      createdAt: Date.now(),
    });
    setLoading(false);
    onCreated(code, pw);
  };

  return (
    <div style={{maxWidth:460,margin:"0 auto",padding:"36px 20px"}}>
      <h2 style={{color:"#a855f7",marginBottom:20}}>🔬 Nueva Sala Experimental</h2>
      <Card accent="#a855f7" style={{marginBottom:12}}>
        <label style={{color:"#888",fontSize:13,display:"block",marginBottom:6}}>Contraseña del gestor</label>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Solo el gestor la sabe"
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #333",borderRadius:10,
            padding:"10px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:20,boxSizing:"border-box",outline:"none"}}/>

        <label style={{color:"#888",fontSize:13,display:"block",marginBottom:6}}>
          Total de partidas por jugador: <span style={{color:"#f97316"}}>{totalPartidas}</span>
        </label>
        <input type="range" min={2} max={10} value={totalPartidas}
          onChange={e=>setTotalPartidas(+e.target.value)}
          style={{width:"100%",marginBottom:20,accentColor:"#f97316"}}/>

        <div style={{fontSize:13,color:"#888",marginBottom:10}}>
          Distribución de fases{" "}
          <span style={{color: suma===totalPartidas?"#22c55e":"#ef4444",fontWeight:700}}>
            ({suma}/{totalPartidas})
          </span>
        </div>
        {[
          {k:"control",      label:"🎯 Control (sin trampa)",      color:"#aaa"},
          {k:"yo_trampo",    label:"🃏 Yo veo dado rival",          color:"#eab308"},
          {k:"rival_trampa", label:"👁️ Rival ve uno de mis dados", color:"#ef4444"},
          {k:"ambos",        label:"⚔️ Ambos ven un dado rival",    color:"#a855f7"},
        ].map(({k,label,color})=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{flex:1,fontSize:13,color}}>{label}</span>
            <button onClick={()=>update_(k,cfg[k]-1)} style={{background:"#1e1e2e",border:"1px solid #333",
              borderRadius:6,color:"#aaa",width:28,height:28,cursor:"pointer",fontSize:16}}>-</button>
            <span style={{color:"#fff",fontWeight:700,minWidth:20,textAlign:"center"}}>{cfg[k]}</span>
            <button onClick={()=>update_(k,cfg[k]+1)} style={{background:"#1e1e2e",border:"1px solid #333",
              borderRadius:6,color:"#aaa",width:28,height:28,cursor:"pointer",fontSize:16}}>+</button>
          </div>
        ))}

        <Btn onClick={create} disabled={!pw||loading||suma!==totalPartidas} variant="purple" style={{width:"100%",marginTop:8}}>
          {loading?"Creando...":"Crear sala"}
        </Btn>
        {suma!==totalPartidas && <p style={{color:"#ef4444",fontSize:12,marginTop:8,textAlign:"center"}}>
          La suma de fases debe ser igual al total de partidas ({totalPartidas})
        </p>}
      </Card>
    </div>
  );
}

// ─── PANTALLA: PERFIL ─────────────────────────────────────────────────────────
function ProfileScreen({ roomCode, role, onJoined }) {
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [color, setColor] = useState(COLORS[role==="A"?0:role==="B"?1:6]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const join = async () => {
    if (!nickname.trim()) return;
    setLoading(true);
    const snap = await get(ref(db,`rooms/${roomCode}`));
    if (!snap.exists()) { setError("Sala no encontrada"); setLoading(false); return; }
    const room = snap.val();
    const profile = { nickname:nickname.trim(), avatar, color, role, joinedAt:Date.now(), balance:10 };
    await update(ref(db,`rooms/${roomCode}/players/${role}`), profile);
    setLoading(false);
    onJoined(profile);
  };

  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"36px 20px"}}>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>SALA</div>
        <div style={{fontSize:26,fontWeight:900,color:"#f97316",fontFamily:"monospace",letterSpacing:4}}>{roomCode}</div>
        <Badge color={role==="gestor"?"#a855f7":role==="A"?"#3b82f6":"#f97316"}>
          {role==="gestor"?"Gestor":role==="A"?"Jugador A":"Jugador B"}
        </Badge>
      </div>
      <Card>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:80,filter:`drop-shadow(0 0 16px ${color})`,lineHeight:1}}>{avatar}</div>
          <div style={{fontWeight:700,color,fontSize:20,marginTop:6}}>{nickname||"Tu nombre"}</div>
        </div>
        <label style={{color:"#888",fontSize:13,display:"block",marginBottom:6}}>Nickname</label>
        <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Ej: StatsWitch"
          maxLength={16}
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #333",borderRadius:10,
            padding:"10px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:16,boxSizing:"border-box",outline:"none"}}/>

        <label style={{color:"#888",fontSize:13,display:"block",marginBottom:8}}>Avatar</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
          {AVATARS.map(a=>(
            <button key={a} onClick={()=>setAvatar(a)} style={{
              fontSize:26,background:avatar===a?"#1e1e2e":"transparent",
              border:`2px solid ${avatar===a?color:"#2a2a3a"}`,
              borderRadius:10,padding:6,cursor:"pointer",transition:"all 0.15s",
            }}>{a}</button>
          ))}
        </div>

        <label style={{color:"#888",fontSize:13,display:"block",marginBottom:8}}>Color</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
          {COLORS.map(c=>(
            <button key={c} onClick={()=>setColor(c)} style={{
              width:30,height:30,background:c,borderRadius:"50%",
              border:`3px solid ${color===c?"#fff":"transparent"}`,cursor:"pointer",
            }}/>
          ))}
        </div>

        {error && <p style={{color:"#ef4444",fontSize:13,marginBottom:12}}>{error}</p>}
        <Btn onClick={join} disabled={!nickname.trim()||loading} style={{width:"100%"}}>
          {loading?"Entrando...":"Entrar al juego 🎃"}
        </Btn>
      </Card>
    </div>
  );
}

// ─── PANTALLA: GESTOR ─────────────────────────────────────────────────────────
function GestorScreen({ roomCode, profile }) {
  const [room, setRoom] = useState(null);
  const [tab, setTab] = useState("control");
  const [cfgLocal, setCfgLocal] = useState(null);

  useEffect(()=>{
    const r = ref(db,`rooms/${roomCode}`);
    const unsub = onValue(r, snap=>{ if(snap.exists()) { const d=snap.val(); setRoom(d); if(!cfgLocal) setCfgLocal(d.config); }});
    return ()=>off(r);
  },[roomCode]);

  const openRoom  = ()=>update(ref(db,`rooms/${roomCode}/config`),{open:true});
  const closeRoom = ()=>update(ref(db,`rooms/${roomCode}/config`),{open:false});

  const startExperiment = async () => {
    const players = Object.keys(room.players||{}).filter(k=>k!=="gestor");
    if (players.length < 2) { alert("Necesitas al menos 2 jugadores"); return; }
    const tp = room.config.totalPartidas;
    const schedule  = buildSchedule(players, tp);
    const faseSchedule = buildFaseSchedule(players, tp, room.config.faseConfig);
    // Inicializar balance
    const balanceInit = {};
    players.forEach(p=>{ balanceInit[p]=10; });
    await update(ref(db,`rooms/${roomCode}`),{
      pairs: schedule,
      faseSchedule,
      "status/phase":"playing",
      "status/partidaActual":1,
      balance: balanceInit,
    });
    // Lanzar primera partida
    await launchPartida(1, players, schedule, faseSchedule, room.config.totalPartidas);
  };

  const launchPartida = async (numPartida, players, schedule, faseSchedule, totalPartidas) => {
    if (numPartida > totalPartidas) {
      await update(ref(db,`rooms/${roomCode}/status`),{phase:"finished"});
      return;
    }
    // Para cada par en esta partida
    const idx = numPartida - 1;
    const partidaData = {};
    const done = new Set();
    players.forEach(pid=>{
      if (done.has(pid)) return;
      const rival = (schedule[pid]||[])[idx];
      if (!rival || done.has(rival)) return;
      done.add(pid); done.add(rival);
      const pairKey = [pid,rival].sort().join("_");
      const faseA = (faseSchedule[pid]||[])[idx]||"control";
      const faseB = (faseSchedule[rival]||[])[idx]||"control";
      const privA = [roll(),roll()];
      const privB = [roll(),roll()];
      const pub1  = roll();
      const pub2  = roll();
      partidaData[pairKey] = {
        jugadores:[pid,rival],
        dados:{ [pid]:privA, [rival]:privB },
        publicos:[pub1,pub2],
        fases:{ [pid]:faseA, [rival]:faseB },
        ronda:1,
        pot:2,
        decisiones:{},
        resultado:null,
        startedAt:Date.now(),
      };
    });
    await update(ref(db,`rooms/${roomCode}/partidas/${numPartida}`), partidaData);
    await update(ref(db,`rooms/${roomCode}/status`),{
      phase:"playing", partidaActual:numPartida,
    });
  };

  const nextPartida = async () => {
    const snap = await get(ref(db,`rooms/${roomCode}`));
    const r = snap.val();
    const players = Object.keys(r.players||{}).filter(k=>k!=="gestor");
    const next = (r.status?.partidaActual||1)+1;
    await update(ref(db,`rooms/${roomCode}/status`),{partidaActual:next,phase:next>r.config.totalPartidas?"finished":"playing"});
    if (next<=r.config.totalPartidas)
      await launchPartida(next, players, r.pairs, r.faseSchedule, r.config.totalPartidas);
  };

  const resetSession = async ()=>{
    const players = Object.keys(room?.players||{}).filter(k=>k!=="gestor");
    const bal={};  players.forEach(p=>{bal[p]=10;});
    await update(ref(db,`rooms/${roomCode}`),{
      partidas:null, logs:null, balance:bal,
      "status/phase":"lobby","status/partidaActual":0,
      pairs:null, faseSchedule:null,
    });
  };

  const saveConfig = async ()=>{
    await update(ref(db,`rooms/${roomCode}/config`),cfgLocal);
  };

  const exportCSV = ()=>{
    const logs = Object.values(room?.logs||{}).sort((a,b)=>a.ts-b.ts);
    if (!logs.length) return;
    const cols=["partida","pairKey","jugador","rival","accion","ronda","ev","tiempo_ms","fase","suma_propia","suma_publica","resultado"];
    const rows=logs.map(l=>cols.map(c=>l[c]??"").join(","));
    const csv=[cols.join(","),...rows].join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a=document.createElement("a"); a.href=url; a.download=`tot_${roomCode}.csv`; a.click();
  };

  if (!room) return <div style={{color:"#666",padding:40,textAlign:"center"}}>Cargando sala…</div>;
  const {config,status,players,balance,partidas,logs:logsObj}=room;
  const logs=Object.values(logsObj||{}).sort((a,b)=>a.ts-b.ts);
  const allPlayers=Object.entries(players||{}).filter(([k])=>k!=="gestor");
  const phase=status?.phase||"lobby";
  const partidaActual=status?.partidaActual||0;
  const partidaData=partidas?.[partidaActual]||{};

  const TABS=[{id:"control",label:"🎮 Control"},{id:"partidas",label:"🎲 Partidas"},{id:"datos",label:"📊 Datos"},{id:"config",label:"⚙️ Config"}];

  return (
    <div style={{maxWidth:720,margin:"0 auto",padding:"20px 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>GESTOR · SALA</div>
          <div style={{fontSize:24,fontWeight:900,color:"#a855f7",fontFamily:"monospace",letterSpacing:3}}>{roomCode}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Badge color={config?.open?"#22c55e":"#ef4444"}>{config?.open?"● ABIERTA":"● CERRADA"}</Badge>
          <Badge color={phase==="playing"?"#f97316":phase==="finished"?"#22c55e":"#666"}>
            {phase==="lobby"?"LOBBY":phase==="playing"?`PARTIDA ${partidaActual}/${config?.totalPartidas}`:"FINALIZADO"}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:16,background:"#1e1e2e",borderRadius:12,padding:4}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1,padding:"8px 4px",background:tab===t.id?"#a855f7":"transparent",
            border:"none",borderRadius:8,color:tab===t.id?"#fff":"#666",
            fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",
          }}>{t.label}</button>
        ))}
      </div>

      {/* TAB CONTROL */}
      {tab==="control" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card accent="#a855f7">
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {!config?.open
                ? <Btn onClick={openRoom} variant="success">Abrir sala</Btn>
                : <Btn onClick={closeRoom} variant="danger">Cerrar sala</Btn>}
              {phase==="lobby" && config?.open &&
                <Btn onClick={startExperiment} variant="primary">▶ Iniciar experimento</Btn>}
              {phase==="playing" &&
                <Btn onClick={nextPartida}>⏭ Siguiente partida</Btn>}
              <Btn onClick={resetSession} variant="ghost">↺ Reiniciar sesión</Btn>
            </div>
          </Card>

          {/* Jugadores en sala */}
          <Card>
            <div style={{fontSize:12,color:"#666",marginBottom:10}}>
              JUGADORES EN SALA ({allPlayers.length})
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {allPlayers.map(([pid,p])=>(
                <div key={pid} style={{
                  background:"#1e1e2e",borderRadius:10,padding:"8px 14px",
                  border:`1px solid ${p.color}44`,
                  display:"flex",alignItems:"center",gap:8,
                }}>
                  <span style={{fontSize:22}}>{p.avatar}</span>
                  <div>
                    <div style={{color:p.color,fontWeight:700,fontSize:14}}>{p.nickname}</div>
                    <div style={{color:"#555",fontSize:11}}>💰 {balance?.[pid]??10} fichas</div>
                  </div>
                </div>
              ))}
              {allPlayers.length===0 && <span style={{color:"#444",fontSize:13}}>Esperando jugadores…</span>}
            </div>
          </Card>

          {/* Estado partida actual */}
          {phase==="playing" && Object.entries(partidaData).map(([pairKey,pd])=>{
            const [pA,pB]=pd.jugadores||[];
            const pAInfo=players?.[pA]; const pBInfo=players?.[pB];
            return (
              <Card key={pairKey} accent="#f97316">
                <div style={{fontSize:11,color:"#666",marginBottom:8}}>PAR · {pairKey}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {[[pA,pAInfo],[pB,pBInfo]].map(([pid,pl])=>(
                    <div key={pid}>
                      <div style={{color:pl?.color,fontWeight:700}}>{pl?.avatar} {pl?.nickname}</div>
                      <div style={{fontSize:12,color:"#666"}}>Fase: {pd.fases?.[pid]||"-"}</div>
                      <div style={{fontSize:12,color:"#666"}}>Dados: {(pd.dados?.[pid]||[]).join(" | ")}</div>
                      <div style={{fontSize:12,color:"#aaa"}}>
                        Decisión R{pd.ronda}: {pd.decisiones?.[`${pd.ronda}_${pid}`]||"⏳"}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8,fontSize:12,color:"#a855f7"}}>
                  Públicos: {(pd.publicos||[]).map((v,i)=>i<(pd.ronda||1)-1?v:"?").join(" | ")} · Ronda {pd.ronda}/4 · Pozo {pd.pot}
                </div>
                {pd.resultado && <div style={{marginTop:6,fontWeight:700,color:"#22c55e"}}>✓ {pd.resultado}</div>}
              </Card>
            );
          })}
          {phase==="finished" && (
            <Card style={{textAlign:"center",padding:32}}>
              <div style={{fontSize:48,marginBottom:8}}>🏆</div>
              <h2 style={{color:"#22c55e"}}>Experimento completado</h2>
              <p style={{color:"#666",fontSize:14}}>Descarga los datos en la pestaña Datos</p>
            </Card>
          )}
        </div>
      )}

      {/* TAB PARTIDAS */}
      {tab==="partidas" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {Array.from({length:config?.totalPartidas||5},(_,i)=>i+1).map(n=>{
            const pd=partidas?.[n]||{};
            const done=n<partidaActual;
            const current=n===partidaActual;
            return (
              <Card key={n} accent={current?"#f97316":done?"#22c55e44":"#333"}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontWeight:700,color:current?"#f97316":done?"#22c55e":"#555"}}>
                    Partida {n} {current&&"← actual"} {done&&"✓"}
                  </div>
                  <Badge color={current?"#f97316":done?"#22c55e":"#555"}>
                    {current?"EN JUEGO":done?"COMPLETADA":"PENDIENTE"}
                  </Badge>
                </div>
                {Object.entries(pd).map(([pk,d])=>(
                  <div key={pk} style={{fontSize:12,color:"#666",marginTop:4}}>
                    {(d.jugadores||[]).map(p=>players?.[p]?.nickname||p).join(" vs ")}
                    {d.resultado&&<span style={{color:"#22c55e"}}> → {d.resultado}</span>}
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}

      {/* TAB DATOS */}
      {tab==="datos" && (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{color:"#aaa",fontSize:13}}>{logs.length} eventos</span>
            <Btn onClick={exportCSV} variant="success" style={{fontSize:13,padding:"7px 16px"}}>⬇ Exportar CSV</Btn>
          </div>
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
                <thead>
                  <tr>{["Par","Jugador","Acción","Ronda","EV","Tiempo","Fase","Resultado"].map(h=>(
                    <th key={h} style={{color:"#555",padding:"5px 8px",textAlign:"left",borderBottom:"1px solid #222"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {logs.slice(-60).reverse().map((l,i)=>(
                    <tr key={i} style={{borderBottom:"1px solid #1a1a2a"}}>
                      <td style={{padding:"4px 8px",color:"#555"}}>{l.pairKey}</td>
                      <td style={{padding:"4px 8px",color:players?.[l.jugador]?.color||"#aaa",fontWeight:700}}>
                        {players?.[l.jugador]?.nickname||l.jugador}
                      </td>
                      <td style={{padding:"4px 8px",color:l.accion==="apostar"?"#22c55e":"#ef4444"}}>{l.accion}</td>
                      <td style={{padding:"4px 8px",color:"#aaa"}}>{l.ronda}</td>
                      <td style={{padding:"4px 8px",color:"#a855f7"}}>{((l.ev||0)*100).toFixed(0)}%</td>
                      <td style={{padding:"4px 8px",color:"#aaa"}}>{l.tiempo_ms}</td>
                      <td style={{padding:"4px 8px",color:"#666"}}>{l.fase}</td>
                      <td style={{padding:"4px 8px",color:"#22c55e"}}>{l.resultado||""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!logs.length&&<div style={{color:"#444",padding:20,textAlign:"center"}}>Sin datos aún</div>}
            </div>
          </Card>
        </div>
      )}

      {/* TAB CONFIG */}
      {tab==="config" && cfgLocal && (
        <Card accent="#a855f7">
          <div style={{fontSize:12,color:"#666",marginBottom:16}}>CONFIGURACIÓN DE SALA</div>

          <label style={{color:"#888",fontSize:13,display:"flex",alignItems:"center",gap:10,marginBottom:14,cursor:"pointer"}}>
            <input type="checkbox" checked={cfgLocal.showEV||false}
              onChange={e=>setCfgLocal(c=>({...c,showEV:e.target.checked}))}
              style={{accentColor:"#f97316",width:16,height:16}}/>
            Mostrar barra de Ventaja Esperada (EV) a los jugadores
          </label>

          <label style={{color:"#888",fontSize:13,display:"block",marginBottom:6}}>
            Temporizador por ronda: <span style={{color:"#f97316"}}>
              {cfgLocal.timerSecs===0?"Sin límite":`${cfgLocal.timerSecs}s`}
            </span>
          </label>
          <input type="range" min={0} max={60} step={5} value={cfgLocal.timerSecs||0}
            onChange={e=>setCfgLocal(c=>({...c,timerSecs:+e.target.value}))}
            style={{width:"100%",marginBottom:20,accentColor:"#f97316"}}/>

          <Btn onClick={saveConfig} variant="purple" style={{width:"100%",marginBottom:20}}>
            Guardar configuración
          </Btn>

          <hr style={{border:"none",borderTop:"1px solid #222",margin:"16px 0"}}/>
          <div style={{fontSize:12,color:"#666",marginBottom:8}}>CÓDIGO PARA COMPARTIR</div>
          <div style={{fontFamily:"monospace",fontSize:32,letterSpacing:8,color:"#f97316",
            fontWeight:900,background:"#0a0a0f",padding:"12px 20px",borderRadius:10,textAlign:"center"}}>
            {roomCode}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── PANTALLA: JUGADOR ────────────────────────────────────────────────────────
function PlayerScreen({ roomCode, playerId, profile }) {
  const [room, setRoom] = useState(null);
  const [anim, setAnim] = useState(null); // "rolling"|"waiting"|"result"|"next"
  const [animMsg, setAnimMsg] = useState("");
  const [decidido, setDecidido] = useState(false);
  const [timerLeft, setTimerLeft] = useState(null);
  const timerRef = useRef(null);
  const prevRondaRef = useRef(null);
  const prevPartidaRef = useRef(null);

  useEffect(()=>{
    const r=ref(db,`rooms/${roomCode}`);
    const unsub=onValue(r,snap=>{ if(snap.exists()) setRoom(snap.val()); });
    return ()=>off(r);
  },[roomCode]);

  // Detectar cambio de ronda → animación
  useEffect(()=>{
    if (!room) return;
    const status=room.status||{};
    const n=status.partidaActual||0;
    const myPair=getMyPair(room,n);
    if (!myPair) return;
    const ronda=myPair.ronda||1;

    if (prevRondaRef.current!==null && ronda!==prevRondaRef.current) {
      setDecidido(false);
      if (ronda<=3) {
        setAnim("rolling");
        setAnimMsg(ronda===1?"🎲 ¡Tus dados han sido lanzados!":ronda===2?"🌐 Se revela el primer dado público":"🌐 Se revela el segundo dado público");
        setTimeout(()=>setAnim(null),1800);
      }
    }
    if (prevPartidaRef.current!==null && n!==prevPartidaRef.current) {
      setDecidido(false);
    }
    prevRondaRef.current=ronda;
    prevPartidaRef.current=n;
  },[room]);

  // Timer
  useEffect(()=>{
    if (!room) return;
    const timerSecs=room.config?.timerSecs||0;
    if (!timerSecs) { setTimerLeft(null); return; }
    const myPair=getMyPair(room,room.status?.partidaActual||0);
    if (!myPair||myPair.resultado) { setTimerLeft(null); return; }
    const elapsed=Math.floor((Date.now()-(myPair.startedAt||Date.now()))/1000);
    const left=Math.max(0,timerSecs-elapsed);
    setTimerLeft(left);
    clearInterval(timerRef.current);
    timerRef.current=setInterval(()=>setTimerLeft(l=>Math.max(0,(l||0)-1)),1000);
    return ()=>clearInterval(timerRef.current);
  },[room?.status?.partidaActual, room?.config?.timerSecs]);

  const getMyPair = (r,n) => {
    const partidas=r?.partidas?.[n]||{};
    return Object.values(partidas).find(p=>(p.jugadores||[]).includes(playerId))||null;
  };

  const decidir = async (accion) => {
    if (decidido) return;
    const n=room.status?.partidaActual||0;
    const partidas=room.partidas?.[n]||{};
    const pairKey=Object.keys(partidas).find(k=>(partidas[k].jugadores||[]).includes(playerId));
    if (!pairKey) return;
    const pd=partidas[pairKey];
    const ronda=pd.ronda||1;
    const myDice=pd.dados?.[playerId]||[];
    const pubVisible=(pd.publicos||[]).slice(0,ronda-1);
    const ev=calcEV([...myDice,...pubVisible]);
    const tiempo=Date.now()-(pd.startedAt||Date.now());

    setDecidido(true);
    setAnim("waiting");
    setAnimMsg("Esperando al otro jugador…");

    const decKey=`${ronda}_${playerId}`;
    await update(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}/decisiones`),{[decKey]:accion});

    // Log
    const logRef=push(ref(db,`rooms/${roomCode}/logs`));
    const rival=(pd.jugadores||[]).find(j=>j!==playerId);
    const fase=pd.fases?.[playerId]||"control";
    await set(logRef,{
      partida:n, pairKey, jugador:playerId, rival,
      accion, ronda, ev, tiempo_ms:tiempo, fase,
      suma_propia:myDice.reduce((a,b)=>a+b,0),
      suma_publica:pubVisible.reduce((a,b)=>a+b,0),
      resultado:null, ts:Date.now(),
    });

    // Verificar si ambos decidieron
    const rival_=(pd.jugadores||[]).find(j=>j!==playerId);
    const rivalDec=pd.decisiones?.[`${ronda}_${rival_}`];
    const myDec=accion;

    if (rivalDec) {
      setAnim(null);
      await resolveRonda(n, pairKey, pd, ronda, playerId, myDec, rival_, rivalDec);
    }
  };

  const resolveRonda = async (n,pairKey,pd,ronda,pidA,decA,pidB,decB)=>{
    // Retirada de cualquiera
    if (decA==="retirarse"||decB==="retirarse") {
      const ganador=decA==="retirarse"?pidB:pidA;
      await finalizarPartida(n,pairKey,pd,ganador,"Retirada");
      return;
    }
    // Ambos apostaron
    const pot=(pd.pot||2)+2; // cada uno apuesta 1
    await update(ref(db,`rooms/${roomCode}`),{
      [`balance/${pidA}`]:(room.balance?.[pidA]||10)-1,
      [`balance/${pidB}`]:(room.balance?.[pidB]||10)-1,
    });
    if (ronda>=3) {
      // Evaluar ganador
      const dA=pd.dados?.[pidA]||[]; const dB=pd.dados?.[pidB]||[];
      const pub=pd.publicos||[];
      const sA=dA.reduce((a,b)=>a+b,0)+pub.reduce((a,b)=>a+b,0);
      const sB=dB.reduce((a,b)=>a+b,0)+pub.reduce((a,b)=>a+b,0);
      const tresunosA=[...dA,...pub].filter(v=>v===1).length>=3;
      const tresunosB=[...dB,...pub].filter(v=>v===1).length>=3;
      let ganador;
      if (tresunosA&&!tresunosB) ganador=pidA;
      else if (tresunosB&&!tresunosA) ganador=pidB;
      else if (sA>sB) ganador=pidA;
      else if (sB>sA) ganador=pidB;
      else ganador="empate";
      await update(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}`),{pot,ronda:4});
      await finalizarPartida(n,pairKey,{...pd,pot},ganador,"Suma final");
    } else {
      await update(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}`),{
        pot, ronda:ronda+1, startedAt:Date.now(), decisiones:{},
      });
    }
  };

  const finalizarPartida = async (n,pairKey,pd,ganador,motivo)=>{
    const [p1,p2]=pd.jugadores||[];
    const pot=pd.pot||2;
    let b1=room.balance?.[p1]||10, b2=room.balance?.[p2]||10;
    let res;
    if (ganador==="empate") {
      b1+=Math.floor(pot/2); b2+=Math.floor(pot/2);
      res="Empate";
    } else {
      if (ganador===p1) b1+=pot; else b2+=pot;
      const gNick=room.players?.[ganador]?.nickname||ganador;
      res=`Ganó ${gNick} (${motivo})`;
    }
    await update(ref(db,`rooms/${roomCode}`),{
      [`balance/${p1}`]:b1, [`balance/${p2}`]:b2,
      [`partidas/${n}/${pairKey}/resultado`]:res,
      [`partidas/${n}/${pairKey}/ronda`]:4,
    });
    // Actualizar log resultado
    const logRef=push(ref(db,`rooms/${roomCode}/logs`));
    await set(logRef,{
      partida:n,pairKey,jugador:ganador,accion:"resultado",
      ronda:4,ev:0,tiempo_ms:0,fase:pd.fases?.[ganador]||"control",
      resultado:res,ts:Date.now(),
    });
  };

  // ── RENDER ──
  if (!room) return <Loading msg="Conectando…"/>;
  const {config,status,players,balance}=room;
  const phase=status?.phase||"lobby";
  const n=status?.partidaActual||0;
  const myPair=getMyPair(room,n);
  const myBalance=balance?.[playerId]??10;
  const myColor=profile?.color||"#f97316";

  // Datos de la partida actual
  let rival_,myDice=[],pubDice=[],pot=0,ronda=1,resultado=null,fase="control",canCheat=false,rivalDice=[];
  if (myPair) {
    rival_=(myPair.jugadores||[]).find(j=>j!==playerId);
    myDice=myPair.dados?.[playerId]||[];
    const pubAll=myPair.publicos||[];
    ronda=myPair.ronda||1;
    pubDice=pubAll.map((v,i)=>({value:v,visible:i<ronda-1}));
    pot=myPair.pot||0;
    resultado=myPair.resultado||null;
    fase=myPair.fases?.[playerId]||"control";
    canCheat=fase==="yo_trampo"||fase==="ambos";
    rivalDice=myPair.dados?.[rival_]||[];
  }
  const rivalInfo=players?.[rival_];
  const myDiceSum=myDice.reduce((a,b)=>a+b,0);
  const pubSum=pubDice.filter(d=>d.visible).map(d=>d.value).reduce((a,b)=>a+b,0);
  const totalVisible=myDiceSum+pubSum;
  const ev=myDice.length?calcEV([...myDice,...pubDice.filter(d=>d.visible).map(d=>d.value)]):0;
  const yaDecidio=decidido||(myPair&&myPair.decisiones?.[`${ronda}_${playerId}`]);
  const rivalYaDecidio=myPair&&myPair.decisiones?.[`${ronda}_${rival_}`];

  if (phase==="lobby" || phase==="finished") {
    return (
      <div style={{maxWidth:420,margin:"0 auto",padding:"40px 20px",textAlign:"center"}}>
        <div style={{fontSize:64,marginBottom:16,animation:"float 3s ease-in-out infinite",display:"inline-block"}}>
          {phase==="finished"?"🏆":"🎃"}
        </div>
        <h2 style={{color:phase==="finished"?"#22c55e":"#f97316"}}>
          {phase==="finished"?"¡Experimento terminado!":"Esperando al gestor…"}
        </h2>
        <Card style={{marginTop:20}}>
          <div style={{fontSize:36}}>{profile?.avatar}</div>
          <div style={{color:myColor,fontWeight:700,fontSize:18,marginTop:6}}>{profile?.nickname}</div>
          <div style={{color:"#555",fontSize:13}}>Sala {roomCode}</div>
          <div style={{marginTop:12,fontSize:22,fontWeight:900,color:"#f97316"}}>💰 {myBalance} fichas</div>
        </Card>
      </div>
    );
  }

  if (!myPair) {
    return (
      <div style={{maxWidth:420,margin:"0 auto",padding:"60px 20px",textAlign:"center"}}>
        <div style={{fontSize:48,animation:"pulse 1.5s infinite",display:"inline-block"}}>⏳</div>
        <p style={{color:"#666",marginTop:16}}>Esperando emparejamiento…</p>
      </div>
    );
  }

  if (resultado) {
    const gane=resultado.includes(profile?.nickname||"");
    const empate=resultado.includes("Empate");
    return (
      <div style={{maxWidth:420,margin:"0 auto",padding:"24px 16px"}}>
        <AnimOverlay show={true}>
          <Card style={{maxWidth:340,textAlign:"center",padding:40,animation:"fadeIn 0.3s ease"}}>
            <div style={{fontSize:72,marginBottom:12}}>
              {empate?"🤝":gane?"🏆":"💀"}
            </div>
            <h2 style={{color:empate?"#aaa":gane?"#22c55e":"#ef4444",marginBottom:8}}>
              {empate?"¡Empate!":gane?"¡Ganaste!":"¡Perdiste!"}
            </h2>
            <p style={{color:"#888",fontSize:13,marginBottom:16}}>{resultado}</p>
            <div style={{fontSize:22,fontWeight:900,color:"#f97316",marginBottom:20}}>
              💰 {myBalance} fichas
            </div>
            <div style={{fontSize:12,color:"#555",marginBottom:4}}>Mis dados: {myDice.join(" + ")} = {myDiceSum}</div>
            <div style={{fontSize:12,color:"#555"}}>Dados públicos: {(myPair.publicos||[]).join(" + ")} = {(myPair.publicos||[]).reduce((a,b)=>a+b,0)}</div>
            <div style={{fontSize:13,color:"#888",marginTop:8}}>Total: {myDiceSum+(myPair.publicos||[]).reduce((a,b)=>a+b,0)}</div>
            <Btn onClick={()=>setAnim(null)} variant="ghost" style={{marginTop:20,width:"100%"}}>
              Ver pantalla
            </Btn>
          </Card>
        </AnimOverlay>

        <PlayerHeader profile={profile} balance={myBalance} roomCode={roomCode} partida={n} totalPartidas={config?.totalPartidas}/>
        <Card style={{marginTop:12,textAlign:"center",padding:32}}>
          <div style={{fontSize:14,color:"#666"}}>Partida {n} finalizada</div>
          <div style={{fontSize:13,color:"#555",marginTop:4}}>Espera al gestor para continuar</div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"16px 16px 80px"}}>
      {/* Animación overlay */}
      <AnimOverlay show={anim==="rolling"}>
        <div style={{textAlign:"center",animation:"fadeIn 0.2s ease"}}>
          <div style={{fontSize:80,animation:"shakeDie 0.4s ease infinite",display:"inline-block"}}>🎲</div>
          <div style={{color:"#f97316",fontWeight:700,fontSize:18,marginTop:12}}>{animMsg}</div>
        </div>
      </AnimOverlay>

      <AnimOverlay show={anim==="waiting"}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:48,animation:"pulse 1s infinite",display:"inline-block"}}>⏳</div>
          <div style={{color:"#aaa",fontSize:16,marginTop:12}}>{animMsg}</div>
        </div>
      </AnimOverlay>

      <PlayerHeader profile={profile} balance={myBalance} roomCode={roomCode} partida={n} totalPartidas={config?.totalPartidas}/>

      {/* Timer */}
      {timerLeft!==null && (
        <div style={{textAlign:"center",margin:"8px 0"}}>
          <span style={{
            fontFamily:"monospace",fontSize:20,fontWeight:900,
            color:timerLeft<=5?"#ef4444":"#aaa",
          }}>{timerLeft}s</span>
        </div>
      )}

      {/* Ronda */}
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        {[1,2,3,4].map(r=>(
          <div key={r} style={{flex:1,textAlign:"center",padding:"8px 4px",borderRadius:10,
            background:ronda>r?"#22c55e22":ronda===r?"#f9731622":"#1e1e2e",
            border:`1px solid ${ronda>r?"#22c55e44":ronda===r?"#f97316":"#2a2a3a"}`,
          }}>
            <div style={{fontSize:10,color:"#555"}}>R{r}</div>
            <div style={{fontSize:11,fontWeight:700,color:ronda>r?"#22c55e":ronda===r?"#f97316":"#333"}}>
              {r===1?"Dados":r===2?"Pub1":r===3?"Pub2":"Final"}
            </div>
          </div>
        ))}
      </div>

      {/* Mis dados */}
      <Card accent={myColor} style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#666",marginBottom:8}}>TUS DADOS</div>
        <DiceRow dice={myDice.length?myDice:[1,1]} hidden={myDice.length===0} size={58} color={myColor} shake={anim==="rolling"}/>
        <div style={{marginTop:12,display:"flex",justifyContent:"center",gap:8,alignItems:"center"}}>
          <span style={{color:"#666",fontSize:13}}>Suma:</span>
          {myDice.map((v,i)=>(
            <span key={i} style={{color:myColor,fontWeight:700}}>{v}</span>
          )).reduce((acc,el,i)=>i===0?[el]:[...acc,<span key={`p${i}`} style={{color:"#444"}}>+</span>,el],[])}
          {pubDice.filter(d=>d.visible).map((d,i)=>(
            <span key={`pub${i}`} style={{color:"#22c55e",fontWeight:700}}>+{d.value}</span>
          ))}
          <span style={{color:"#fff",fontWeight:900,fontSize:18}}>=&nbsp;{totalVisible}</span>
        </div>
        {config?.showEV && <div style={{marginTop:10}}><EVBar value={ev} label="Ventaja esperada" color={myColor}/></div>}
      </Card>

      {/* Mesa pública */}
      <Card accent="#22c55e" style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#666",marginBottom:8}}>DADOS PÚBLICOS</div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          {pubDice.map((d,i)=>(
            <Die key={i} value={d.value} hidden={!d.visible} size={52} color="#22c55e" glow={d.visible}/>
          ))}
        </div>
      </Card>

      {/* Rival + trampa */}
      <Card accent={canCheat?"#eab308":"#2a2a3a"} style={{marginBottom:10}}>
        <div style={{fontSize:11,color:canCheat?"#eab308":"#555",marginBottom:8}}>
          {canCheat?"🃏 VES UN DADO DEL RIVAL":"RIVAL"}
        </div>
        {rivalInfo&&(
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span style={{fontSize:22}}>{rivalInfo.avatar}</span>
            <span style={{color:rivalInfo.color,fontWeight:700}}>{rivalInfo.nickname}</span>
            {rivalYaDecidio&&<Badge color="#22c55e">✓ Decidió</Badge>}
          </div>
        )}
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <Die value={rivalDice[0]} hidden={!canCheat} size={48} color="#eab308" glow={canCheat}/>
          <Die value={rivalDice[1]} hidden={true} size={48}/>
        </div>
      </Card>

      {/* Pozo */}
      <div style={{textAlign:"center",margin:"10px 0",color:"#a855f7",fontWeight:700,fontSize:16}}>
        🏆 Pozo: {pot} fichas
      </div>

      {/* Acciones */}
      {ronda<=3 && !resultado && (
        yaDecidio ? (
          <Card style={{textAlign:"center",padding:20,background:"#1a1a2a"}}>
            <div style={{color:"#666",fontSize:13,animation:"pulse 1.5s infinite"}}>
              ⏳ Esperando al otro jugador…
            </div>
          </Card>
        ) : (
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <Btn onClick={()=>decidir("apostar")} variant="success"
              style={{flex:1,fontSize:16,padding:"14px 0",borderRadius:12}}>
              💰 Apostar +1
            </Btn>
            <Btn onClick={()=>decidir("retirarse")} variant="danger"
              style={{flex:1,fontSize:16,padding:"14px 0",borderRadius:12}}>
              🏳 Retirarse
            </Btn>
          </div>
        )
      )}

      {ronda>=4 && !resultado && (
        <Card style={{textAlign:"center",padding:20}}>
          <div style={{color:"#666",fontSize:13,animation:"pulse 1.5s infinite"}}>⏳ Calculando resultado…</div>
        </Card>
      )}
    </div>
  );
}

function PlayerHeader({ profile, balance, roomCode, partida, totalPartidas }) {
  return (
    <Card accent={profile?.color} style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:28}}>{profile?.avatar}</span>
          <div>
            <div style={{color:profile?.color,fontWeight:700,fontSize:16}}>{profile?.nickname}</div>
            <div style={{color:"#555",fontSize:11}}>Sala {roomCode} · Partida {partida}/{totalPartidas}</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:22,fontWeight:900,color:"#f97316"}}>💰 {balance}</div>
          <div style={{fontSize:10,color:"#555"}}>fichas</div>
        </div>
      </div>
    </Card>
  );
}

function Loading({ msg }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      minHeight:"60vh",color:"#666",gap:16}}>
      <div style={{fontSize:40,animation:"spin 1s linear infinite",display:"inline-block"}}>⚙️</div>
      <div>{msg}</div>
    </div>
  );
}

// ─── FLUJO DE UNIRSE ──────────────────────────────────────────────────────────
function JoinFlow({ roomCode, onBack }) {
  const [step, setStep] = useState("role");
  const [role, setRole] = useState(null);
  const [pw, setPw] = useState("");
  const [profile, setProfile] = useState(null);
  const [pwErr, setPwErr] = useState("");

  const checkPw = async ()=>{
    const snap=await get(ref(db,`rooms/${roomCode}/password`));
    if(snap.val()===pw) setStep("profile");
    else setPwErr("Contraseña incorrecta");
  };

  const chooseRole=(r)=>{ setRole(r); setStep(r==="gestor"?"pw":"profile"); };

  // Generar ID único para jugadores (no gestor)
  const getPlayerId = (r, prof) => {
    if (r==="gestor") return "gestor";
    // Usar nickname como ID (simplificado; en prod usar UUID)
    return prof?.nickname?.toLowerCase().replace(/\s+/g,"")||r;
  };

  if (step==="role") return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"40px 20px"}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#666",cursor:"pointer",marginBottom:20,fontSize:14}}>
        ← Volver
      </button>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>SALA</div>
        <div style={{fontSize:28,fontWeight:900,color:"#f97316",fontFamily:"monospace",letterSpacing:4}}>{roomCode}</div>
      </div>
      <h2 style={{color:"#fff",marginBottom:16}}>¿Quién eres?</h2>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {[
          {r:"jugador",label:"Jugador",color:"#f97316",emoji:"🎲",desc:"Entra al experimento"},
          {r:"gestor", label:"Gestor / Investigador",color:"#a855f7",emoji:"🔬",desc:"Control total de la sala"},
        ].map(({r,label,color,emoji,desc})=>(
          <button key={r} onClick={()=>chooseRole(r)} style={{
            background:"#12121e",border:`1px solid ${color}44`,borderRadius:12,
            padding:"16px 20px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",
          }}>
            <span style={{fontSize:32}}>{emoji}</span>
            <div style={{textAlign:"left"}}>
              <div style={{color,fontWeight:700,fontSize:16}}>{label}</div>
              <div style={{color:"#555",fontSize:12}}>{desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  if (step==="pw") return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"40px 20px"}}>
      <h2 style={{color:"#a855f7",marginBottom:20}}>🔐 Acceso de Gestor</h2>
      <Card accent="#a855f7">
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
          placeholder="Contraseña del gestor" onKeyDown={e=>e.key==="Enter"&&checkPw()}
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #333",borderRadius:10,
            padding:"11px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:12,boxSizing:"border-box",outline:"none"}}/>
        {pwErr&&<p style={{color:"#ef4444",fontSize:13,marginBottom:12}}>{pwErr}</p>}
        <Btn onClick={checkPw} variant="purple" style={{width:"100%"}}>Verificar</Btn>
      </Card>
    </div>
  );

  if (step==="profile") return (
    <ProfileScreen roomCode={roomCode} role={role}
      onJoined={p=>{ setProfile(p); setStep("play"); }}/>
  );

  if (step==="play") {
    const pid=getPlayerId(role,profile);
    if (role==="gestor") return <GestorScreen roomCode={roomCode} profile={profile}/>;
    return <PlayerScreen roomCode={roomCode} playerId={pid} profile={profile}/>;
  }
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("home");
  const [roomCode, setRoomCode] = useState(null);

  if (screen==="home") return (
    <HomeScreen
      onGestor={()=>setScreen("create")}
      onJoin={c=>{ setRoomCode(c); setScreen("join"); }}/>
  );
  if (screen==="create") return (
    <CreateRoomScreen
      onCreated={(code)=>{ setRoomCode(code); setScreen("join"); }}/>
  );
  if (screen==="join") return (
    <JoinFlow roomCode={roomCode} onBack={()=>setScreen("home")}/>
  );
}