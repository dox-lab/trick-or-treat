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

// ─── AVATARES ─────────────────────────────────────────────────────────────────
const AVATARS = ["🦇", "🐺", "🕷️", "🦉", "🐈‍⬛", "💀", "🐸", "🦊", "🐙", "🐝"];
const COLORS = [
  "#f97316","#22c55e","#a855f7","#3b82f6","#ef4444",
  "#eab308","#06b6d4","#ec4899","#14b8a6","#f59e0b",
];

// ─── UTILS ────────────────────────────────────────────────────────────────────
const rollDie = () => Math.floor(Math.random() * 6) + 1;
const genCode = () => Math.random().toString(36).substring(2, 7).toUpperCase();
const calcEV = (dice) => dice.reduce((a, b) => a + b, 0) / (6 * dice.length);

// ─── DADO SVG ─────────────────────────────────────────────────────────────────
const DOT_POSITIONS = {
  1: [[50, 50]],
  2: [[25, 25],[75, 75]],
  3: [[25, 25],[50, 50],[75, 75]],
  4: [[25, 25],[75, 25],[25, 75],[75, 75]],
  5: [[25, 25],[75, 25],[50, 50],[25, 75],[75, 75]],
  6: [[25, 20],[75, 20],[25, 50],[75, 50],[25, 80],[75, 80]],
};

function Die({ value, hidden = false, size = 64, glow = false, color = "#f97316" }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 100 100"
      style={{
        borderRadius: 14,
        background: hidden ? "#1e1e2e" : "#0f0f1a",
        border: `2px solid ${glow ? color : "#333"}`,
        boxShadow: glow ? `0 0 12px ${color}88` : "none",
        flexShrink: 0,
      }}
    >
      {hidden ? (
        <text x="50" y="65" textAnchor="middle" fontSize="42" fill="#444">?</text>
      ) : (
        (DOT_POSITIONS[value] || []).map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={9} fill={color} />
        ))
      )}
    </svg>
  );
}

function DiceRow({ dice, hidden = false, size = 56, color = "#f97316" }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
      {dice.map((v, i) => (
        <Die key={i} value={v} hidden={hidden} size={size} color={color} glow={!hidden} />
      ))}
    </div>
  );
}

