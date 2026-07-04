// test_game_logic.mjs — Node puro, sin dependencias.
// Ejecutar: node test_game_logic.mjs
//
// Valida por Monte Carlo la lógica pura del juego de dados de src/App.jsx:
//   (a) P(tres unos en 4 dados) empírica vs teórica
//   (b) conservación de fichas (sum(balances) + fichas_casa = total inicial)
//       en 1000 partidas simuladas end-to-end (ante + pot + resolución)
//   (c) convergencia de estimateWinProb a la P real (manos fijadas a mano,
//       comparada contra una enumeración exhaustiva exacta)
//
// mantener sincronizado: las funciones de abajo son copia mínima de
// src/App.jsx — roll() L74, top3score() L123-141, estimateWinProb() L148-163.
// El bloque de simulación (b) replica el flujo de ante/pot/resolución de
// resolveRondaDB() / finalizarPartidaDB() (~L1023-1113): ante de 1 ficha por
// jugador y por ronda apostada, empate→casa, tres-unos→victoria automática,
// retirada→gana el rival, doble retirada→casa.

const roll = () => Math.floor(Math.random() * 6) + 1;

function top3score(privados, publicosVisibles) {
  const pool = [...privados, ...publicosVisibles];
  const unos = pool.filter(v => v === 1);
  if (unos.length >= 3) {
    return { score: 3, best3: [1, 1, 1], tresumos: true };
  }
  const sorted = [...pool].sort((a, b) => b - a);
  const best3 = sorted.slice(0, 3);
  const score = best3.reduce((a, b) => a + b, 0);
  return { score, best3, tresumos: false };
}

function estimateWinProb(myPrivate, publicVisible, samples = 600, knownRivalDice = []) {
  const pubRemaining = 2 - publicVisible.length;
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const pub = [...publicVisible];
    for (let j = 0; j < pubRemaining; j++) pub.push(roll());
    const myRes = top3score(myPrivate, pub);
    const rd = [...knownRivalDice];
    while (rd.length < 2) rd.push(roll());
    const oppRes = top3score(rd, pub);
    const iWin = (myRes.tresumos && !oppRes.tresumos) ||
                 (!myRes.tresumos && !oppRes.tresumos && myRes.score > oppRes.score);
    if (iWin) wins++;
  }
  return wins / samples;
}

// ── utilidades de test ───────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  OK   ${name}`); }
  else      { failed++; console.log(`  FAIL ${name}  ${detail}`); }
}
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

function* combos(k, faces = [1,2,3,4,5,6]) {
  if (k === 0) { yield []; return; }
  for (const f of faces) for (const rest of combos(k - 1, faces)) yield [f, ...rest];
}

// Probabilidad exacta de ganar por enumeración exhaustiva (sin trampa):
// recorre todos los públicos restantes x todos los dados posibles del rival.
function exactWinProb(myPrivate, publicVisible) {
  const pubRemaining = 2 - publicVisible.length;
  let wins = 0, total = 0;
  for (const pubExtra of combos(pubRemaining)) {
    const pub = [...publicVisible, ...pubExtra];
    const myRes = top3score(myPrivate, pub);
    for (const rd of combos(2)) {
      const oppRes = top3score(rd, pub);
      const iWin = (myRes.tresumos && !oppRes.tresumos) ||
                   (!myRes.tresumos && !oppRes.tresumos && myRes.score > oppRes.score);
      if (iWin) wins++;
      total++;
    }
  }
  return wins / total;
}

console.log("=== (a) P(tres unos en 4 dados) empírica vs teórica ===");
{
  const N = 200000;
  let count = 0;
  for (let i = 0; i < N; i++) {
    const dice = [roll(), roll(), roll(), roll()];
    if (dice.filter(v => v === 1).length >= 3) count++;
  }
  const empirica = count / N;
  // P(>=3 unos en 4 dados de 6 caras) = C(4,3)(1/6)^3(5/6) + C(4,4)(1/6)^4
  const teorica = 4 * Math.pow(1/6, 3) * (5/6) + Math.pow(1/6, 4);
  console.log(`  N=${N}  empírica=${empirica.toFixed(5)}  teórica=${teorica.toFixed(5)}`);
  check("tres-unos: empírica ~ teórica (±0.002)", approx(empirica, teorica, 0.002),
    `emp=${empirica} teo=${teorica}`);
}

console.log("\n=== (b) conservación de fichas en 1000 partidas simuladas ===");
{
  let balP1 = 10, balP2 = 10;
  const totalInicial = 20;
  let potsToCasa = 0;
  const N = 1000;
  const FOLD_PROB = 0.15;

  for (let partida = 0; partida < N; partida++) {
    balP1 -= 1; balP2 -= 1;           // ante inicial
    let pot = 2;
    const dP1 = [roll(), roll()];
    const dP2 = [roll(), roll()];
    const pub = [roll(), roll()];

    let ganador = null;               // "P1" | "P2" | "casa"
    for (let ronda = 1; ronda <= 3 && !ganador; ronda++) {
      const aFold = Math.random() < FOLD_PROB;
      const bFold = Math.random() < FOLD_PROB;

      if (aFold && bFold) { ganador = "casa"; break; }
      if (aFold)          { ganador = "P2";   break; }
      if (bFold)          { ganador = "P1";   break; }

      // ambos apostaron: ante de la ronda
      pot += 2; balP1 -= 1; balP2 -= 1;
      if (ronda >= 3) {
        const resA = top3score(dP1, pub);
        const resB = top3score(dP2, pub);
        if (resA.tresumos && !resB.tresumos)      ganador = "P1";
        else if (resB.tresumos && !resA.tresumos) ganador = "P2";
        else if (resA.score > resB.score)         ganador = "P1";
        else if (resB.score > resA.score)         ganador = "P2";
        else                                       ganador = "casa";
      }
    }

    if      (ganador === "casa") potsToCasa += pot;
    else if (ganador === "P1")   balP1 += pot;
    else                          balP2 += pot;
  }

  const derivedCasa = totalInicial - (balP1 + balP2);
  console.log(`  balP1=${balP1} balP2=${balP2} potsToCasa(ledger)=${potsToCasa} total-sum(balances)=${derivedCasa}`);
  check("sum(balances) + fichas_casa == total inicial (exacto, 1000 partidas)",
    derivedCasa === potsToCasa, `derivedCasa=${derivedCasa} potsToCasa=${potsToCasa}`);
}

console.log("\n=== (c) win_prob converge a la P real (manos fijadas) ===");
{
  const hands = [
    { label: "ronda1, sin públicos revelados",      myPrivate: [6,6], publicVisible: [] },
    { label: "ronda2, 1 público revelado",          myPrivate: [3,3], publicVisible: [5] },
    { label: "ronda3, tres-unos forzado (1,1|1,4)", myPrivate: [1,1], publicVisible: [1,4] },
  ];

  for (const h of hands) {
    const exact = exactWinProb(h.myPrivate, h.publicVisible);
    const mc    = estimateWinProb(h.myPrivate, h.publicVisible, 200000);
    console.log(`  [${h.label}] exacta=${exact.toFixed(5)}  montecarlo=${mc.toFixed(5)}`);
    check(`win_prob converge (±0.01): ${h.label}`, approx(exact, mc, 0.01),
      `exact=${exact} mc=${mc}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
