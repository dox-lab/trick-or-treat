import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, set, get, onValue, off, update, push,
} from "firebase/database";

// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────
// IMPORTANTE: reemplaza con tu config real de Firebase
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
const COLORS  = ["#f97316","#22c55e","#a855f7","#3b82f6","#ef4444",
                 "#eab308","#06b6d4","#ec4899","#14b8a6","#f59e0b"];

// ─── UTILS ───────────────────────────────────────────────────────────────────
const roll    = () => Math.floor(Math.random() * 6) + 1;
const genCode = () => Math.random().toString(36).substring(2,7).toUpperCase();
const genUID  = () => Math.random().toString(36).substring(2,10);
const calcEV  = (dice) => dice.length ? dice.reduce((a,b)=>a+b,0)/(6*dice.length) : 0;

// Emparejamiento round-robin sin repetir rival
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
  // Repetir rondas hasta cubrir totalPartidas
  for (let p = 0; p < totalPartidas; p++) {
    const round = rounds[p % rounds.length];
    round.forEach(([a, b]) => {
      if (schedule[a] && schedule[b]) {
        schedule[a].push(b);
        schedule[b].push(a);
      }
    });
  }
  return schedule;
}

// Distribución de fases por jugador por partida
function buildFaseSchedule(playerIds, totalPartidas, cfg) {
  const fases = {};
  playerIds.forEach(pid => {
    const pool = [
      ...Array(cfg.control      || 0).fill("control"),
      ...Array(cfg.yo_trampo    || 0).fill("yo_trampo"),
      ...Array(cfg.rival_trampa || 0).fill("rival_trampa"),
      ...Array(cfg.ambos        || 0).fill("ambos"),
    ];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i+1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    fases[pid] = pool.slice(0, totalPartidas);
  });
  return fases;
}

// ─── DADO SVG ────────────────────────────────────────────────────────────────
const DOTS = {
  1:[[50,50]],
  2:[[28,28],[72,72]],
  3:[[28,28],[50,50],[72,72]],
  4:[[28,28],[72,28],[28,72],[72,72]],
  5:[[28,28],[72,28],[50,50],[28,72],[72,72]],
  6:[[28,22],[72,22],[28,50],[72,50],[28,78],[72,78]],
};

function Die({ value, hidden=false, size=60, color="#f97316", shake=false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100"
      style={{
        borderRadius:14, background:hidden?"#1e1e2e":"#0f0f1a",
        border:`2px solid ${hidden?"#2a2a3a":color}`,
        boxShadow:hidden?"none":`0 0 14px ${color}55`,
        flexShrink:0, transition:"border-color 0.3s, box-shadow 0.3s",
        animation: shake ? "shakeDie 0.5s ease" : "none",
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
      {(dice||[]).map((v,i) =>
        <Die key={i} value={v} hidden={hidden} size={size} color={color} shake={shake}/>
      )}
    </div>
  );
}

// ─── COMPONENTES UI ──────────────────────────────────────────────────────────
function Card({ children, style={}, accent="#f97316" }) {
  return (
    <div style={{
      background:"#12121e", border:`1px solid ${accent}44`,
      borderRadius:16, padding:"16px 20px",
      boxShadow:`0 0 24px ${accent}0d`, ...style,
    }}>{children}</div>
  );
}

function Btn({ children, onClick, variant="primary", disabled=false, style={} }) {
  const V = {
    primary:{ bg:"#f97316", color:"#000", border:"none" },
    success:{ bg:"#22c55e", color:"#000", border:"none" },
    danger: { bg:"#ef4444", color:"#fff", border:"none" },
    ghost:  { bg:"transparent", color:"#f97316", border:"1px solid #f97316" },
    purple: { bg:"#a855f7", color:"#fff", border:"none" },
    dark:   { bg:"#1e1e2e", color:"#aaa", border:"1px solid #2a2a3a" },
  };
  const v = V[variant]||V.primary;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:disabled?"#1e1e2e":v.bg, color:disabled?"#444":v.color,
      border:disabled?"1px solid #2a2a3a":v.border||"none",
      borderRadius:10, padding:"10px 20px",
      fontWeight:700, fontSize:14, cursor:disabled?"not-allowed":"pointer",
      transition:"all 0.15s", fontFamily:"inherit", ...style,
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
  return (
    <span style={{
      display:"inline-block",padding:"3px 10px",borderRadius:20,
      background:`${color}22`,color,fontSize:12,fontWeight:700,
    }}>{children}</span>
  );
}

// Overlay de animación
function Overlay({ show, children }) {
  if (!show) return null;
  return (
    <div style={{
      position:"fixed",inset:0,background:"#0a0a0fdd",
      display:"flex",alignItems:"center",justifyContent:"center",
      zIndex:200,backdropFilter:"blur(6px)",
      animation:"fadeIn 0.2s ease",
    }}>{children}</div>
  );
}

// ─── CSS GLOBAL ──────────────────────────────────────────────────────────────
const GlobalCSS = () => (
  <style>{`
    @keyframes float    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
    @keyframes fadeIn   { from{opacity:0;transform:scale(0.94)} to{opacity:1;transform:scale(1)} }
    @keyframes shakeDie { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-10deg)} 75%{transform:rotate(10deg)} }
    @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.4} }
    @keyframes spin     { from{transform:rotate(0)} to{transform:rotate(360deg)} }
    @keyframes slideUp  { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
    * { box-sizing:border-box; }
  `}</style>
);

// ─── PANTALLA INICIO ─────────────────────────────────────────────────────────
function HomeScreen({ onGestor, onJoin }) {
  const [code, setCode] = useState("");
  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"48px 20px"}}>
      <GlobalCSS/>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{fontSize:72,display:"inline-block",animation:"float 3s ease-in-out infinite"}}>🎃</div>
        <h1 style={{fontSize:34,fontWeight:900,color:"#f97316",margin:"8px 0 0",letterSpacing:-1}}>
          TRICK OR TREAT
        </h1>
        <p style={{color:"#555",marginTop:6,fontSize:13,letterSpacing:1}}>
          EXPERIMENTO · TEORÍA DE JUEGOS · UTEC
        </p>
      </div>

      <Card accent="#a855f7" style={{marginBottom:12}}>
        <p style={{color:"#777",margin:"0 0 12px",fontSize:13}}>¿Eres el investigador?</p>
        <Btn onClick={onGestor} variant="purple" style={{width:"100%"}}>
          🔬 Crear sala como Gestor
        </Btn>
      </Card>

      <Card accent="#f97316">
        <p style={{color:"#777",margin:"0 0 12px",fontSize:13}}>¿Eres jugador? Ingresa el código de sala:</p>
        <div style={{display:"flex",gap:8}}>
          <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())}
            placeholder="XXXXX" maxLength={5}
            style={{flex:1,background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
              padding:"11px 14px",color:"#f97316",fontFamily:"monospace",fontSize:22,
              letterSpacing:6,outline:"none",textAlign:"center"}}/>
          <Btn onClick={()=>onJoin(code)} disabled={code.length<4}>Entrar</Btn>
        </div>
      </Card>
    </div>
  );
}