// ─── COMPONENTES BASE ─────────────────────────────────────────────────────────
function Card({ children, style = {}, accent = "#f97316" }) {
  return (
    <div style={{
      background: "#12121e",
      border: `1px solid ${accent}44`,
      borderRadius: 16,
      padding: "20px 24px",
      boxShadow: `0 0 20px ${accent}11`,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", disabled = false, style = {} }) {
  const variants = {
    primary: { bg: "#f97316", color: "#000", border: "none" },
    success: { bg: "#22c55e", color: "#000", border: "none" },
    danger:  { bg: "#ef4444", color: "#fff", border: "none" },
    ghost:   { bg: "transparent", color: "#f97316", border: "1px solid #f97316" },
    purple:  { bg: "#a855f7", color: "#fff", border: "none" },
  };
  const v = variants[variant] || variants.primary;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "#333" : v.bg,
        color: disabled ? "#666" : v.color,
        border: v.border,
        borderRadius: 10,
        padding: "10px 22px",
        fontWeight: 700,
        fontSize: 15,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.15s",
        fontFamily: "inherit",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function EVBar({ value, label, color = "#f97316" }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", marginBottom: 4 }}>
        <span>{label}</span><span style={{ color }}>{pct}%</span>
      </div>
      <div style={{ background: "#222", borderRadius: 6, height: 8 }}>
        <div style={{ width: `${pct}%`, background: color, borderRadius: 6, height: "100%", transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

// ─── PANTALLA: INICIO ─────────────────────────────────────────────────────────
function HomeScreen({ onGestor, onJoin }) {
  const [joinCode, setJoinCode] = useState("");
  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "40px 20px" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 64, marginBottom: 8 }}>🎃</div>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: "#f97316", margin: 0, letterSpacing: -1 }}>
          TRICK OR TREAT
        </h1>
        <p style={{ color: "#666", marginTop: 8, fontSize: 14 }}>
          Experimento de teoría de juegos · UTEC
        </p>
      </div>

      <Card accent="#a855f7" style={{ marginBottom: 16 }}>
        <p style={{ color: "#aaa", margin: "0 0 14px", fontSize: 13 }}>¿Eres el investigador?</p>
        <Btn onClick={onGestor} variant="purple" style={{ width: "100%" }}>
          🔬 Crear sala como Gestor
        </Btn>
      </Card>

      <Card accent="#f97316">
        <p style={{ color: "#aaa", margin: "0 0 14px", fontSize: 13 }}>¿Eres un jugador?</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Código de sala"
            maxLength={5}
            style={{
              flex: 1, background: "#0a0a0f", border: "1px solid #333",
              borderRadius: 10, padding: "10px 14px", color: "#fff",
              fontFamily: "monospace", fontSize: 18, letterSpacing: 3,
              outline: "none",
            }}
          />
          <Btn onClick={() => onJoin(joinCode)} disabled={joinCode.length < 4}>
            Unirse
          </Btn>
        </div>
      </Card>
    </div>
  );
}

// ─── PANTALLA: CREAR SALA (GESTOR) ────────────────────────────────────────────
function CreateRoomScreen({ onCreated }) {
  const [password, setPassword] = useState("");
  const [rounds, setRounds] = useState(5);
  const [loading, setLoading] = useState(false);

  const create = async () => {
    if (!password) return;
    setLoading(true);
    const code = genCode();
    const roomRef = ref(db, `rooms/${code}`);
    const room = {
      code,
      password,
      config: { rounds, fase: "control", open: false },
      state: {
        hand: 0,
        ronda: 0,
        turno: null,
        A_dados: [0, 0],
        B_dados: [0, 0],
        mesa: [0, 0],
        pot: 0,
        finalizado: true,
        msg: "",
        resultado_A: "",
        resultado_B: "",
      },
      balance: { A: 10, B: 10, partidas: 0 },
      players: {},
      logs: {},
      createdAt: serverTimestamp(),
    };
    await set(roomRef, room);
    setLoading(false);
    onCreated(code, password);
  };

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "40px 20px" }}>
      <h2 style={{ color: "#a855f7", marginBottom: 24 }}>🔬 Nueva Sala Experimental</h2>
      <Card accent="#a855f7">
        <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 6 }}>
          Contraseña del gestor
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Solo tú la verás"
          style={{
            width: "100%", background: "#0a0a0f", border: "1px solid #333",
            borderRadius: 10, padding: "10px 14px", color: "#fff",
            fontFamily: "inherit", fontSize: 15, marginBottom: 20, boxSizing: "border-box",
            outline: "none",
          }}
        />

        <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 6 }}>
          Rondas por mano: <span style={{ color: "#f97316" }}>{rounds}</span>
        </label>
        <input
          type="range" min={3} max={7} value={rounds}
          onChange={e => setRounds(+e.target.value)}
          style={{ width: "100%", marginBottom: 24, accentColor: "#f97316" }}
        />

        <Btn onClick={create} disabled={!password || loading} variant="purple" style={{ width: "100%" }}>
          {loading ? "Creando..." : "Crear sala"}
        </Btn>
      </Card>
    </div>
  );
}

// ─── PANTALLA: PERFIL DE JUGADOR ──────────────────────────────────────────────
function ProfileScreen({ roomCode, role, onJoined }) {
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const join = async () => {
    if (!nickname.trim()) return;
    setLoading(true);
    const roomRef = ref(db, `rooms/${roomCode}`);
    const snap = await get(roomRef);
    if (!snap.exists()) { setError("Sala no encontrada"); setLoading(false); return; }
    const room = snap.val();
    if (!room.config.open && role !== "gestor") {
      setError("La sala aún no está abierta. Espera al gestor."); setLoading(false); return;
    }
    const profile = { nickname: nickname.trim(), avatar, color, role, joinedAt: Date.now() };
    await update(ref(db, `rooms/${roomCode}/players/${role}`), profile);
    setLoading(false);
    onJoined(profile);
  };

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "40px 20px" }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#666", fontFamily: "monospace" }}>SALA</span>
        <div style={{ fontSize: 28, fontWeight: 900, color: "#f97316", fontFamily: "monospace", letterSpacing: 4 }}>
          {roomCode}
        </div>
        <div style={{ fontSize: 13, color: "#a855f7", marginBottom: 20 }}>
          Entrando como: {role === "A" ? "Jugador A" : role === "B" ? "Jugador B" : "Gestor"}
        </div>
      </div>

      <Card>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{
            fontSize: 72, lineHeight: 1,
            filter: `drop-shadow(0 0 12px ${color})`,
            marginBottom: 8,
          }}>{avatar}</div>
          <div style={{ fontWeight: 700, color, fontSize: 18 }}>{nickname || "Tu nombre aquí"}</div>
        </div>

        <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 8 }}>Nickname</label>
        <input
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          placeholder="Ej: StatsWizard"
          maxLength={16}
          style={{
            width: "100%", background: "#0a0a0f", border: "1px solid #333",
            borderRadius: 10, padding: "10px 14px", color: "#fff",
            fontFamily: "inherit", fontSize: 15, marginBottom: 16, boxSizing: "border-box",
            outline: "none",
          }}
        />

        <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 8 }}>Avatar</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {AVATARS.map(a => (
            <button key={a} onClick={() => setAvatar(a)} style={{
              fontSize: 28, background: avatar === a ? "#1e1e2e" : "transparent",
              border: `2px solid ${avatar === a ? color : "#333"}`,
              borderRadius: 10, padding: 6, cursor: "pointer",
              transition: "all 0.15s",
            }}>{a}</button>
          ))}
        </div>

        <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 8 }}>Color</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} style={{
              width: 32, height: 32, background: c, borderRadius: "50%",
              border: `3px solid ${color === c ? "#fff" : "transparent"}`,
              cursor: "pointer",
            }} />
          ))}
        </div>

        {error && <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <Btn onClick={join} disabled={!nickname.trim() || loading} style={{ width: "100%" }}>
          {loading ? "Entrando..." : "Entrar al juego"}
        </Btn>
      </Card>
    </div>
  );
}

