const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: false } });
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));
// Also support a single-file deployment where index.html sits beside server.js.
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
if (!DATABASE_URL) console.warn("WARNING: DATABASE_URL is not set; database routes will return a configuration error.");
if (!JWT_SECRET) console.warn("WARNING: JWT_SECRET is not set; authentication routes will be disabled.");

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
}) : null;

async function dbReady() {
  if (!pool) throw new Error("데이터베이스가 설정되지 않았습니다. Render PostgreSQL의 DATABASE_URL을 연결하세요.");
}
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    if (!JWT_SECRET) throw new Error("JWT_SECRET not configured");
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (_) { res.status(401).json({ error: "로그인이 필요하거나 세션이 만료되었습니다." }); }
}
async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) NOT NULL,
      username_key VARCHAR(24) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      trophies INTEGER NOT NULL DEFAULT 0 CHECK (trophies >= 0),
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      selected_hero VARCHAR(16) NOT NULL DEFAULT 'spider',
      unlocked JSONB NOT NULL DEFAULT '{"spider":true,"hammer":false,"meto":false}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
function publicProfile(row) {
  return {
    id: row.id, name: row.username, trophies: row.trophies, wins: row.wins, losses: row.losses,
    selectedHero: row.selected_hero, unlocked: row.unlocked
  };
}
app.get("/api/health", async (_req, res) => {
  let database = "not-configured";
  if (pool) {
    try { await pool.query("SELECT 1"); database = "connected"; }
    catch (_) { database = "error"; }
  }
  res.json({ ok: true, service: "wonjeok-dolgyuk", database });
});
app.post("/api/auth/register", async (req, res) => {
  try {
    await dbReady();
    if (!JWT_SECRET) return res.status(500).json({ error: "서버 인증 설정이 필요합니다." });
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
    if (!/^[가-힣a-zA-Z0-9_]{2,24}$/.test(name)) return res.status(400).json({ error: "이름은 한글·영문·숫자·밑줄로 2~24자여야 합니다." });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: "비밀번호는 8~72자로 설정해 주세요." });
    const key = name.toLocaleLowerCase("ko-KR");
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO players(username, username_key, password_hash) VALUES($1,$2,$3)
       RETURNING id, username, trophies, wins, losses, selected_hero, unlocked`,
      [name, key, hash]
    );
    const row = result.rows[0];
    const token = jwt.sign({ id: row.id, name: row.username }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, profile: publicProfile(row) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "이미 사용 중인 이름입니다." });
    console.error(e); res.status(500).json({ error: "회원가입에 실패했습니다." });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    await dbReady();
    if (!JWT_SECRET) return res.status(500).json({ error: "서버 인증 설정이 필요합니다." });
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
    const result = await pool.query("SELECT * FROM players WHERE username_key=$1", [name.toLocaleLowerCase("ko-KR")]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: "이름 또는 비밀번호가 올바르지 않습니다." });
    const token = jwt.sign({ id: row.id, name: row.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, profile: publicProfile(row) });
  } catch (e) { console.error(e); res.status(500).json({ error: "로그인에 실패했습니다." }); }
});
app.get("/api/profile", authRequired, async (req, res) => {
  try {
    await dbReady();
    const result = await pool.query("SELECT id, username, trophies, wins, losses, selected_hero, unlocked FROM players WHERE id=$1", [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "계정을 찾을 수 없습니다." });
    res.json({ profile: publicProfile(result.rows[0]) });
  } catch (e) { console.error(e); res.status(500).json({ error: "프로필을 불러오지 못했습니다." }); }
});
app.put("/api/profile", authRequired, async (req, res) => {
  try {
    await dbReady();
    const allowedHeroes = new Set(["spider", "hammer", "meto"]);
    const selected = allowedHeroes.has(req.body.selectedHero) ? req.body.selectedHero : "spider";
    const result = await pool.query("SELECT trophies, unlocked FROM players WHERE id=$1", [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "계정을 찾을 수 없습니다." });
    const trophies = result.rows[0].trophies;
    const old = result.rows[0].unlocked || {};
    const unlocked = {
      spider: true,
      hammer: Boolean(old.hammer || trophies >= 50),
      meto: Boolean(old.meto || trophies >= 100)
    };
    const safeSelected = unlocked[selected] ? selected : "spider";
    const saved = await pool.query(
      "UPDATE players SET selected_hero=$1, unlocked=$2::jsonb WHERE id=$3 RETURNING id, username, trophies, wins, losses, selected_hero, unlocked",
      [safeSelected, JSON.stringify(unlocked), req.user.id]
    );
    res.json({ profile: publicProfile(saved.rows[0]) });
  } catch (e) { console.error(e); res.status(500).json({ error: "프로필 저장에 실패했습니다." }); }
});
app.post("/api/match/result", authRequired, async (req, res) => {
  try {
    await dbReady();
    // This endpoint is intended to be called only after a server-verified match.
    // Until authoritative combat is integrated, reject client-submitted results.
    return res.status(501).json({ error: "전투 결과 검증은 실시간 전투 서버 통합 후 활성화됩니다." });
  } catch (e) { console.error(e); res.status(500).json({ error: "결과 저장에 실패했습니다." }); }
});

const waiting = [];
const socketUsers = new Map();
function removeFromQueue(socketId) {
  const i = waiting.findIndex(x => x.socketId === socketId);
  if (i >= 0) waiting.splice(i, 1);
}
io.on("connection", socket => {
  socket.emit("queue:status", { message: "온라인 서버에 연결됨" });
  socket.on("queue:join", payload => {
    removeFromQueue(socket.id);
    const user = {
      socketId: socket.id,
      since: Date.now(),
      name: String(payload?.name || "플레이어").slice(0, 24),
      hero: ["spider", "hammer", "meto"].includes(payload?.hero) ? payload.hero : "spider"
    };
    while (waiting.length) {
      const other = waiting.shift();
      const peer = io.sockets.sockets.get(other.socketId);
      if (!peer || !peer.connected) continue;
      const roomCode = `arena-${Math.random().toString(36).slice(2, 8)}`;
      socket.join(roomCode);
      peer.join(roomCode);
      socketUsers.set(socket.id, { roomCode, ...user });
      socketUsers.set(peer.id, { roomCode, ...other });
      peer.emit("match:found", { roomCode, opponentName: user.name, opponentHero: user.hero, side: "right" });
      socket.emit("match:found", { roomCode, opponentName: other.name, opponentHero: other.hero, side: "left" });
      return;
    }
    waiting.push(user);
    socket.emit("queue:status", { message: "실제 온라인 상대를 찾는 중…" });
  });
  socket.on("queue:leave", () => {
    removeFromQueue(socket.id);
    socket.emit("queue:status", { message: "매칭 대기 취소" });
  });
  socket.on("battle:state", data => {
    const match = socketUsers.get(socket.id);
    if (!match?.roomCode || !data || typeof data !== "object") return;
    const safe = {
      x: Math.max(48, Math.min(852, Number(data.x) || 450)),
      y: Math.max(48, Math.min(852, Number(data.y) || 450)),
      facing: { x: Math.max(-1, Math.min(1, Number(data.facing?.x) || 0)), y: Math.max(-1, Math.min(1, Number(data.facing?.y) || 0)) },
      hp: Math.max(0, Math.min(200, Number(data.hp) || 0)),
      maxHp: Math.max(1, Math.min(200, Number(data.maxHp) || 100)),
      alive: Boolean(data.alive), heroId: ["spider", "hammer", "meto"].includes(data.heroId) ? data.heroId : "spider",
      name: String(data.name || "플레이어").slice(0, 24),
      buffTime: Math.max(0, Math.min(10, Number(data.buffTime) || 0)),
      stunTime: Math.max(0, Math.min(5, Number(data.stunTime) || 0)),
      ultCharge: Math.max(0, Math.min(100, Number(data.ultCharge) || 0)),
      ammo: Math.max(0, Math.min(3, Number(data.ammo) || 0))
    };
    socket.to(match.roomCode).emit("battle:state", safe);
  });
  socket.on("battle:damage", data => {
    const match = socketUsers.get(socket.id);
    const amount = Math.max(0, Math.min(100, Number(data?.amount) || 0));
    if (match?.roomCode && amount > 0) socket.to(match.roomCode).emit("battle:damage", { amount });
  });
  socket.on("battle:leave", () => {
    const match = socketUsers.get(socket.id);
    if (match?.roomCode) {
      socket.to(match.roomCode).emit("battle:opponent-left");
      socket.leave(match.roomCode);
      socketUsers.delete(socket.id);
    }
  });
  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    const match = socketUsers.get(socket.id);
    if (match?.roomCode) socket.to(match.roomCode).emit("battle:opponent-left");
    socketUsers.delete(socket.id);
  });
});
setInterval(() => {
  const now = Date.now();
  for (let i = waiting.length - 1; i >= 0; i--) {
    if (now - waiting[i].since > 120000 || !io.sockets.sockets.has(waiting[i].socketId)) waiting.splice(i, 1);
  }
}, 15000).unref();

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
initDb().then(() => {
  server.listen(PORT, "0.0.0.0", () => console.log(`원격돌격 서버가 ${PORT} 포트에서 실행 중입니다.`));
}).catch(err => { console.error("Database initialization failed:", err); process.exit(1); });