// ─── PANTALLA CREAR SALA ─────────────────────────────────────────────────────
function CreateRoomScreen({ onCreated }) {
  const [pw, setPw]                   = useState("");
  const [totalPartidas, setTotal]     = useState(5);
  const [cfg, setCfg]                 = useState({control:1,yo_trampo:2,rival_trampa:1,ambos:1});
  const [loading, setLoading]         = useState(false);
  const suma = Object.values(cfg).reduce((a,b)=>a+b,0);
  const upd  = (k,v) => setCfg(c=>({...c,[k]:Math.max(0,v)}));

  const create = async () => {
    if (!pw || suma!==totalPartidas) return;
    setLoading(true);
    const code = genCode();
    await set(ref(db,`rooms/${code}`), {
      code, password:pw,
      config:{ totalPartidas, faseConfig:cfg, showEV:false, timerSecs:0, open:false },
      status:{ phase:"lobby", partidaActual:0 },
      players:{}, pairs:{}, faseSchedule:{}, balance:{}, logs:{},
      createdAt:Date.now(),
    });
    setLoading(false);
    onCreated(code);
  };

  return (
    <div style={{maxWidth:460,margin:"0 auto",padding:"36px 20px"}}>
      <GlobalCSS/>
      <h2 style={{color:"#a855f7",marginBottom:20}}>🔬 Nueva Sala Experimental</h2>
      <Card accent="#a855f7">
        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>Contraseña del gestor</label>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
          placeholder="Solo el gestor la sabe"
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
            padding:"10px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:20,boxSizing:"border-box",outline:"none"}}/>

        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>
          Total de partidas por jugador: <span style={{color:"#f97316"}}>{totalPartidas}</span>
        </label>
        <input type="range" min={2} max={10} value={totalPartidas}
          onChange={e=>{ const v=+e.target.value; setTotal(v); setCfg({control:Math.floor(v/4)||1,yo_trampo:Math.floor(v/4)||1,rival_trampa:Math.floor(v/4)||1,ambos:v-3*(Math.floor(v/4)||1)}); }}
          style={{width:"100%",marginBottom:20,accentColor:"#f97316"}}/>

        <div style={{fontSize:13,color:"#777",marginBottom:10}}>
          Distribución de fases{" "}
          <span style={{color:suma===totalPartidas?"#22c55e":"#ef4444",fontWeight:700}}>
            ({suma}/{totalPartidas})
          </span>
        </div>
        {[
          {k:"control",      label:"🎯 Control (sin trampa)",      color:"#aaa"},
          {k:"yo_trampo",    label:"🃏 Yo veo un dado del rival",   color:"#eab308"},
          {k:"rival_trampa", label:"👁️ Rival ve uno de mis dados", color:"#ef4444"},
          {k:"ambos",        label:"⚔️ Ambos ven un dado rival",    color:"#a855f7"},
        ].map(({k,label,color})=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{flex:1,fontSize:13,color}}>{label}</span>
            <button onClick={()=>upd(k,cfg[k]-1)} style={{background:"#1e1e2e",border:"1px solid #2a2a3a",
              borderRadius:6,color:"#aaa",width:28,height:28,cursor:"pointer",fontSize:16,lineHeight:1}}>−</button>
            <span style={{color:"#fff",fontWeight:700,minWidth:24,textAlign:"center"}}>{cfg[k]}</span>
            <button onClick={()=>upd(k,cfg[k]+1)} style={{background:"#1e1e2e",border:"1px solid #2a2a3a",
              borderRadius:6,color:"#aaa",width:28,height:28,cursor:"pointer",fontSize:16,lineHeight:1}}>+</button>
          </div>
        ))}

        <Btn onClick={create} disabled={!pw||loading||suma!==totalPartidas} variant="purple"
          style={{width:"100%",marginTop:12}}>
          {loading?"Creando...":"Crear sala 🎃"}
        </Btn>
        {suma!==totalPartidas && (
          <p style={{color:"#ef4444",fontSize:12,marginTop:8,textAlign:"center"}}>
            La suma de fases debe ser {totalPartidas}
          </p>
        )}
      </Card>
    </div>
  );
}

// ─── PANTALLA PERFIL ─────────────────────────────────────────────────────────
// Cada jugador genera un UID único al entrar. Ese UID es su clave en /players
function ProfileScreen({ roomCode, onJoined }) {
  const [nickname, setNickname] = useState("");
  const [avatar,   setAvatar]   = useState(AVATARS[0]);
  const [color,    setColor]    = useState(COLORS[0]);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const join = async () => {
    if (!nickname.trim()) return;
    setLoading(true);
    const snap = await get(ref(db,`rooms/${roomCode}`));
    if (!snap.exists()) { setError("Sala no encontrada"); setLoading(false); return; }
    const room = snap.val();
    if (!room.config?.open) { setError("La sala aún no está abierta. Espera al gestor."); setLoading(false); return; }

    // Generar UID único para este jugador
    const uid = genUID();
    const profile = { uid, nickname:nickname.trim(), avatar, color, joinedAt:Date.now(), balance:10 };
    await set(ref(db,`rooms/${roomCode}/players/${uid}`), profile);
    // Guardar uid en sessionStorage para recuperarlo si refresca
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
        <p style={{color:"#555",fontSize:13,marginTop:4}}>Crea tu perfil para unirte</p>
      </div>
      <Card>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:80,filter:`drop-shadow(0 0 18px ${color})`,lineHeight:1}}>{avatar}</div>
          <div style={{fontWeight:700,color,fontSize:20,marginTop:8}}>{nickname||"Tu nombre aquí"}</div>
        </div>

        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>Nickname</label>
        <input value={nickname} onChange={e=>setNickname(e.target.value)}
          placeholder="Ej: StatsWitch" maxLength={16}
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
            padding:"10px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:16,boxSizing:"border-box",outline:"none"}}/>

        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:8}}>Avatar</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
          {AVATARS.map(a=>(
            <button key={a} onClick={()=>setAvatar(a)} style={{
              fontSize:26,background:avatar===a?"#1e1e2e":"transparent",
              border:`2px solid ${avatar===a?color:"#2a2a3a"}`,
              borderRadius:10,padding:5,cursor:"pointer",transition:"all 0.15s",
            }}>{a}</button>
          ))}
        </div>

        <label style={{color:"#777",fontSize:13,display:"block",marginBottom:8}}>Color</label>
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