// ─── PANTALLA: GESTOR ─────────────────────────────────────────────────────────
function GestorScreen({ roomCode, password, profile }) {
  const [room, setRoom] = useState(null);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("control");
  const [newRounds, setNewRounds] = useState(5);

  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsub = onValue(roomRef, snap => {
      if (snap.exists()) {
        const r = snap.val();
        setRoom(r);
        setNewRounds(r.config?.rounds || 5);
        setLogs(r.logs ? Object.values(r.logs).sort((a, b) => a.ts - b.ts) : []);
      }
    });
    return () => off(roomRef);
  }, [roomCode]);

  const openRoom = () => update(ref(db, `rooms/${roomCode}/config`), { open: true });
  const closeRoom = () => update(ref(db, `rooms/${roomCode}/config`), { open: false });

  const setFase = (fase) => update(ref(db, `rooms/${roomCode}/config`), { fase });

  const startHand = async () => {
    const r = room;
    const rounds = r.config.rounds || 5;
    const A = [rollDie(), rollDie()];
    const B = [rollDie(), rollDie()];
    const mesa = Array.from({ length: rounds - 2 }, rollDie);
    const newBalance = {
      A: (r.balance?.A || 10) - 1,
      B: (r.balance?.B || 10) - 1,
      partidas: (r.balance?.partidas || 0) + 1,
    };
    await update(ref(db, `rooms/${roomCode}`), {
      "state/hand": (r.state?.hand || 0) + 1,
      "state/ronda": 1,
      "state/turno": "A",
      "state/A_dados": A,
      "state/B_dados": B,
      "state/mesa": mesa,
      "state/pot": 2,
      "state/finalizado": false,
      "state/msg": "",
      "state/resultado_A": "",
      "state/resultado_B": "",
      "state/inicio_turno": Date.now(),
      "balance/A": newBalance.A,
      "balance/B": newBalance.B,
      "balance/partidas": newBalance.partidas,
    });
  };

  const resetSession = async () => {
    await update(ref(db, `rooms/${roomCode}`), {
      "balance/A": 10,
      "balance/B": 10,
      "balance/partidas": 0,
      "state/finalizado": true,
      "state/msg": "Sesión reiniciada",
      "state/ronda": 0,
      logs: null,
    });
  };

  const exportCSV = () => {
    if (!logs.length) return;
    const cols = ["hand","jugador","accion","ronda","ev","tiempo_ms","fase","resultado"];
    const rows = logs.map(l => cols.map(c => l[c] ?? "").join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `trick_or_treat_${roomCode}.csv`; a.click();
  };

  const updateRounds = () => update(ref(db, `rooms/${roomCode}/config`), { rounds: newRounds });

  if (!room) return <div style={{ color: "#666", padding: 40, textAlign: "center" }}>Cargando sala…</div>;

  const { state, balance, config, players } = room;
  const fase = config?.fase || "control";
  const FASE_LABELS = { control: "Control", A_pos: "A Tramposo", B_pos: "B Tramposo", ambos: "Ambos Tramposos" };

  const tabs = [
    { id: "control", label: "🎮 Control" },
    { id: "data", label: "📊 Datos" },
    { id: "config", label: "⚙️ Config" },
  ];

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: "#666", fontFamily: "monospace" }}>GESTOR · SALA</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#a855f7", fontFamily: "monospace", letterSpacing: 3 }}>{roomCode}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            display: "inline-block", padding: "4px 12px", borderRadius: 20,
            background: config?.open ? "#22c55e22" : "#ef444422",
            color: config?.open ? "#22c55e" : "#ef4444",
            fontSize: 12, fontWeight: 700,
          }}>
            {config?.open ? "● ABIERTA" : "● CERRADA"}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#1e1e2e", borderRadius: 12, padding: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            flex: 1, padding: "8px 4px", background: activeTab === t.id ? "#a855f7" : "transparent",
            border: "none", borderRadius: 8, color: activeTab === t.id ? "#fff" : "#666",
            fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}>{t.label}</button>
        ))}
      </div>

      {/* TAB: CONTROL */}
      {activeTab === "control" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Sala */}
          <Card accent="#a855f7">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn onClick={openRoom} variant="success" disabled={config?.open}>Abrir sala</Btn>
              <Btn onClick={closeRoom} variant="danger" disabled={!config?.open}>Cerrar sala</Btn>
              <Btn onClick={startHand} disabled={!config?.open || !state?.finalizado}>▶ Nueva mano</Btn>
              <Btn onClick={resetSession} variant="ghost">↺ Reiniciar sesión</Btn>
            </div>
          </Card>

          {/* Fase */}
          <Card accent="#f97316">
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>FASE EXPERIMENTAL</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(FASE_LABELS).map(([k, v]) => (
                <button key={k} onClick={() => setFase(k)} style={{
                  padding: "7px 14px", borderRadius: 8, fontWeight: 700, fontSize: 13,
                  background: fase === k ? "#f97316" : "#1e1e2e",
                  color: fase === k ? "#000" : "#aaa",
                  border: `1px solid ${fase === k ? "#f97316" : "#333"}`,
                  cursor: "pointer", fontFamily: "inherit",
                }}>{v}</button>
              ))}
            </div>
          </Card>

          {/* Jugadores */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {["A", "B"].map(p => {
              const pl = players?.[p];
              const bal = balance?.[p] ?? 10;
              const ev = state?.finalizado ? null :
                calcEV([...(state?.[`${p}_dados`] || []), ...(state?.mesa || []).slice(0, Math.max(0, (state?.ronda || 1) - 1))]);
              return (
                <Card key={p} accent={p === "A" ? "#3b82f6" : "#f97316"}>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>JUGADOR {p}</div>
                  {pl ? (
                    <>
                      <div style={{ fontSize: 24 }}>{pl.avatar} <span style={{ color: pl.color, fontWeight: 700 }}>{pl.nickname}</span></div>
                      <div style={{ color: "#aaa", fontSize: 13, marginTop: 4 }}>💰 {bal} fichas</div>
                      {ev !== null && <EVBar value={ev} label="EV" color={p === "A" ? "#3b82f6" : "#f97316"} />}
                      <DiceRow dice={state?.[`${p}_dados`] || [0, 0]} size={36} color={p === "A" ? "#3b82f6" : "#f97316"} />
                    </>
                  ) : (
                    <div style={{ color: "#444", fontSize: 13 }}>Esperando jugador…</div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Mesa */}
          <Card>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 12 }}>
              MESA · Ronda {state?.ronda || 0}/{config?.rounds || 5} · Turno: {state?.turno || "-"}
            </div>
            <DiceRow
              dice={(state?.mesa || []).map((v, i) => v)}
              hidden={false}
              size={48}
              color="#22c55e"
            />
            <div style={{ color: "#a855f7", fontWeight: 700, marginTop: 8 }}>🏆 Pozo: {state?.pot || 0} fichas</div>
            {state?.msg && <div style={{ color: "#f97316", marginTop: 8, fontWeight: 700 }}>{state.msg}</div>}
          </Card>
        </div>
      )}

      {/* TAB: DATOS */}
      {activeTab === "data" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ color: "#aaa", fontSize: 13 }}>{logs.length} eventos registrados</div>
            <Btn onClick={exportCSV} variant="success" style={{ fontSize: 13, padding: "7px 16px" }}>⬇ Exportar CSV</Btn>
          </div>
          <Card>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "monospace" }}>
                <thead>
                  <tr>
                    {["Mano","Jugador","Acción","Ronda","EV","Tiempo(ms)","Fase"].map(h => (
                      <th key={h} style={{ color: "#666", padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #333" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.slice(-50).reverse().map((l, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1a1a2a" }}>
                      <td style={{ padding: "5px 8px", color: "#aaa" }}>{l.hand}</td>
                      <td style={{ padding: "5px 8px", color: l.jugador === "A" ? "#3b82f6" : "#f97316", fontWeight: 700 }}>{l.jugador}</td>
                      <td style={{ padding: "5px 8px", color: l.accion === "apostar" ? "#22c55e" : "#ef4444" }}>{l.accion}</td>
                      <td style={{ padding: "5px 8px", color: "#aaa" }}>{l.ronda}</td>
                      <td style={{ padding: "5px 8px", color: "#a855f7" }}>{(l.ev * 100).toFixed(0)}%</td>
                      <td style={{ padding: "5px 8px", color: "#aaa" }}>{l.tiempo_ms}</td>
                      <td style={{ padding: "5px 8px", color: "#aaa" }}>{l.fase}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!logs.length && <div style={{ color: "#444", padding: 20, textAlign: "center" }}>Sin datos aún</div>}
            </div>
          </Card>
        </div>
      )}

      {/* TAB: CONFIG */}
      {activeTab === "config" && (
        <Card accent="#a855f7">
          <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16 }}>CONFIGURACIÓN DE SALA</div>

          <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 6 }}>
            Rondas por mano: <span style={{ color: "#f97316" }}>{newRounds}</span>
          </label>
          <input
            type="range" min={3} max={7} value={newRounds}
            onChange={e => setNewRounds(+e.target.value)}
            style={{ width: "100%", marginBottom: 12, accentColor: "#f97316" }}
          />
          <Btn onClick={updateRounds} variant="ghost" style={{ marginBottom: 20 }}>
            Guardar rondas
          </Btn>

          <hr style={{ border: "none", borderTop: "1px solid #222", margin: "16px 0" }} />
          <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>CÓDIGO DE SALA (compartir con jugadores)</div>
          <div style={{
            fontFamily: "monospace", fontSize: 28, letterSpacing: 8, color: "#f97316",
            fontWeight: 900, background: "#0a0a0f", padding: "12px 20px", borderRadius: 10,
            textAlign: "center", marginBottom: 16,
          }}>{roomCode}</div>
          <p style={{ color: "#555", fontSize: 12, margin: 0 }}>
            Los jugadores deben ingresar este código en la pantalla de inicio y elegir su rol (A o B).
          </p>
        </Card>
      )}
    </div>
  );
}

