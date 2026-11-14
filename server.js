const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: false } });
app.use(express.json({ limit: "32kb" }));
const publicDir = path.join(__dirname, "public");
const rootIndexFile = path.join(__dirname, "index.html");
const publicIndexFile = path.join(publicDir, "index.html");
function findGameIndex() {
  if (fs.existsSync(rootIndexFile)) return rootIndexFile;
  if (fs.existsSync(publicIndexFile)) return publicIndexFile;
  return null;
}
app.use(express.static(publicDir));
// Serve index.html from the project root or public/ folder.
function sendGameIndex(_req, res) {
  const gameIndex = findGameIndex();
  if (!gameIndex) {
    console.error("[web] index.html missing. Checked:", rootIndexFile, publicIndexFile);
    return res.status(404).type("text/plain; charset=utf-8").send(
      "Game page not found. Put index.html beside server.js or inside public/. Check Render Root Directory."
    );
  }
  return res.sendFile(gameIndex);
}
app.get("/", sendGameIndex);

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
      unlocked JSONB NOT NULL DEFAULT '{"spider":true,"hammer":false,"meto":false,"bujijik":false,"adam":false,"yure":false,"joki":true,"gumi":false,"sniff":false,"kuro":false,"glover":false,"root":false,"magnet":false,"bolt":false}'::jsonb,
      coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
      mail_reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,
      mail_reward_read BOOLEAN NOT NULL DEFAULT FALSE,
      progression_version INTEGER NOT NULL DEFAULT 6,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Existing installations need a one-time migration because older versions gave Bujijik away for free.
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS progression_version INTEGER NOT NULL DEFAULT 1");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0)");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS mail_reward_claimed BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS mail_reward_read BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query(`UPDATE players SET unlocked = jsonb_set(COALESCE(unlocked, '{}'::jsonb), '{glover}', 'false'::jsonb, true) WHERE NOT (COALESCE(unlocked, '{}'::jsonb) ? 'glover')`);
  await pool.query(`UPDATE players SET unlocked = jsonb_set(jsonb_set(COALESCE(unlocked, '{}'::jsonb), '{bujijik}', to_jsonb(trophies >= 150), true), '{adam}', to_jsonb(trophies >= 200), true), progression_version=3 WHERE progression_version < 3`);
  await pool.query(`UPDATE players SET unlocked = jsonb_set(COALESCE(unlocked, '{}'::jsonb), '{yure}', COALESCE(unlocked->'yure', 'false'::jsonb), true), progression_version=4 WHERE progression_version < 4`);
  await pool.query(`UPDATE players SET unlocked = jsonb_set(COALESCE(unlocked, '{}'::jsonb), '{joki}', 'true'::jsonb, true), progression_version=5 WHERE progression_version < 5`);
  await pool.query(`UPDATE players SET unlocked = jsonb_set(COALESCE(unlocked, '{}'::jsonb), '{bolt}', COALESCE(unlocked->'bolt', 'false'::jsonb), true), progression_version=6 WHERE progression_version < 6`);
  await pool.query("ALTER TABLE players ALTER COLUMN progression_version SET DEFAULT 6");
}
function publicProfile(row) {
  return {
    id: row.id, name: row.username, trophies: row.trophies, wins: row.wins, losses: row.losses,
    selectedHero: row.selected_hero, unlocked: row.unlocked,
    coins: Number(row.coins) || 0,
    mailRewardClaimed: Boolean(row.mail_reward_claimed),
    mailRewardRead: Boolean(row.mail_reward_read)
  };
}
app.get("/api/health", async (_req, res) => {
  let database = "not-configured";
  if (pool) {
    try { await pool.query("SELECT 1"); database = "connected"; }
    catch (_) { database = "error"; }
  }
  const gameIndex = findGameIndex();
  res.json({
    ok: true,
    service: "wonjeok-dolgyuk",
    database,
    webRoot: __dirname,
    indexFound: Boolean(gameIndex),
    indexLocation: gameIndex ? path.relative(__dirname, gameIndex) : null,
    checked: ["index.html", "public/index.html"]
  });
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
       RETURNING id, username, trophies, coins, wins, losses, selected_hero, unlocked, mail_reward_claimed, mail_reward_read`,
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
    const result = await pool.query("SELECT id, username, trophies, coins, wins, losses, selected_hero, unlocked, mail_reward_claimed, mail_reward_read FROM players WHERE id=$1", [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "계정을 찾을 수 없습니다." });
    res.json({ profile: publicProfile(result.rows[0]) });
  } catch (e) { console.error(e); res.status(500).json({ error: "프로필을 불러오지 못했습니다." }); }
});
app.put("/api/profile", authRequired, async (req, res) => {
  try {
    await dbReady();
    const allowedHeroes = new Set(["spider", "hammer", "meto", "bujijik", "adam", "yure", "joki", "gumi", "sniff", "kuro", "glover", "ellie", "nova", "bit", "prma", "teemo", "sera", "root", "magnet", "bolt"]);
    const selected = allowedHeroes.has(req.body.selectedHero) ? req.body.selectedHero : "spider";
    const result = await pool.query("SELECT trophies, unlocked FROM players WHERE id=$1", [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "계정을 찾을 수 없습니다." });
    const trophies = result.rows[0].trophies;
    const old = result.rows[0].unlocked || {};
    const unlocked = {
      spider: true,
      hammer: Boolean(old.hammer || trophies >= 50),
      meto: Boolean(old.meto || trophies >= 100),
      bujijik: Boolean(old.bujijik || trophies >= 150),
      adam: Boolean(old.adam || trophies >= 200),
      yure: Boolean(old.yure),
      joki: true,
      gumi: Boolean(old.gumi),
      sniff: Boolean(old.sniff),
      kuro: Boolean(old.kuro),
      glover: Boolean(old.glover),
      ellie: Boolean(old.ellie),
      nova: Boolean(old.nova),
      bit: Boolean(old.bit),
      prma: Boolean(old.prma),
      teemo: Boolean(old.teemo),
      sera: Boolean(old.sera),
      root: Boolean(old.root),
      magnet: Boolean(old.magnet),
      bolt: Boolean(old.bolt)
    };
    const safeSelected = unlocked[selected] ? selected : "spider";
    const saved = await pool.query(
      "UPDATE players SET selected_hero=$1, unlocked=$2::jsonb WHERE id=$3 RETURNING id, username, trophies, coins, wins, losses, selected_hero, unlocked, mail_reward_claimed, mail_reward_read",
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
  for (let i = waiting.length - 1; i >= 0; i--) {
    if (waiting[i].socketId === socketId) waiting.splice(i, 1);
  }
}
function releaseMatch(socket, notifyOpponent = true) {
  const match = socketUsers.get(socket.id);
  if (!match?.roomCode) {
    socketUsers.delete(socket.id);
    return;
  }
  const roomCode = match.roomCode;
  if (notifyOpponent) socket.to(roomCode).emit("battle:opponent-left");
  for (const [peerId, peerMatch] of socketUsers) {
    if (peerId === socket.id || peerMatch.roomCode !== roomCode) continue;
    socketUsers.delete(peerId);
    const peer = io.sockets.sockets.get(peerId);
    if (peer) peer.leave(roomCode);
  }
  socket.leave(roomCode);
  socketUsers.delete(socket.id);
}
io.on("connection", socket => {
  socket.emit("queue:status", { message: "온라인 서버에 연결됨" });
  socket.on("queue:join", payload => {
    if (socketUsers.has(socket.id)) {
      socket.emit("queue:status", { message: "이미 대전 중이야. 먼저 현재 대전을 종료해 줘." });
      return;
    }
    removeFromQueue(socket.id);
    const user = {
      socketId: socket.id,
      since: Date.now(),
      name: String(payload?.name || "플레이어").slice(0, 24),
      hero: ["spider", "hammer", "meto", "bujijik", "adam", "yure", "joki", "gumi", "sniff", "kuro", "glover", "ellie", "nova", "bit", "prma", "teemo", "sera", "root", "magnet", "bolt"].includes(payload?.hero) ? payload.hero : "spider"
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
    releaseMatch(socket, true);
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
      alive: Boolean(data.alive), ultCharge: Math.max(0, Math.min(100, Number(data.ultCharge) || 0)), heroId: ["spider", "hammer", "meto", "bujijik", "adam", "yure", "joki", "gumi", "sniff", "kuro", "glover", "ellie", "nova", "bit", "prma", "teemo", "sera", "root", "magnet", "bolt"].includes(data.heroId) ? data.heroId : "spider",
      skinId: (data.heroId === "spider" && data.skinId === "venom-spider") || (data.heroId === "bujijik" && data.skinId === "rainbow-bujijik") || (data.heroId === "meto" && data.skinId === "mentos-meto") || (data.heroId === "adam" && data.skinId === "thunder-adam") || (data.heroId === "hammer" && data.skinId === "thorboy-hammer") ? data.skinId : null,
      name: String(data.name || "플레이어").slice(0, 24),
      buffTime: Math.max(0, Math.min(10, Number(data.buffTime) || 0)),
      stunTime: Math.max(0, Math.min(5, Number(data.stunTime) || 0)),
      invulnTime: Math.max(0, Math.min(3, Number(data.invulnTime) || 0)),
      adamAwakenTime: Math.max(0, Math.min(3, Number(data.adamAwakenTime) || 0)),
      jokiDamageTime: Math.max(0, Math.min(3, Number(data.jokiDamageTime) || 0)),
      jokiHealTime: Math.max(0, Math.min(8, Number(data.jokiHealTime) || 0)),
      charmTime: Math.max(0, Math.min(2, Number(data.charmTime) || 0)),
      kuroStealthTime: Math.max(0, Math.min(1, Number(data.kuroStealthTime) || 0)),
      novaCrystalTime: Math.max(0, Math.min(6, Number(data.novaCrystalTime) || 0)),
      slowTime: Math.max(0, Math.min(4, Number(data.slowTime) || 0)),
      poisonTime: Math.max(0, Math.min(10, Number(data.poisonTime) || 0)),
      poisonStacks: Math.max(0, Math.min(10, Number(data.poisonStacks) || 0)),
      summons: Array.isArray(data.summons) ? data.summons.slice(0, 8).map(s => ({ id: String(s?.id || "").slice(0, 80), x: Math.max(48, Math.min(852, Number(s?.x) || 450)), y: Math.max(48, Math.min(852, Number(s?.y) || 450)), hp: Math.max(0, Math.min(20, Number(s?.hp) || 0)), alive: Boolean(s?.alive), facing: { x: Math.max(-1, Math.min(1, Number(s?.facing?.x) || 0)), y: Math.max(-1, Math.min(1, Number(s?.facing?.y) || 0)) }, skinId: data.heroId === "bujijik" && s?.skinId === "rainbow-bujijik" ? "rainbow-bujijik" : null })) : []
    };
    socket.to(match.roomCode).emit("battle:state", safe);
  });
  socket.on("battle:attack", data => {
    const match = socketUsers.get(socket.id);
    if (!match?.roomCode || !data || typeof data !== "object") return;
    const allowed = new Set(["projectiles", "melee", "sera-ultimate", "spider-ultimate", "ultimate-shield", "kuro-stealth-ultimate", "adam-ultimate", "joki-stun-ultimate", "joki-heal-ultimate", "joki-damage-ultimate", "summon", "summon-swing", "glover-punch", "glover-dash", "ellie-avalanche", "nova-crystal-ultimate", "nova-crystal-slash", "sniff-ultimate", "bit-bomb", "prma-blackhole", "teemo-mushroom", "root-ultimate", "magnet-pulse", "bolt-lightning", "bolt-pulse"]);
    if (!allowed.has(data.kind)) return;
    const safe = {
      kind: data.kind,
      skinId: (data.heroId === "spider" && data.skinId === "venom-spider") || (data.heroId === "bujijik" && data.skinId === "rainbow-bujijik") || (data.heroId === "meto" && data.skinId === "mentos-meto") || (data.heroId === "adam" && data.skinId === "thunder-adam") || (data.heroId === "hammer" && data.skinId === "thorboy-hammer") ? data.skinId : null,
      hit: Boolean(data.hit),
      punchSide: Number(data.punchSide) === 1 ? 1 : 0,
      heroId: ["spider", "hammer", "meto", "bujijik", "adam", "yure", "joki", "gumi", "sniff", "kuro", "glover", "ellie", "nova", "bit", "prma", "teemo", "sera", "root", "magnet", "bolt"].includes(data.heroId) ? data.heroId : "spider",
      id: String(data.id || "").slice(0, 80),
      x: Math.max(48, Math.min(852, Number(data.x) || 450)),
      y: Math.max(48, Math.min(852, Number(data.y) || 450)),
      targetX: Math.max(48, Math.min(852, Number(data.targetX) || 450)),
      targetY: Math.max(48, Math.min(852, Number(data.targetY) || 450)),
      zoneX: Math.max(48, Math.min(852, Number(data.zoneX) || 450)),
      zoneY: Math.max(48, Math.min(852, Number(data.zoneY) || 450)),
      radius: Math.max(40, Math.min(280, Number(data.radius) || 96)),
      fuse: Math.max(.2, Math.min(2, Number(data.fuse) || 1)),
      duration: Math.max(.5, Math.min(8, Number(data.duration) || 5)), ultimate: Boolean(data.ultimate),
      facing: { x: Math.max(-1, Math.min(1, Number(data.facing?.x) || 0)), y: Math.max(-1, Math.min(1, Number(data.facing?.y) || 0)) },
      positions: Array.isArray(data.positions) ? data.positions.slice(0, 3).map(pos => ({ x: Math.max(48, Math.min(852, Number(pos?.x) || 450)), y: Math.max(48, Math.min(852, Number(pos?.y) || 450)) })) : [],
      bullets: Array.isArray(data.bullets) ? data.bullets.slice(0, 20).map(b => ({
        id: String(b?.id || "").slice(0, 80),
        x: Math.max(0, Math.min(900, Number(b?.x) || 0)), y: Math.max(0, Math.min(900, Number(b?.y) || 0)),
        vx: Math.max(-800, Math.min(800, Number(b?.vx) || 0)), vy: Math.max(-800, Math.min(800, Number(b?.vy) || 0)),
        r: Math.max(2, Math.min(18, Number(b?.r) || 5)), life: Math.max(.1, Math.min(3, Number(b?.life) || 1)),
        damage: Math.max(0, Math.min(100, Number.isFinite(Number(b?.damage)) ? Number(b.damage) : 0)),
        color: /^#[0-9a-fA-F]{3,8}$/.test(String(b?.color || "")) ? String(b.color) : "#ffffff",
        kind: String(b?.kind || "bullet").slice(0, 24), skinId: (data.heroId === "spider" && b?.skinId === "venom-spider") || (data.heroId === "bujijik" && b?.skinId === "rainbow-bujijik") || (data.heroId === "meto" && b?.skinId === "mentos-meto") || (data.heroId === "adam" && b?.skinId === "thunder-adam") || (data.heroId === "hammer" && b?.skinId === "thorboy-hammer") ? b.skinId : null, stun: Math.max(0, Math.min(2, Number(b?.stun) || 0)), charm: Math.max(0, Math.min(2, Number(b?.charm) || 0)), slow: Math.max(0, Math.min(4, Number(b?.slow) || 0)), pierce: Boolean(b?.pierce), charge: b?.charge !== false, damageByRange: Boolean(b?.damageByRange), originX: Math.max(0, Math.min(900, Number(b?.originX) || 0)), originY: Math.max(0, Math.min(900, Number(b?.originY) || 0)), rangeCap: Math.max(200, Math.min(1200, Number(b?.rangeCap) || 804)), chargeGroup: b?.chargeGroup == null ? null : String(b.chargeGroup).slice(0, 80), critChance: Math.max(0, Math.min(0.8, Number(b?.critChance) || 0)), critBonus: Math.max(0, Math.min(10, Number(b?.critBonus) || 0)), poison: Math.max(0, Math.min(10, Number(b?.poison) || 0)), chargeOverride: b?.chargeOverride == null ? null : Math.max(0, Math.min(40, Number(b.chargeOverride) || 0))
      })) : []
    };
    socket.to(match.roomCode).emit("battle:attack", safe);
  });
  socket.on('battle:hit-confirm', data => {
    const match = socketUsers.get(socket.id);
    const heroIds = new Set(['spider','hammer','meto','bujijik','adam','yure','joki','gumi','sniff','kuro','glover','ellie','nova','bit','prma','teemo','sera','root','magnet','bolt']);
    const heroId = String(data?.heroId || '');
    const charge = Math.max(0, Math.min(40, Number(data?.charge) || 0));
    if (match?.roomCode && heroIds.has(heroId) && charge > 0) {
      socket.to(match.roomCode).emit('battle:hit-confirm', { heroId, charge });
    }
  });
  socket.on("battle:impact", data => {
    const match = socketUsers.get(socket.id);
    if (!match?.roomCode || !data || typeof data !== "object") return;
    const validHeroes = new Set(["spider", "hammer", "meto", "bujijik", "adam", "yure", "joki", "gumi", "sniff", "kuro", "glover", "ellie", "nova", "bit", "prma", "teemo", "sera", "root", "magnet", "bolt"]);
    const safe = {
      id: String(data.id || "").slice(0, 80),
      roomCode: match.roomCode,
      x: Math.max(0, Math.min(900, Number.isFinite(Number(data.x)) ? Number(data.x) : 450)),
      y: Math.max(0, Math.min(900, Number.isFinite(Number(data.y)) ? Number(data.y) : 450)),
      kind: String(data.kind || "hit").slice(0, 32),
      amount: Math.max(0, Math.min(100, Number(data.amount) || 0)),
      hp: Math.max(0, Math.min(200, Number.isFinite(Number(data.hp)) ? Number(data.hp) : 0)),
      maxHp: Math.max(1, Math.min(200, Number(data.maxHp) || 100)),
      alive: Boolean(data.alive),
      stun: Math.max(0, Math.min(2, Number(data.stun) || 0)),
      charm: Math.max(0, Math.min(2, Number(data.charm) || 0)),
      slow: Math.max(0, Math.min(4, Number(data.slow) || 0)),
      poison: Math.max(0, Math.min(10, Number(data.poison) || 0)),
      poisonStacks: Math.max(0, Math.min(10, Number(data.poisonStacks) || 0)),
      heroId: validHeroes.has(data.heroId) ? data.heroId : "spider",
      skinId: ["venom-spider", "rainbow-bujijik", "mentos-meto", "thunder-adam", "thorboy-hammer"].includes(data.skinId) ? data.skinId : null,
      targetType: data.targetType === "summon" ? "summon" : "fighter",
      targetId: String(data.targetId || "").slice(0, 80),
      pierce: Boolean(data.pierce)
    };
    socket.to(match.roomCode).emit("battle:impact", safe);
  });
  socket.on("battle:summon-damage", data => {
    const match = socketUsers.get(socket.id);
    const id = String(data?.id || "").slice(0, 80);
    const amount = Math.max(0, Math.min(20, Number(data?.amount) || 0));
    if (match?.roomCode && id && amount > 0) socket.to(match.roomCode).emit("battle:summon-damage", { id, amount });
  });
  socket.on("battle:damage", data => {
    const match = socketUsers.get(socket.id);
    const amount = Math.max(0, Math.min(100, Number(data?.amount) || 0));
    const stun = Math.max(0, Math.min(2, Number(data?.stun) || 0));
    const charm = Math.max(0, Math.min(2, Number(data?.charm) || 0));
    const slow = Math.max(0, Math.min(4, Number(data?.slow) || 0));
    const poison = Math.max(0, Math.min(10, Number(data?.poison) || 0));
    const heroIds = new Set(["spider", "hammer", "meto", "bujijik", "adam", "yure", "joki", "gumi", "sniff", "kuro", "glover", "ellie", "nova", "bit", "prma", "teemo", "sera", "root", "magnet", "bolt"]);
    const skinId = ["venom-spider", "rainbow-bujijik", "mentos-meto", "thunder-adam", "thorboy-hammer"].includes(data?.skinId) ? data.skinId : null;
    const safe = {
      amount, stun, charm, slow, poison,
      kind: String(data?.kind || "hit").slice(0, 32),
      heroId: heroIds.has(data?.heroId) ? data.heroId : "spider",
      skinId,
      x: Math.max(0, Math.min(900, Number.isFinite(Number(data?.x)) ? Number(data.x) : 450)),
      y: Math.max(0, Math.min(900, Number.isFinite(Number(data?.y)) ? Number(data.y) : 450)),
      facing: { x: Math.max(-1, Math.min(1, Number(data?.facing?.x) || 0)), y: Math.max(-1, Math.min(1, Number(data?.facing?.y) || 0)) }
    };
    if (match?.roomCode && (amount > 0 || stun > 0 || charm > 0 || slow > 0 || poison > 0)) socket.to(match.roomCode).emit("battle:damage", safe);
  });
  socket.on("battle:leave", () => {
    removeFromQueue(socket.id);
    releaseMatch(socket, true);
  });
  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    releaseMatch(socket, true);
  });
});
setInterval(() => {
  const now = Date.now();
  for (let i = waiting.length - 1; i >= 0; i--) {
    if (now - waiting[i].since > 120000 || !io.sockets.sockets.has(waiting[i].socketId)) waiting.splice(i, 1);
  }
}, 15000).unref();

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/socket.io/")) return next();
  return sendGameIndex(req, res);
});
initDb().then(() => {
  server.listen(PORT, "0.0.0.0", () => console.log(`원격돌격 서버가 ${PORT} 포트에서 실행 중입니다.`));
}).catch(err => { console.error("Database initialization failed:", err); process.exit(1); });