// ─── PANTALLA GESTOR ─────────────────────────────────────────────────────────
function GestorScreen({ roomCode }) {
  const [room,     setRoom]    = useState(null);
  const [tab,      setTab]     = useState("control");
  const [cfgLocal, setCfgLocal] = useState(null);

  useEffect(()=>{
    const r = ref(db,`rooms/${roomCode}`);
    onValue(r, snap=>{ if(snap.exists()){ const d=snap.val(); setRoom(d); if(!cfgLocal) setCfgLocal(d.config); }});
    return ()=>off(r);
  },[roomCode]);

  const openRoom  = ()=>update(ref(db,`rooms/${roomCode}/config`),{open:true});
  const closeRoom = ()=>update(ref(db,`rooms/${roomCode}/config`),{open:false});

  const startExperiment = async () => {
    const players = Object.keys(room.players||{});
    if (players.length < 2) { alert("Necesitas al menos 2 jugadores"); return; }
    const tp = room.config.totalPartidas;
    const schedule      = buildSchedule(players, tp);
    const faseSchedule  = buildFaseSchedule(players, tp, room.config.faseConfig);
    const balanceInit   = {};
    players.forEach(p=>{ balanceInit[p]=10; });
    await update(ref(db,`rooms/${roomCode}`),{
      pairs:schedule, faseSchedule,
      "status/phase":"playing",
      "status/partidaActual":1,
      balance:balanceInit,
    });
    await launchPartida(1, players, schedule, faseSchedule, tp);
  };

  const launchPartida = async (numPartida, players, schedule, faseSchedule, totalPartidas) => {
    if (numPartida > totalPartidas) {
      await update(ref(db,`rooms/${roomCode}/status`),{phase:"finished"});
      return;
    }
    const idx = numPartida - 1;
    const done = new Set();
    const partidaData = {};
    players.forEach(pid=>{
      if (done.has(pid)) return;
      const rival = (schedule[pid]||[])[idx];
      if (!rival || done.has(rival)) return;
      done.add(pid); done.add(rival);
      const pairKey = [pid,rival].sort().join("_");
      partidaData[pairKey] = {
        jugadores:[pid,rival],
        dados:{ [pid]:[roll(),roll()], [rival]:[roll(),roll()] },
        publicos:[roll(),roll()],
        fases:{ [pid]:(faseSchedule[pid]||[])[idx]||"control",
                [rival]:(faseSchedule[rival]||[])[idx]||"control" },
        ronda:1, pot:2, decisiones:{}, resultado:null, startedAt:Date.now(),
      };
    });
    await update(ref(db,`rooms/${roomCode}/partidas/${numPartida}`), partidaData);
    await update(ref(db,`rooms/${roomCode}/status`),{partidaActual:numPartida, phase:"playing"});
  };

  const nextPartida = async () => {
    const snap = await get(ref(db,`rooms/${roomCode}`));
    const r = snap.val();
    const players = Object.keys(r.players||{});
    const next = (r.status?.partidaActual||1)+1;
    if (next > r.config.totalPartidas) {
      await update(ref(db,`rooms/${roomCode}/status`),{phase:"finished"});
    } else {
      await launchPartida(next, players, r.pairs, r.faseSchedule, r.config.totalPartidas);
    }
  };

  const resetSession = async ()=>{
    const players = Object.keys(room?.players||{});
    const bal = {}; players.forEach(p=>{bal[p]=10;});
    await update(ref(db,`rooms/${roomCode}`),{
      partidas:null, logs:null, balance:bal, pairs:null, faseSchedule:null,
      "status/phase":"lobby","status/partidaActual":0,
    });
  };

  const saveConfig = ()=>update(ref(db,`rooms/${roomCode}/config`),cfgLocal);

  const exportCSV = ()=>{
    const logs = Object.values(room?.logs||{}).sort((a,b)=>a.ts-b.ts);
    if (!logs.length) return;
    const cols=["partida","pairKey","jugador","rival","nickname_jugador","nickname_rival","accion","ronda","ev","tiempo_ms","fase","suma_propia","suma_publica","resultado"];
    const rows=logs.map(l=>cols.map(c=>`"${l[c]??""}""`).join(","));
    const csv=[cols.join(","),...rows].join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a=document.createElement("a"); a.href=url; a.download=`tot_${roomCode}.csv`; a.click();
  };

  if (!room) return <div style={{color:"#666",padding:40,textAlign:"center"}}>Cargando sala…</div>;

  const {config,status,players,balance,partidas,logs:logsObj}=room;
  const logs       = Object.values(logsObj||{}).sort((a,b)=>a.ts-b.ts);
  const allPlayers = Object.entries(players||{});
  const phase      = status?.phase||"lobby";
  const pActual    = status?.partidaActual||0;
  const pData      = partidas?.[pActual]||{};
  const TABS       = [{id:"control",label:"🎮 Control"},{id:"partidas",label:"🎲 Partidas"},{id:"datos",label:"📊 Datos"},{id:"config",label:"⚙️ Config"}];

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
            {phase==="lobby"?"LOBBY":phase==="playing"?`PARTIDA ${pActual}/${config?.totalPartidas}`:"FINALIZADO"}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:16,background:"#1a1a2a",borderRadius:12,padding:4}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1,padding:"8px 4px",background:tab===t.id?"#a855f7":"transparent",
            border:"none",borderRadius:8,color:tab===t.id?"#fff":"#555",
            fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",
          }}>{t.label}</button>
        ))}
      </div>

      {/* CONTROL */}
      {tab==="control" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card accent="#a855f7">
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {!config?.open
                ? <Btn onClick={openRoom}  variant="success">Abrir sala</Btn>
                : <Btn onClick={closeRoom} variant="danger">Cerrar sala</Btn>}
              {phase==="lobby" && config?.open &&
                <Btn onClick={startExperiment}>▶ Iniciar experimento</Btn>}
              {phase==="playing" &&
                <Btn onClick={nextPartida} variant="purple">⏭ Siguiente partida</Btn>}
              <Btn onClick={resetSession} variant="ghost">↺ Reiniciar</Btn>
            </div>
          </Card>

          {/* Jugadores */}
          <Card>
            <div style={{fontSize:11,color:"#555",marginBottom:10}}>
              JUGADORES EN SALA ({allPlayers.length})
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {allPlayers.map(([uid,p])=>(
                <div key={uid} style={{background:"#1a1a2a",borderRadius:10,padding:"8px 14px",
                  border:`1px solid ${p.color}44`,display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:22}}>{p.avatar}</span>
                  <div>
                    <div style={{color:p.color,fontWeight:700,fontSize:14}}>{p.nickname}</div>
                    <div style={{color:"#555",fontSize:11}}>💰 {balance?.[uid]??10}</div>
                  </div>
                </div>
              ))}
              {!allPlayers.length && <span style={{color:"#444",fontSize:13}}>Esperando jugadores…</span>}
            </div>
          </Card>

          {/* Estado partidas en curso */}
          {phase==="playing" && Object.entries(pData).map(([pairKey,pd])=>{
            const [pA,pB] = pd.jugadores||[];
            const plA=players?.[pA]; const plB=players?.[pB];
            return (
              <Card key={pairKey} accent="#f97316">
                <div style={{fontSize:11,color:"#555",marginBottom:8}}>PAR EN JUEGO</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {[[pA,plA],[pB,plB]].map(([pid,pl])=>pl&&(
                    <div key={pid}>
                      <div style={{color:pl.color,fontWeight:700,fontSize:15}}>{pl.avatar} {pl.nickname}</div>
                      <div style={{fontSize:12,color:"#555",marginTop:2}}>
                        Fase: <span style={{color:"#aaa"}}>{pd.fases?.[pid]||"-"}</span>
                      </div>
                      <div style={{fontSize:12,color:"#555"}}>
                        Dados: <span style={{color:"#aaa",fontFamily:"monospace"}}>{(pd.dados?.[pid]||[]).join(" | ")}</span>
                      </div>
                      <div style={{fontSize:12,color:"#555"}}>
                        R{pd.ronda}: <span style={{color:pd.decisiones?.[`${pd.ronda}_${pid}`]?"#22c55e":"#666"}}>
                          {pd.decisiones?.[`${pd.ronda}_${pid}`]||"⏳ esperando"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8,fontSize:12,color:"#a855f7"}}>
                  Públicos: {(pd.publicos||[]).map((v,i)=>i<(pd.ronda||1)-1?v:"?").join(" | ")}
                  {" · "}Ronda {pd.ronda}/3{" · "}Pozo {pd.pot}
                </div>
                {pd.resultado&&<div style={{marginTop:6,color:"#22c55e",fontWeight:700}}>✓ {pd.resultado}</div>}
              </Card>
            );
          })}
          {phase==="finished"&&(
            <Card style={{textAlign:"center",padding:32}}>
              <div style={{fontSize:48}}>🏆</div>
              <h2 style={{color:"#22c55e",marginTop:8}}>Experimento completado</h2>
              <p style={{color:"#555",fontSize:13}}>Descarga los datos en la pestaña Datos</p>
            </Card>
          )}
        </div>
      )}

      {/* PARTIDAS */}
      {tab==="partidas" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {Array.from({length:config?.totalPartidas||5},(_,i)=>i+1).map(n=>{
            const done=n<pActual, current=n===pActual;
            const pd=partidas?.[n]||{};
            return (
              <Card key={n} accent={current?"#f97316":done?"#22c55e44":"#2a2a3a"}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:700,color:current?"#f97316":done?"#22c55e":"#555"}}>
                    Partida {n}{current&&" ← actual"}{done&&" ✓"}
                  </span>
                  <Badge color={current?"#f97316":done?"#22c55e":"#444"}>
                    {current?"EN JUEGO":done?"COMPLETADA":"PENDIENTE"}
                  </Badge>
                </div>
                {Object.entries(pd).map(([pk,d])=>(
                  <div key={pk} style={{fontSize:12,color:"#555",marginTop:4}}>
                    {(d.jugadores||[]).map(p=>players?.[p]?.nickname||p).join(" vs ")}
                    {d.resultado&&<span style={{color:"#22c55e"}}> → {d.resultado}</span>}
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}

      {/* DATOS */}
      {tab==="datos" && (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{color:"#555",fontSize:13}}>{logs.length} eventos</span>
            <Btn onClick={exportCSV} variant="success" style={{fontSize:13,padding:"7px 16px"}}>⬇ CSV</Btn>
          </div>
          <Card>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
                <thead>
                  <tr>{["Part.","Jugador","Rival","Acción","Ronda","EV","Tiempo","Fase","Resultado"].map(h=>(
                    <th key={h} style={{color:"#444",padding:"5px 8px",textAlign:"left",borderBottom:"1px solid #1e1e2e"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {logs.slice(-60).reverse().map((l,i)=>(
                    <tr key={i} style={{borderBottom:"1px solid #141420"}}>
                      <td style={{padding:"4px 8px",color:"#555"}}>{l.partida}</td>
                      <td style={{padding:"4px 8px",color:players?.[l.jugador]?.color||"#aaa",fontWeight:700}}>
                        {players?.[l.jugador]?.nickname||l.jugador}
                      </td>
                      <td style={{padding:"4px 8px",color:players?.[l.rival]?.color||"#555"}}>
                        {players?.[l.rival]?.nickname||l.rival}
                      </td>
                      <td style={{padding:"4px 8px",color:l.accion==="apostar"?"#22c55e":"#ef4444"}}>{l.accion}</td>
                      <td style={{padding:"4px 8px",color:"#aaa"}}>{l.ronda}</td>
                      <td style={{padding:"4px 8px",color:"#a855f7"}}>{((l.ev||0)*100).toFixed(0)}%</td>
                      <td style={{padding:"4px 8px",color:"#555"}}>{l.tiempo_ms}</td>
                      <td style={{padding:"4px 8px",color:"#555",fontSize:10}}>{l.fase}</td>
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

      {/* CONFIG */}
      {tab==="config" && cfgLocal && (
        <Card accent="#a855f7">
          <div style={{fontSize:12,color:"#555",marginBottom:16}}>CONFIGURACIÓN</div>
          <label style={{color:"#777",fontSize:13,display:"flex",alignItems:"center",gap:10,marginBottom:14,cursor:"pointer"}}>
            <input type="checkbox" checked={!!cfgLocal.showEV}
              onChange={e=>setCfgLocal(c=>({...c,showEV:e.target.checked}))}
              style={{accentColor:"#f97316",width:16,height:16}}/>
            Mostrar barra de Ventaja Esperada (EV) a los jugadores
          </label>
          <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>
            Temporizador por ronda: <span style={{color:"#f97316"}}>
              {cfgLocal.timerSecs===0?"Sin límite":`${cfgLocal.timerSecs}s`}
            </span>
          </label>
          <input type="range" min={0} max={60} step={5} value={cfgLocal.timerSecs||0}
            onChange={e=>setCfgLocal(c=>({...c,timerSecs:+e.target.value}))}
            style={{width:"100%",marginBottom:20,accentColor:"#f97316"}}/>
          <Btn onClick={saveConfig} variant="purple" style={{width:"100%",marginBottom:20}}>
            Guardar cambios
          </Btn>
          <hr style={{border:"none",borderTop:"1px solid #1e1e2e",margin:"16px 0"}}/>
          <div style={{fontSize:11,color:"#555",marginBottom:8}}>CÓDIGO PARA COMPARTIR</div>
          <div style={{fontFamily:"monospace",fontSize:30,letterSpacing:8,color:"#f97316",
            fontWeight:900,background:"#0a0a0f",padding:"14px 20px",borderRadius:10,textAlign:"center"}}>
            {roomCode}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── PANTALLA JUGADOR ────────────────────────────────────────────────────────
function PlayerScreen({ roomCode, playerId, profile }) {
  const [room,     setRoom]     = useState(null);
  const [decidido, setDecidido] = useState(false);
  const [overlay,  setOverlay]  = useState(null); // null | {type, msg}
  const [timerLeft,setTimer]    = useState(null);
  const prevRondaRef   = useRef(null);
  const prevPartidaRef = useRef(null);
  const timerRef       = useRef(null);

  useEffect(()=>{
    const r=ref(db,`rooms/${roomCode}`);
    onValue(r,snap=>{ if(snap.exists()) setRoom(snap.val()); });
    return ()=>off(r);
  },[roomCode]);

  // Detectar cambio de ronda para animaciones
  useEffect(()=>{
    if (!room) return;
    const n = room.status?.partidaActual||0;
    const myPair = getMyPair(room,n);
    if (!myPair) return;
    const ronda = myPair.ronda||1;

    if (prevRondaRef.current!==null && ronda!==prevRondaRef.current) {
      setDecidido(false);
      if (ronda<=3) {
        setOverlay({type:"rolling", msg:
          ronda===1?"🎲 ¡Dados lanzados! Toma tu decisión":
          ronda===2?"🌐 Primer dado público revelado":
                    "🌐 Segundo dado público revelado"});
        setTimeout(()=>setOverlay(null),1800);
      }
    }
    if (prevPartidaRef.current!==null && n!==prevPartidaRef.current) {
      setDecidido(false);
      setOverlay({type:"next", msg:`⚔️ Partida ${n} — ¡Nueva partida!`});
      setTimeout(()=>setOverlay(null),1600);
    }
    prevRondaRef.current  = ronda;
    prevPartidaRef.current = n;
  },[room]);

  // Timer
  useEffect(()=>{
    clearInterval(timerRef.current);
    if (!room) return;
    const secs = room.config?.timerSecs||0;
    if (!secs) { setTimer(null); return; }
    const myPair = getMyPair(room, room.status?.partidaActual||0);
    if (!myPair||myPair.resultado) { setTimer(null); return; }
    const elapsed = Math.floor((Date.now()-(myPair.startedAt||Date.now()))/1000);
    const left = Math.max(0, secs-elapsed);
    setTimer(left);
    timerRef.current = setInterval(()=>setTimer(l=>Math.max(0,(l||0)-1)),1000);
    return ()=>clearInterval(timerRef.current);
  },[room?.status?.partidaActual, room?.config?.timerSecs]);

  const getMyPair = (r,n) => {
    const partidas = r?.partidas?.[n]||{};
    return Object.values(partidas).find(p=>(p.jugadores||[]).includes(playerId))||null;
  };

  const getPairKey = (r,n) => {
    const partidas = r?.partidas?.[n]||{};
    return Object.keys(partidas).find(k=>(partidas[k].jugadores||[]).includes(playerId))||null;
  };

  const decidir = async (accion) => {
    if (decidido) return;
    const n = room.status?.partidaActual||0;
    const pairKey = getPairKey(room,n);
    if (!pairKey) return;
    const pd  = room.partidas[n][pairKey];
    const ronda = pd.ronda||1;

    // Calcular EV y tiempo
    const myDice   = pd.dados?.[playerId]||[];
    const pubVis   = (pd.publicos||[]).slice(0, ronda-1);
    const ev       = calcEV([...myDice,...pubVis]);
    const tiempo   = Date.now()-(pd.startedAt||Date.now());
    const rival    = (pd.jugadores||[]).find(j=>j!==playerId);
    const fase     = pd.fases?.[playerId]||"control";

    setDecidido(true);
    setOverlay({type:"waiting", msg:"Esperando al otro jugador…"});

    // Guardar decisión en Firebase
    const decKey = `${ronda}_${playerId}`;
    await update(ref(db,`rooms/${roomCode}/partidas/${n}/${pairKey}/decisiones`),{[decKey]:accion});

    // Log
    const logRef = push(ref(db,`rooms/${roomCode}/logs`));
    await set(logRef,{
      partida:n, pairKey, jugador:playerId, rival,
      nickname_jugador:profile?.nickname||"",
      nickname_rival:room.players?.[rival]?.nickname||"",
      accion, ronda, ev, tiempo_ms:tiempo, fase,
      suma_propia:myDice.reduce((a,b)=>a+b,0),
      suma_publica:pubVis.reduce((a,b)=>a+b,0),
      resultado:null, ts:Date.now(),
    });

    // Verificar si el rival ya decidió
    const rivalDec = pd.decisiones?.[`${ronda}_${rival}`];
    if (rivalDec) {
      setOverlay(null);
      await resolveRonda(n, pairKey, pd, ronda, playerId, accion, rival, rivalDec);
    }
    // Si no, esperamos que el listener de Firebase detone cuando el rival decida
  };

  // Efecto que detecta cuando el rival decide mientras yo ya decidí
  useEffect(()=>{
    if (!room||!decidido) return;
    const n = room.status?.partidaActual||0;
    const pairKey = getPairKey(room,n);
    if (!pairKey) return;
    const pd    = room.partidas?.[n]?.[pairKey];
    if (!pd||pd.resultado) { setOverlay(null); return; }
    const ronda  = pd.ronda||1;
    const rival  = (pd.jugadores||[]).find(j=>j!==playerId);
    const myDec  = pd.decisiones?.[`${ronda}_${playerId}`];
    const rivDec = pd.decisiones?.[`${ronda}_${rival}`];
    if (myDec && rivDec) {
      setOverlay(null);
      resolveRonda(n, pairKey, pd, ronda, playerId, myDec, rival, rivDec);
    }
  },[room]);

  const resolveRonda = async (n,pairKey,pd,ronda,pidA,decA,pidB,decB)=>{
    // Evitar doble ejecución: solo el jugador A (lexicográficamente menor) resuelve
    if (pidA > pidB) return;

    if (decA==="retirarse"||decB==="retirarse") {
      const ganador = decA==="retirarse"?pidB:pidA;
      await finalizarPartida(n,pairKey,pd,ganador,"Retirada");
      return;
    }
    // Ambos apostaron: descuento y avance
    const newPot = (pd.pot||2)+2;
    const balA   = room.balance?.[pidA]??10;
    const balB   = room.balance?.[pidB]??10;
    const upds   = {
      [`balance/${pidA}`]:balA-1,
      [`balance/${pidB}`]:balB-1,
    };

    if (ronda>=3) {
      // Ronda 3 → evaluar ganador
      const dA=pd.dados?.[pidA]||[]; const dB=pd.dados?.[pidB]||[];
      const pub=pd.publicos||[];
      const sA=dA.reduce((a,b)=>a+b,0)+pub.reduce((a,b)=>a+b,0);
      const sB=dB.reduce((a,b)=>a+b,0)+pub.reduce((a,b)=>a+b,0);
      const t3A=[...dA,...pub].filter(v=>v===1).length>=3;
      const t3B=[...dB,...pub].filter(v=>v===1).length>=3;
      let ganador;
      if      (t3A&&!t3B) ganador=pidA;
      else if (t3B&&!t3A) ganador=pidB;
      else if (sA>sB)     ganador=pidA;
      else if (sB>sA)     ganador=pidB;
      else                ganador="empate";
      upds[`partidas/${n}/${pairKey}/pot`]  = newPot;
      upds[`partidas/${n}/${pairKey}/ronda`] = 4;
      await update(ref(db,`rooms/${roomCode}`), upds);
      await finalizarPartida(n,pairKey,{...pd,pot:newPot},ganador,"Suma final");
    } else {
      upds[`partidas/${n}/${pairKey}/pot`]        = newPot;
      upds[`partidas/${n}/${pairKey}/ronda`]      = ronda+1;
      upds[`partidas/${n}/${pairKey}/startedAt`]  = Date.now();
      upds[`partidas/${n}/${pairKey}/decisiones`] = null;
      await update(ref(db,`rooms/${roomCode}`), upds);
    }
  };

  const finalizarPartida = async (n,pairKey,pd,ganador,motivo)=>{
    const [p1,p2] = pd.jugadores||[];
    const pot = pd.pot||2;
    let b1=room.balance?.[p1]??10, b2=room.balance?.[p2]??10;
    let res;
    if (ganador==="empate") {
      b1+=Math.floor(pot/2); b2+=Math.floor(pot/2); res="Empate";
    } else {
      if (ganador===p1) b1+=pot; else b2+=pot;
      const nick=room.players?.[ganador]?.nickname||ganador;
      res=`Ganó ${nick} (${motivo})`;
    }
    await update(ref(db,`rooms/${roomCode}`),{
      [`balance/${p1}`]:b1, [`balance/${p2}`]:b2,
      [`partidas/${n}/${pairKey}/resultado`]:res,
      [`partidas/${n}/${pairKey}/ronda`]:4,
    });
    // Log resultado
    const logRef=push(ref(db,`rooms/${roomCode}/logs`));
    await set(logRef,{
      partida:n,pairKey,jugador:ganador,rival:"",
      nickname_jugador:room.players?.[ganador]?.nickname||"",
      nickname_rival:"",
      accion:"resultado",ronda:4,ev:0,tiempo_ms:0,
      fase:pd.fases?.[ganador]||"control",
      suma_propia:0,suma_publica:0,resultado:res,ts:Date.now(),
    });
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────
  if (!room) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      minHeight:"70vh",color:"#555",gap:16}}>
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

  // LOBBY / FINISHED
  if (phase==="lobby"||phase==="finished") return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"48px 20px",textAlign:"center"}}>
      <GlobalCSS/>
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

  // Sin par asignado todavía
  if (!myPair) return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"60px 20px",textAlign:"center"}}>
      <GlobalCSS/>
      <div style={{fontSize:48,display:"inline-block",animation:"pulse 1.5s infinite"}}>⏳</div>
      <p style={{color:"#555",marginTop:16}}>Esperando emparejamiento…</p>
    </div>
  );

  // Datos del par
  const rival    = (myPair.jugadores||[]).find(j=>j!==playerId);
  const rivalInfo= players?.[rival];
  const myDice   = myPair.dados?.[playerId]||[];
  const ronda    = myPair.ronda||1;
  const pubAll   = myPair.publicos||[];
  const pubDice  = pubAll.map((v,i)=>({value:v,visible:i<ronda-1}));
  const pot      = myPair.pot||0;
  const resultado= myPair.resultado||null;
  const fase     = myPair.fases?.[playerId]||"control";
  const canCheat = fase==="yo_trampo"||fase==="ambos";
  const rivalDice= myPair.dados?.[rival]||[];
  const mySum    = myDice.reduce((a,b)=>a+b,0);
  const pubVis   = pubDice.filter(d=>d.visible).map(d=>d.value);
  const pubSum   = pubVis.reduce((a,b)=>a+b,0);
  const totalVis = mySum+pubSum;
  const ev       = myDice.length?calcEV([...myDice,...pubVis]):0;
  const yaDecidio= !!myPair.decisiones?.[`${ronda}_${playerId}`];
  const rivDecidio=!!myPair.decisiones?.[`${ronda}_${rival}`];

  // RESULTADO de esta partida
  if (resultado) return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"24px 16px"}}>
      <GlobalCSS/>
      <Overlay show={true}>
        <Card style={{maxWidth:340,textAlign:"center",padding:40,animation:"fadeIn 0.3s ease",
          border:`1px solid ${resultado.includes(profile?.nickname)?"#22c55e":resultado==="Empate"?"#aaa":"#ef4444"}44`}}>
          <div style={{fontSize:72,marginBottom:12}}>
            {resultado==="Empate"?"🤝":resultado.includes(profile?.nickname||"____")?"🏆":"💀"}
          </div>
          <h2 style={{color:resultado==="Empate"?"#aaa":resultado.includes(profile?.nickname||"____")?"#22c55e":"#ef4444",
            marginBottom:8,fontSize:22}}>
            {resultado==="Empate"?"¡Empate!":resultado.includes(profile?.nickname||"____")?"¡Ganaste!":"¡Perdiste!"}
          </h2>
          <p style={{color:"#666",fontSize:13,marginBottom:16}}>{resultado}</p>
          <div style={{background:"#0a0a0f",borderRadius:10,padding:12,marginBottom:16}}>
            <div style={{fontSize:12,color:"#555",marginBottom:4}}>
              Mis dados: <span style={{color:myColor}}>{myDice.join(" + ")} = {mySum}</span>
            </div>
            <div style={{fontSize:12,color:"#555",marginBottom:4}}>
              Públicos: <span style={{color:"#22c55e"}}>{pubAll.join(" + ")} = {pubAll.reduce((a,b)=>a+b,0)}</span>
            </div>
            <div style={{fontSize:13,color:"#aaa",fontWeight:700}}>
              Total: {mySum+pubAll.reduce((a,b)=>a+b,0)}
            </div>
          </div>
          <div style={{fontSize:22,fontWeight:900,color:"#f97316",marginBottom:16}}>💰 {myBal} fichas</div>
          <Btn onClick={()=>{ setDecidido(false); setOverlay(null); }} variant="ghost" style={{width:"100%"}}>
            Ver pantalla
          </Btn>
        </Card>
      </Overlay>
      {/* Pantalla de fondo (borrosa) */}
      <PlayerHeader profile={profile} balance={myBal} roomCode={roomCode} partida={n} total={config?.totalPartidas}/>
      <Card style={{marginTop:12,textAlign:"center",padding:24}}>
        <div style={{color:"#555",fontSize:14}}>Partida {n} finalizada</div>
        <div style={{color:"#444",fontSize:13,marginTop:4}}>Espera al gestor para la siguiente</div>
      </Card>
    </div>
  );

  // JUEGO EN CURSO
  return (
    <div style={{maxWidth:420,margin:"0 auto",padding:"16px 16px 80px"}}>
      <GlobalCSS/>

      {/* Overlay animaciones */}
      <Overlay show={overlay?.type==="rolling"}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:80,display:"inline-block",animation:"shakeDie 0.4s ease infinite"}}>🎲</div>
          <div style={{color:"#f97316",fontWeight:700,fontSize:18,marginTop:12,maxWidth:280}}>{overlay?.msg}</div>
        </div>
      </Overlay>
      <Overlay show={overlay?.type==="waiting"}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:56,display:"inline-block",animation:"pulse 1.2s infinite"}}>⏳</div>
          <div style={{color:"#aaa",fontSize:16,marginTop:12}}>{overlay?.msg}</div>
        </div>
      </Overlay>
      <Overlay show={overlay?.type==="next"}>
        <div style={{textAlign:"center",animation:"fadeIn 0.3s ease"}}>
          <div style={{fontSize:64}}>⚔️</div>
          <div style={{color:"#f97316",fontWeight:700,fontSize:20,marginTop:12}}>{overlay?.msg}</div>
        </div>
      </Overlay>

      <PlayerHeader profile={profile} balance={myBal} roomCode={roomCode} partida={n} total={config?.totalPartidas}/>

      {/* Timer */}
      {timerLeft!==null && (
        <div style={{textAlign:"center",margin:"6px 0"}}>
          <span style={{fontFamily:"monospace",fontSize:22,fontWeight:900,
            color:timerLeft<=5?"#ef4444":timerLeft<=15?"#eab308":"#555"}}>
            ⏱ {timerLeft}s
          </span>
        </div>
      )}

      {/* Indicador de rondas */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        {[{n:1,label:"Dados"},{n:2,label:"Pub·1"},{n:3,label:"Pub·2"},{n:4,label:"Final"}].map(r=>(
          <div key={r.n} style={{flex:1,textAlign:"center",padding:"7px 4px",borderRadius:10,
            background:ronda>r.n?"#22c55e18":ronda===r.n?"#f9731618":"#12121e",
            border:`1px solid ${ronda>r.n?"#22c55e55":ronda===r.n?"#f9731655":"#1e1e2e"}`,
          }}>
            <div style={{fontSize:9,color:"#444",marginBottom:2}}>R{r.n}</div>
            <div style={{fontSize:10,fontWeight:700,color:ronda>r.n?"#22c55e":ronda===r.n?"#f97316":"#333"}}>
              {r.label}
            </div>
          </div>
        ))}
      </div>

      {/* Mis dados */}
      <Card accent={myColor} style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#555",marginBottom:8}}>TUS DADOS</div>
        <DiceRow dice={myDice} size={58} color={myColor} shake={overlay?.type==="rolling"}/>
        {/* Suma visual */}
        <div style={{marginTop:12,display:"flex",justifyContent:"center",gap:6,alignItems:"center",
          flexWrap:"wrap",fontSize:16,fontWeight:700}}>
          {myDice.map((v,i)=>(
            <span key={i} style={{color:myColor}}>{v}</span>
          )).reduce((acc,el,i,arr)=>i<arr.length-1?[...acc,el,<span key={`p${i}`} style={{color:"#333"}}>+</span>]:[...acc,el],[])}
          {pubVis.map((v,i)=>(
            <span key={`pv${i}`} style={{color:"#22c55e"}}>+{v}</span>
          ))}
          <span style={{color:"#fff",fontSize:20,marginLeft:4}}>=&nbsp;<span style={{color:"#f97316"}}>{totalVis}</span></span>
        </div>
        {config?.showEV && <div style={{marginTop:10}}><EVBar value={ev} label="Ventaja esperada (EV)" color={myColor}/></div>}
      </Card>

      {/* Dados públicos */}
      <Card accent="#22c55e" style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#555",marginBottom:8}}>DADOS PÚBLICOS</div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          {pubDice.map((d,i)=>(
            <Die key={i} value={d.value} hidden={!d.visible} size={52}
              color="#22c55e" shake={overlay?.type==="rolling"&&d.visible}/>
          ))}
        </div>
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
          <Die value={rivalDice[1]} hidden={true} size={50}/>
        </div>
      </Card>

      {/* Pozo */}
      <div style={{textAlign:"center",color:"#a855f7",fontWeight:700,fontSize:16,margin:"8px 0"}}>
        🏆 Pozo: {pot} fichas
      </div>

      {/* Acciones o espera */}
      {ronda<=3 && (
        yaDecidio
          ? <Card style={{textAlign:"center",padding:20,background:"#12121e",border:"1px solid #1e1e2e"}}>
              <div style={{color:"#444",fontSize:14,animation:"pulse 1.5s infinite"}}>
                ⏳ Esperando al otro jugador…
              </div>
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
          <div style={{color:"#555",fontSize:14,animation:"pulse 1.5s infinite"}}>
            ⏳ Calculando resultado…
          </div>
        </Card>
      )}
    </div>
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

// ─── FLUJO DE UNIRSE ─────────────────────────────────────────────────────────
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
      <button onClick={onBack} style={{background:"none",border:"none",color:"#555",cursor:"pointer",
        marginBottom:20,fontSize:14}}>← Volver</button>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>SALA</div>
        <div style={{fontSize:28,fontWeight:900,color:"#f97316",fontFamily:"monospace",letterSpacing:4}}>{roomCode}</div>
      </div>
      <h2 style={{color:"#fff",marginBottom:16}}>¿Quién eres?</h2>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {[
          {r:"jugador",  label:"Jugador",               color:"#f97316", emoji:"🎲", desc:"Participante del experimento"},
          {r:"gestor",   label:"Gestor / Investigador",  color:"#a855f7", emoji:"🔬", desc:"Control de la sala"},
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
          placeholder="Contraseña del gestor"
          onKeyDown={e=>e.key==="Enter"&&checkPw()}
          style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
            padding:"11px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
            marginBottom:12,boxSizing:"border-box",outline:"none"}}/>
        {pwErr&&<p style={{color:"#ef4444",fontSize:13,marginBottom:12}}>{pwErr}</p>}
        <Btn onClick={checkPw} variant="purple" style={{width:"100%"}}>Verificar</Btn>
      </Card>
    </div>
  );

  // Perfil para jugador normal (requiere sala abierta)
  if (step==="profile_jugador") return (
    <ProfileScreen roomCode={roomCode}
      onJoined={(newUid,prof)=>{ setUid(newUid); setProfile(prof); setStep("play"); }}/>
  );

  // Perfil para gestor (sin restricción de sala abierta)
  if (step==="profile_gestor") {
    const [gNick, setGNick]   = useState("");
    const [gAv,   setGAv]     = useState("🔬");
    const [gCol,  setGCol]    = useState("#a855f7");
    const [gLoad, setGLoad]   = useState(false);

    const joinGestor = async () => {
      if (!gNick.trim()) return;
      setGLoad(true);
      const prof = { uid:"gestor", nickname:gNick.trim(), avatar:gAv, color:gCol, role:"gestor" };
      await set(ref(db,`rooms/${roomCode}/players/gestor`), prof);
      setProfile(prof); setStep("play");
      setGLoad(false);
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
            <div style={{fontSize:60,filter:`drop-shadow(0 0 14px ${gCol})`}}>{gAv}</div>
            <div style={{color:gCol,fontWeight:700,fontSize:18,marginTop:4}}>{gNick||"Gestor"}</div>
          </div>
          <label style={{color:"#777",fontSize:13,display:"block",marginBottom:6}}>Nombre del gestor</label>
          <input value={gNick} onChange={e=>setGNick(e.target.value)} placeholder="Dr. Stats"
            style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a2a3a",borderRadius:10,
              padding:"10px 14px",color:"#fff",fontFamily:"inherit",fontSize:15,
              marginBottom:16,boxSizing:"border-box",outline:"none"}}/>
          <label style={{color:"#777",fontSize:13,display:"block",marginBottom:8}}>Color</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
            {COLORS.map(c=>(
              <button key={c} onClick={()=>setGCol(c)} style={{width:28,height:28,background:c,
                borderRadius:"50%",border:`3px solid ${gCol===c?"#fff":"transparent"}`,cursor:"pointer"}}/>
            ))}
          </div>
          <Btn onClick={joinGestor} disabled={!gNick.trim()||gLoad} variant="purple" style={{width:"100%"}}>
            {gLoad?"Entrando...":"Entrar como Gestor"}
          </Btn>
        </Card>
      </div>
    );
  }

  if (step==="play") {
    if (role==="gestor") return <GestorScreen roomCode={roomCode}/>;
    return <PlayerScreen roomCode={roomCode} playerId={uid} profile={profile}/>;
  }
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,   setScreen]   = useState("home");
  const [roomCode, setRoomCode] = useState(null);

  if (screen==="home")   return <HomeScreen   onGestor={()=>setScreen("create")} onJoin={c=>{ setRoomCode(c); setScreen("join"); }}/>;
  if (screen==="create") return <CreateRoomScreen onCreated={code=>{ setRoomCode(code); setScreen("join"); }}/>;
  if (screen==="join")   return <JoinFlow roomCode={roomCode} onBack={()=>setScreen("home")}/>;
}