// ─── PANTALLA: JUGADOR ────────────────────────────────────────────────────────
function PlayerScreen({ roomCode, role, profile }) {
  const [room, setRoom] = useState(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsub = onValue(roomRef, snap => {
      if (snap.exists()) setRoom(snap.val());
    });
    return () => off(roomRef);
  }, [roomCode]);

  const logEvent = async (accion, ev) => {
    const s = room.state;
    const logRef = push(ref(db, `rooms/${roomCode}/logs`));
    await set(logRef, {
      hand: s.hand || 0,
      jugador: role,
      accion,
      ronda: s.ronda,
      ev,
      tiempo_ms: Date.now() - (s.inicio_turno || Date.now()),
      fase: room.config?.fase || "control",
      ts: Date.now(),
    });
  };

  const apostar = async () => {
    if (waiting) return;
    setWaiting(true);
    const s = room.state;
    const bal = room.balance?.[role] || 0;
    if (bal <= 0) { setWaiting(false); return; }
    const myDice = s[`${role}_dados`] || [];
    const visibleMesa = (s.mesa || []).slice(0, Math.max(0, s.ronda - 1));
    const ev = calcEV([...myDice, ...visibleMesa]);
    await logEvent("apostar", ev);
    const updates = {
      [`balance/${role}`]: bal - 1,
      "state/pot": (s.pot || 0) + 1,
      "state/inicio_turno": Date.now(),
    };
    // Avanzar turno
    const otherRole = role === "A" ? "B" : "A";
    if (s.turno === role) {
      // Determinar si ambos ya jugaron esta ronda
      updates["state/turno"] = otherRole;
      // Si el otro ya se fue / terminó la ronda, pasar ronda
      // Lógica simple: siempre alternar
      if (s.ronda >= (room.config?.rounds || 5) && s.turno === "B") {
        await evalFinal(updates);
      } else {
        await update(ref(db, `rooms/${roomCode}`), updates);
        // Verificar si avanzar ronda (cuando B termina su turno)
        if (role === "B") {
          const nextRonda = s.ronda + 1;
          if (nextRonda > (room.config?.rounds || 5)) {
            await evalFinal({});
          } else {
            await update(ref(db, `rooms/${roomCode}/state`), { ronda: nextRonda, turno: "A" });
          }
        }
      }
    }
    setWaiting(false);
  };

  const retirarse = async () => {
    if (waiting) return;
    setWaiting(true);
    const s = room.state;
    const myDice = s[`${role}_dados`] || [];
    const visibleMesa = (s.mesa || []).slice(0, Math.max(0, s.ronda - 1));
    const ev = calcEV([...myDice, ...visibleMesa]);
    await logEvent("retirarse", ev);
    const winner = role === "A" ? "B" : "A";
    await finalizarMano(winner, `Retirada ${role}`);
    setWaiting(false);
  };

  const evalFinal = async (extraUpdates = {}) => {
    const s = room.state;
    const scoreA = (s.A_dados || []).reduce((a, b) => a + b, 0) + (s.mesa || []).reduce((a, b) => a + b, 0);
    const scoreB = (s.B_dados || []).reduce((a, b) => a + b, 0) + (s.mesa || []).reduce((a, b) => a + b, 0);
    // Check tres unos
    const allA = [...(s.A_dados || []), ...(s.mesa || [])];
    const allB = [...(s.B_dados || []), ...(s.mesa || [])];
    const tresunosA = allA.filter(v => v === 1).length >= 3;
    const tresunosB = allB.filter(v => v === 1).length >= 3;
    if (tresunosA && !tresunosB) { await finalizarMano("A", "Tres unos"); return; }
    if (tresunosB && !tresunosA) { await finalizarMano("B", "Tres unos"); return; }
    if (scoreA > scoreB) await finalizarMano("A", "Mayor suma");
    else if (scoreB > scoreA) await finalizarMano("B", "Mayor suma");
    else await finalizarMano("Casa", "Empate");
  };

  const finalizarMano = async (ganador, motivo) => {
    const s = room.state;
    const pot = s.pot || 0;
    const balA = room.balance?.A || 0;
    const balB = room.balance?.B || 0;
    let newBalA = balA, newBalB = balB;
    let msgA = "", msgB = "", msg = "";

    if (ganador === "A") {
      newBalA = balA + pot;
      msgA = `🏆 Ganaste ${pot} fichas (${motivo})`;
      msgB = motivo.includes("Retirada") ? "Perdiste por retiro" : `Perdiste ${pot} fichas`;
      msg = `🏆 Ganó Jugador A — ${motivo}`;
    } else if (ganador === "B") {
      newBalB = balB + pot;
      msgB = `🏆 Ganaste ${pot} fichas (${motivo})`;
      msgA = motivo.includes("Retirada") ? "Perdiste por retiro" : `Perdiste ${pot} fichas`;
      msg = `🏆 Ganó Jugador B — ${motivo}`;
    } else {
      const half = Math.floor(pot / 2);
      newBalA = balA + half;
      newBalB = balB + half;
      msgA = msgB = "Empate — pozo dividido";
      msg = "🤝 Empate — la casa lleva el resto";
    }

    // Log resultado
    const logRef = push(ref(db, `rooms/${roomCode}/logs`));
    await set(logRef, {
      hand: s.hand || 0,
      jugador: ganador,
      accion: "resultado",
      ronda: s.ronda,
      ev: 0,
      tiempo_ms: 0,
      fase: room.config?.fase || "control",
      resultado: ganador,
      motivo,
      ts: Date.now(),
    });

    await update(ref(db, `rooms/${roomCode}`), {
      "balance/A": newBalA,
      "balance/B": newBalB,
      "state/finalizado": true,
      "state/msg": msg,
      "state/resultado_A": msgA,
      "state/resultado_B": msgB,
    });
  };

  if (!room) return <div style={{ color: "#666", padding: 40, textAlign: "center" }}>Conectando…</div>;

  const { state, balance, config, players } = room;
  const s = state || {};
  const fase = config?.fase || "control";
  const myDice = s[`${role}_dados`] || [0, 0];
  const otherRole = role === "A" ? "B" : "A";
  const otherPlayer = players?.[otherRole];
  const myBalance = balance?.[role] ?? 10;
  const myColor = profile?.color || (role === "A" ? "#3b82f6" : "#f97316");
  const myTurn = s.turno === role && !s.finalizado;

  // Trampa: ¿puede ver un dado del rival?
  const canCheat = fase === `${role}_pos` || fase === "ambos";
  const otherDice = s[`${otherRole}_dados`] || [0, 0];

  // Mesa visible según ronda
  const totalRounds = config?.rounds || 5;
  const visibleMesaCount = Math.max(0, (s.ronda || 1) - 1);
  const mesa = (s.mesa || []);

  // EV
  const visibleMesa = mesa.slice(0, visibleMesaCount);
  const ev = myDice[0] ? calcEV([...myDice, ...visibleMesa]) : 0;

  if (!config?.open) {
    return (
      <div style={{ maxWidth: 440, margin: "0 auto", padding: "60px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>⏳</div>
        <h2 style={{ color: "#f97316" }}>Esperando al gestor…</h2>
        <p style={{ color: "#666" }}>La sala aún no está abierta.</p>
        <Card style={{ marginTop: 20 }}>
          <div style={{ fontSize: 28 }}>{profile?.avatar}</div>
          <div style={{ color: profile?.color, fontWeight: 700, marginTop: 4 }}>{profile?.nickname}</div>
          <div style={{ color: "#666", fontSize: 13 }}>Jugador {role} · Sala {roomCode}</div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "20px 16px" }}>
      {/* Header jugador */}
      <Card accent={myColor} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 28 }}>{profile?.avatar} </span>
            <span style={{ color: myColor, fontWeight: 700, fontSize: 18 }}>{profile?.nickname}</span>
            <div style={{ color: "#666", fontSize: 12 }}>Jugador {role}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#f97316" }}>💰 {myBalance}</div>
            <div style={{ fontSize: 11, color: "#666" }}>fichas</div>
          </div>
        </div>
      </Card>

      {s.finalizado || !s.ronda ? (
        /* Esperando nueva mano */
        <Card style={{ textAlign: "center", padding: 40 }}>
          {s.resultado_A || s.resultado_B ? (
            <>
              <div style={{ fontSize: 48, marginBottom: 8 }}>
                {(role === "A" ? s.resultado_A : s.resultado_B)?.includes("Ganaste") ? "🏆" : "💔"}
              </div>
              <div style={{
                fontSize: 18, fontWeight: 700,
                color: (role === "A" ? s.resultado_A : s.resultado_B)?.includes("Ganaste") ? "#22c55e" : "#ef4444",
              }}>
                {role === "A" ? s.resultado_A : s.resultado_B}
              </div>
              <div style={{ color: "#666", fontSize: 13, marginTop: 8 }}>{s.msg}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🎃</div>
              <div style={{ color: "#666" }}>Esperando nueva mano…</div>
            </>
          )}
        </Card>
      ) : (
        <>
          {/* Ronda y turno */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Card style={{ flex: 1, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666" }}>RONDA</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#f97316" }}>{s.ronda}/{totalRounds}</div>
            </Card>
            <Card style={{ flex: 1, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666" }}>POZO</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#a855f7" }}>🏆 {s.pot}</div>
            </Card>
            <Card style={{ flex: 1, padding: "10px 14px", textAlign: "center",
              background: myTurn ? "#f9731611" : "#12121e",
              border: `1px solid ${myTurn ? "#f97316" : "#333"}`,
            }}>
              <div style={{ fontSize: 11, color: "#666" }}>TURNO</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: myTurn ? "#f97316" : "#666" }}>
                {myTurn ? "¡TÚ!" : `J.${s.turno}`}
              </div>
            </Card>
          </div>

          {/* Tus dados */}
          <Card accent={myColor} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 10 }}>TUS DADOS</div>
            <DiceRow dice={myDice} size={56} color={myColor} />
            <div style={{ marginTop: 12 }}>
              <EVBar value={ev} label="Tu ventaja esperada" color={myColor} />
            </div>
          </Card>

          {/* Mesa pública */}
          <Card accent="#22c55e" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 10 }}>MESA PÚBLICA</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {mesa.map((v, i) => (
                <Die key={i} value={v} hidden={i >= visibleMesaCount} size={48} color="#22c55e" glow={i < visibleMesaCount} />
              ))}
            </div>
          </Card>

          {/* Info rival */}
          <Card accent={canCheat ? "#eab308" : "#333"} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: canCheat ? "#eab308" : "#666", marginBottom: 10 }}>
              {canCheat ? "🃏 VENTAJA: VES UN DADO DEL RIVAL" : "RIVAL"}
            </div>
            {otherPlayer && (
              <div style={{ fontSize: 13, color: "#aaa", marginBottom: 8 }}>
                {otherPlayer.avatar} <span style={{ color: otherPlayer.color }}>{otherPlayer.nickname}</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Die value={otherDice[0]} hidden={!canCheat} size={48} color="#eab308" glow={canCheat} />
              <Die value={otherDice[1]} hidden={true} size={48} />
            </div>
          </Card>

          {/* Acciones */}
          {myTurn && (
            <div style={{ display: "flex", gap: 10 }}>
              <Btn
                onClick={apostar}
                disabled={waiting || myBalance <= 0}
                variant="success"
                style={{ flex: 1, fontSize: 16, padding: "14px 0" }}
              >
                💰 Apostar (+1)
              </Btn>
              <Btn
                onClick={retirarse}
                disabled={waiting}
                variant="danger"
                style={{ flex: 1, fontSize: 16, padding: "14px 0" }}
              >
                🏳 Retirarse
              </Btn>
            </div>
          )}

          {!myTurn && !s.finalizado && (
            <Card style={{ textAlign: "center", padding: 20 }}>
              <div style={{ color: "#666", fontSize: 14 }}>
                ⏳ Esperando al Jugador {s.turno}…
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── FLUJO DE ROLES AL UNIRSE ─────────────────────────────────────────────────
function JoinFlow({ roomCode, onBack }) {
  const [step, setStep] = useState("role"); // role | password | profile | play
  const [role, setRole] = useState(null);
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState(null);
  const [pwError, setPwError] = useState("");

  const chooseRole = (r) => { setRole(r); setStep(r === "gestor" ? "password" : "profile"); };

  const checkPassword = async () => {
    const snap = await get(ref(db, `rooms/${roomCode}/password`));
    if (snap.val() === password) setStep("profile");
    else setPwError("Contraseña incorrecta");
  };

  if (step === "role") return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "40px 20px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", marginBottom: 20 }}>← Volver</button>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#666", fontFamily: "monospace" }}>SALA</div>
        <div style={{ fontSize: 28, fontWeight: 900, color: "#f97316", fontFamily: "monospace", letterSpacing: 4 }}>{roomCode}</div>
      </div>
      <h2 style={{ color: "#fff", marginBottom: 20 }}>¿Quién eres?</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { r: "A", label: "Jugador A", color: "#3b82f6", emoji: "🎲" },
          { r: "B", label: "Jugador B", color: "#f97316", emoji: "🎲" },
          { r: "gestor", label: "Gestor / Investigador", color: "#a855f7", emoji: "🔬" },
        ].map(({ r, label, color, emoji }) => (
          <button key={r} onClick={() => chooseRole(r)} style={{
            background: "#12121e", border: `1px solid ${color}44`, borderRadius: 12,
            padding: "16px 20px", display: "flex", alignItems: "center", gap: 12,
            cursor: "pointer", textAlign: "left",
          }}>
            <span style={{ fontSize: 28 }}>{emoji}</span>
            <span style={{ color, fontWeight: 700, fontSize: 16 }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  if (step === "password") return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "40px 20px" }}>
      <h2 style={{ color: "#a855f7" }}>🔐 Contraseña del Gestor</h2>
      <Card accent="#a855f7">
        <input
          type="password" value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Contraseña"
          style={{
            width: "100%", background: "#0a0a0f", border: "1px solid #333",
            borderRadius: 10, padding: "10px 14px", color: "#fff",
            fontFamily: "inherit", fontSize: 15, marginBottom: 12, boxSizing: "border-box", outline: "none",
          }}
        />
        {pwError && <p style={{ color: "#ef4444", fontSize: 13, margin: "0 0 12px" }}>{pwError}</p>}
        <Btn onClick={checkPassword} variant="purple" style={{ width: "100%" }}>Verificar</Btn>
      </Card>
    </div>
  );

  if (step === "profile") return (
    <ProfileScreen roomCode={roomCode} role={role} onJoined={p => { setProfile(p); setStep("play"); }} />
  );

  if (step === "play") {
    if (role === "gestor") return <GestorScreen roomCode={roomCode} password={password} profile={profile} />;
    return <PlayerScreen roomCode={roomCode} role={role} profile={profile} />;
  }
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("home"); // home | create | join
  const [roomCode, setRoomCode] = useState(null);
  const [gestorPw, setGestorPw] = useState(null);

  if (screen === "home") return (
    <HomeScreen
      onGestor={() => setScreen("create")}
      onJoin={(code) => { setRoomCode(code); setScreen("join"); }}
    />
  );

  if (screen === "create") return (
    <CreateRoomScreen
      onCreated={(code, pw) => {
        setRoomCode(code); setGestorPw(pw);
        setScreen("join");
      }}
    />
  );

  if (screen === "join") return (
    <JoinFlow roomCode={roomCode} onBack={() => setScreen("home")} />
  );
}
