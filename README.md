# 🎃 Trick or Treat — Guía de Instalación y Deploy

## ¿Qué es esto?
Aplicación web para el experimento estadístico **"Trick or Treat"**: un juego de dados e información imperfecta para medir el beneficio de hacer trampa.

---

## 📋 Requisitos previos
- Node.js 18+ instalado ([nodejs.org](https://nodejs.org))
- Cuenta en [Firebase](https://firebase.google.com) (gratis)
- Cuenta en [Vercel](https://vercel.com) (gratis)
- Cuenta en [GitHub](https://github.com)

---

## 🔥 Paso 1: Configurar Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com)
2. Haz clic en **"Agregar proyecto"** → ponle nombre → continuar
3. En el menú izquierdo: **Build → Realtime Database**
4. Haz clic en **"Crear base de datos"**
   - Elige la ubicación más cercana (ej. `us-central1`)
   - Modo: **"Empezar en modo de prueba"** (por ahora)
5. Copia la URL de tu base de datos (termina en `.firebaseio.com`)

### Registrar la app web en Firebase:
1. En la página del proyecto → ícono `</>` (Web)
2. Ponle nombre (ej. "trick-or-treat-web")
3. **NO** marques "Firebase Hosting" (usaremos Vercel)
4. Copia el objeto `firebaseConfig` que aparece:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "tu-proyecto.firebaseapp.com",
  databaseURL: "https://tu-proyecto-default-rtdb.firebaseio.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### Aplicar las reglas de seguridad:
1. En Firebase Console → Realtime Database → **Reglas**
2. Pega el contenido de `firebase.rules.json`:
```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```
3. Haz clic en **Publicar**

---

## ⚙️ Paso 2: Configurar el proyecto

1. Abre el archivo `src/App.jsx`
2. Busca la sección `// ─── FIREBASE CONFIG` al inicio del archivo
3. Reemplaza el objeto `firebaseConfig` con tus datos de Firebase:

```js
const firebaseConfig = {
  apiKey: "TU_API_KEY_REAL",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  databaseURL: "https://TU_PROYECTO-default-rtdb.firebaseio.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID",
};
```

---

## 💻 Paso 3: Instalar y probar localmente

```bash
# En la carpeta del proyecto:
npm install

# Iniciar servidor de desarrollo:
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173) en el navegador.

---

## 🚀 Paso 4: Subir a GitHub

```bash
# Inicializar repositorio (si no existe):
git init
git add .
git commit -m "feat: Trick or Treat v1.0"

# Crear repo en GitHub y conectar:
git remote add origin https://github.com/TU_USUARIO/trick-or-treat.git
git push -u origin main
```

---

## ▲ Paso 5: Deploy en Vercel

1. Ve a [vercel.com](https://vercel.com) → **Sign up with GitHub**
2. Haz clic en **"New Project"**
3. Importa tu repositorio `trick-or-treat`
4. Configuración:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. Haz clic en **Deploy**

¡Listo! En ~2 minutos tendrás una URL pública como `https://trick-or-treat-xxx.vercel.app`

### Auto-deploy:
Cada vez que hagas `git push`, Vercel redeploya automáticamente.

---

## 🎮 Cómo usar en el experimento

### El Gestor:
1. Abre la app → **"Crear sala como Gestor"**
2. Define contraseña y rondas → **Crear sala**
3. Anota el **código de sala** (5 letras)
4. Entra como Gestor → pone su perfil → panel de control
5. **Abre la sala** cuando todos estén listos
6. Selecciona la **fase experimental** (Control / A Tramposo / B Tramposo / Ambos)
7. Presiona **"Nueva mano"** para iniciar cada ronda

### Los Jugadores:
1. Abren la app en su dispositivo
2. Ingresan el **código de sala**
3. Eligen su rol (A o B)
4. Crean su perfil (avatar, nickname, color)
5. Esperan que el gestor abra la sala
6. Juegan desde su propio dispositivo

### Al terminar:
1. El Gestor va a **"Datos"** en su panel
2. Hace clic en **"Exportar CSV"**
3. Analiza en R con los logs de: jugador, acción, ronda, EV, tiempo, fase, resultado

---

## 📊 Estructura del CSV exportado

| Columna | Descripción |
|---------|-------------|
| `hand` | Número de mano |
| `jugador` | A o B |
| `accion` | apostar / retirarse / resultado |
| `ronda` | 1 a N |
| `ev` | Ventaja esperada (0–1) |
| `tiempo_ms` | Milisegundos de decisión |
| `fase` | control / A_pos / B_pos / ambos |
| `resultado` | Ganador de esa mano |

---

## 🏗️ Arquitectura del sistema

```
Firebase Realtime Database
└── rooms/
    └── {CÓDIGO_SALA}/
        ├── config/     ← fase, rondas, open/close
        ├── state/      ← dados, ronda, turno, pot, resultados
        ├── balance/    ← fichas A, B, partidas
        ├── players/    ← perfiles (avatar, color, nickname)
        └── logs/       ← todos los eventos del experimento
```

---

## 🐛 Problemas comunes

**"Sala no encontrada"**: Verifica que el código sea correcto (5 caracteres, mayúsculas)

**"La sala aún no está abierta"**: El gestor debe presionar "Abrir sala" primero

**La app no conecta a Firebase**: Verifica que el `firebaseConfig` en `App.jsx` esté correcto

**Balances inconsistentes**: Usa "Reiniciar sesión" en el panel del gestor entre participantes

---

## 📦 Estructura de archivos

```
trick-or-treat/
├── src/
│   ├── App.jsx          ← Toda la lógica y UI del juego
│   └── main.jsx         ← Entry point React
├── index.html           ← HTML base
├── package.json         ← Dependencias
├── vite.config.js       ← Config del bundler
├── firebase.rules.json  ← Reglas de seguridad Firebase
└── README.md            ← Este archivo
```
