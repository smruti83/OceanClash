import "./styles.css";
import { io, type Socket } from "socket.io-client";
import { SHIPS, WORLD, type GameMode, type RoomSnapshot, type ShipId } from "@ocean/shared";
import type { OceanGame, ClientInput } from "./game/OceanGame.js";
import { SoundDeck } from "./audio.js";

type AppSocket = Socket;
type PendingAction = { type: "match" | "create" | "join"; code?: string };
type ServerReply = { ok: boolean; error?: string; data?: { room: RoomSnapshot; playerId: string; token: string } };

const $ = (id: string) => document.getElementById(id) as any;
const socket: AppSocket = io({ autoConnect: false, transports: ["websocket", "polling"], reconnectionAttempts: Infinity, reconnectionDelay: 500, reconnectionDelayMax: 5000 });
const sound = new SoundDeck();
const order: ShipId[] = ["destroyer", "battleship", "carrier", "submarine", "speedboat"];
let selectedShip: ShipId = (localStorage.getItem("oc_ship") as ShipId) || "destroyer";
if (!SHIPS[selectedShip]) selectedShip = "destroyer";
const savedGraphicsMode = localStorage.getItem("oc_graphics");
const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
let lowGraphics = savedGraphicsMode ? savedGraphicsMode === "low" : deviceMemory <= 8 || window.devicePixelRatio > 1.5;
let pendingAction: PendingAction | null = null;
let room: RoomSnapshot | null = null;
let playerId = "";
let game: OceanGame | null = null;
let gameInit: Promise<void> | null = null;
let busy = false;
let toastTimer: number | undefined;
let resumeAttempted = false;
let lastResultShown = "";
let lastMinimapDrawAt = 0;
let lobbyRenderKey = "";
let leaderboardKey = "";
let feedKey = "";
let healthVisualKey = "";
let reportedFps = 0;
let reportedPing: number | null = null;

function renderPerformance(): void {
  const heapBytes = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  const heap = heapBytes === undefined ? "n/a" : `${Math.round(heapBytes / 1_048_576)}MB`;
  $("perf-monitor").textContent = `FPS ${reportedFps || "--"} · RTT ${reportedPing === null ? "--" : `${reportedPing}ms`} · JS ${heap}`;
}

const show = (screen: string) => {
  document.querySelectorAll(".screen").forEach((element) => element.classList.remove("active"));
  $(`screen-${screen}`).classList.add("active");
  document.body.classList.toggle("game-active", screen === "game");
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function toast(message: string): void {
  const el = $("toast"); el.textContent = message; el.classList.remove("hidden");
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.add("hidden"), 2500);
}

function setConnection(online: boolean, label = online ? "COMMS ONLINE" : "RECONNECTING"): void {
  const pill = document.querySelector(".connection-pill")!;
  pill.classList.toggle("offline", !online);
  $("connection-label").textContent = label;
}

function request(event: string, payload?: unknown): Promise<ServerReply> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Command timed out. Check your connection.")), 8000);
    socket.emit(event, payload, (reply: ServerReply) => { window.clearTimeout(timer); resolve(reply); });
  });
}

async function ensureConnected(): Promise<void> {
  if (socket.connected) return;
  socket.connect();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { socket.off("connect", connected); reject(new Error("Could not reach the battle server.")); }, 8000);
    const connected = () => { window.clearTimeout(timeout); resolve(); };
    socket.once("connect", connected);
  });
}

function callsign(): string { return $("captain-name").value.trim().slice(0, 18) || "Captain"; }
function currentMode(): GameMode { return $("game-mode").value as GameMode; }

function svgShip(id: ShipId): string {
  const color = `#${SHIPS[id].accent.toString(16).padStart(6, "0")}`;
  const shapes: Record<ShipId, string> = {
    destroyer: `<path d="M58 8 71 30 68 75 58 99 48 75 45 30Z"/><path d="M58 31v24M52 49h12M51 65h14" stroke="#d9f1ed" stroke-width="2" fill="none"/><circle cx="58" cy="24" r="3" fill="#e6f6f1"/>`,
    battleship: `<path d="M58 7 75 30 73 73 65 94 51 94 43 73 41 30Z"/><path d="M48 40h20M46 56h24M49 73h18" stroke="#d9f1ed" stroke-width="3" fill="none"/><circle cx="49" cy="33" r="4" fill="#e6f6f1"/><circle cx="67" cy="33" r="4" fill="#e6f6f1"/>`,
    carrier: `<path d="M58 7 78 25 78 78 69 95 47 95 38 78 38 25Z"/><path d="M58 16v70M43 55h30M43 63h30" stroke="#d9f1ed" stroke-width="2" fill="none"/><path d="m52 31 6-8 6 8Z" fill="#e5f2ee"/>`,
    submarine: `<path d="M58 11c14 6 22 23 22 45 0 20-10 33-22 40-12-7-22-20-22-40 0-22 8-39 22-45Z"/><path d="M49 40c3-8 15-8 18 0v10H49ZM42 62h32" fill="#183d4e" stroke="#d9f1ed" stroke-width="2"/><circle cx="58" cy="39" r="3" fill="#e5f2ee"/>`,
    speedboat: `<path d="m58 9 17 23-7 37-10 23-10-23-7-37Z"/><path d="m51 48 7-13 7 13v13H51ZM47 70h22" fill="#153c4a" stroke="#d9f1ed" stroke-width="2"/><path d="m54 33 4-8 4 8Z" fill="#e5f2ee"/>`
  };
  return `<svg viewBox="0 0 116 116" aria-hidden="true"><ellipse cx="58" cy="67" rx="32" ry="45" fill="${color}" opacity=".12"/><g fill="${color}" stroke="#d9f1ed" stroke-width="2" stroke-linejoin="round">${shapes[id]}</g></svg>`;
}

function renderShipSelection(): void {
  const grid = $("ship-grid"); grid.innerHTML = "";
  order.forEach((id, index) => {
    const ship = SHIPS[id];
    const stats = [
      ["HULL", ship.hull / 2.1], ["SPEED", ship.speed / 3.3], ["CANNON", ship.cannonDamage / 0.42], ["ARMOR", ((1.2 - ship.armor) / 1.2) * 100]
    ] as [string, number][];
    const card = document.createElement("button");
    card.className = `ship-card${selectedShip === id ? " selected" : ""}`;
    card.style.setProperty("--ship-accent", `#${ship.accent.toString(16).padStart(6, "0")}`);
    card.style.setProperty("--ship-glow", `${`#${ship.accent.toString(16).padStart(6, "0")}`}33`);
    card.dataset.ship = id;
    card.innerHTML = `<span class="ship-index">0${index + 1} / OC</span><div class="ship-art">${svgShip(id)}</div><div class="ship-name">${escapeHtml(ship.name)}</div><div class="ship-role">${escapeHtml(ship.role)}</div><div class="ship-stats">${stats.map(([label, value]) => `<div class="ship-stat"><span>${label}</span><div class="stat-track"><i style="width:${Math.max(8, Math.min(100, value))}%"></i></div><b>${Math.round(value)}</b></div>`).join("")}</div><div class="ship-special"><small>${escapeHtml(ship.specialName.toUpperCase())} · ${ship.specialCooldown}S</small><p>${escapeHtml(ship.specialDescription)}</p></div>`;
    card.addEventListener("click", () => { selectedShip = id; localStorage.setItem("oc_ship", id); renderShipSelection(); });
    grid.append(card);
  });
  $("selected-ship-note").textContent = `${SHIPS[selectedShip].name.toUpperCase()} SELECTED · ${SHIPS[selectedShip].specialName.toUpperCase()}`;
}

function beginSelection(action: PendingAction): void {
  pendingAction = action;
  sound.unlock();
  renderShipSelection();
  show("ships");
}

async function confirmSelection(): Promise<void> {
  if (!pendingAction || busy) return;
  busy = true; $("confirm-ship").disabled = true;
  try {
    await ensureConnected();
    const common = { name: callsign(), ship: selectedShip };
    const action = pendingAction;
    const event = action.type === "match" ? "match:find" : action.type === "create" ? "room:create" : "room:join";
    const payload = action.type === "match" ? { ...common, mode: currentMode() } : action.type === "create" ? { ...common, mode: currentMode(), privacy: "private" } : { ...common, code: action.code };
    const reply = await request(event, payload);
    if (!reply.ok || !reply.data) throw new Error(reply.error || "Unable to join the battle.");
    sessionStorage.setItem("oc_resume", reply.data.token);
    playerId = reply.data.playerId; room = reply.data.room; pendingAction = null;
    updateRoom(room);
    if (room.state === "playing") enterGame(); else show("lobby");
  } catch (error) { toast(error instanceof Error ? error.message : "Unable to join the battle."); }
  finally { busy = false; $("confirm-ship").disabled = false; }
}

function updateRoom(next: RoomSnapshot): void {
  room = next;
  const me = next.players.find((player) => player.id === playerId);
  if (me) selectedShip = me.ship;
  if (next.state === "lobby" || next.state === "countdown") {
    const signature = `${next.code}|${next.state}|${next.mode}|${next.hostId}|${next.countdown}|${next.players.map((player) => `${player.id}:${player.name}:${player.ship}:${player.ready ? 1 : 0}:${player.connected ? 1 : 0}`).join("|")}`;
    if (signature !== lobbyRenderKey) { renderLobby(); lobbyRenderKey = signature; }
  } else lobbyRenderKey = "";
  renderHud();
  if (next.state === "playing" && !$('screen-game').classList.contains("active") && !gameInit) void enterGame();
  if (next.state === "results") showResults();
  if (next.state === "lobby" || next.state === "countdown") {
    $("results-overlay").classList.add("hidden");
    if (!game) show("lobby");
  }
  if (game) game.setSnapshot(next);
}

async function enterGame(): Promise<void> {
  if (!room) return;
  if (!$('screen-game').classList.contains("active")) {
    $("pause-overlay").classList.add("hidden");
    show("game");
  }
  $("mobile-controls").classList.toggle("hidden", !isTouchDevice());
  if (!game && !gameInit) {
    gameInit = (async () => {
      const { OceanGame: Game } = await import("./game/OceanGame.js");
      if (!room || room.state !== "playing") return;
      game = new Game($("game-canvas"), playerId, {
        input: (input: ClientInput) => { if (socket.connected) socket.emit("player:input", input); },
        weapon: (weapon) => fire(weapon),
        sound: (kind) => sound.play(kind),
        pause: () => setPaused($("pause-overlay").classList.contains("hidden")),
        stats: (fps: number) => { reportedFps = Math.round(fps); renderPerformance(); }
      }, lowGraphics);
    })();
  }
  if (game) game.setSnapshot(room);
  await gameInit;
  if (game && room) game.setSnapshot(room);
  renderHud();
}

function isTouchDevice(): boolean { return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0; }

function renderLobby(): void {
  if (!room) return;
  $("room-code-display").textContent = room.code;
  $("player-count").textContent = `${String(room.players.length).padStart(2, "0")} / 10`;
  $("lobby-ship-name").textContent = SHIPS[selectedShip].name.toUpperCase();
  const modeSelect = $("lobby-mode"); modeSelect.value = room.mode; modeSelect.disabled = room.hostId !== playerId || room.state !== "lobby";
  const host = room.hostId === playerId;
  const me = room.players.find((player) => player.id === playerId);
  const readyCount = room.players.filter((player) => player.connected && player.ready).length;
  const list = $("lobby-players"); list.innerHTML = "";
  room.players.forEach((player) => {
    const ship = SHIPS[player.ship];
    const row = document.createElement("div"); row.className = "player-slot";
    row.innerHTML = `<span class="player-avatar" style="--avatar-accent:#${ship.accent.toString(16).padStart(6, "0")}">${ship.initials}</span><span class="player-slot-copy"><b>${escapeHtml(player.name)}${player.id === room!.hostId ? " · HOST" : ""}</b><small>${escapeHtml(ship.name.toUpperCase())}${player.connected ? "" : " · RECONNECTING"}</small></span><span class="ready-tag${player.ready ? " ready" : ""}">${player.ready ? "READY" : "STANDBY"}</span>`;
    list.append(row);
  });
  for (let index = room.players.length; index < Math.min(10, Math.max(4, room.players.length + 1)); index += 1) {
    const row = document.createElement("div"); row.className = "player-slot empty-slot";
    row.innerHTML = `<span class="player-avatar">··</span><span class="player-slot-copy"><b>OPEN FLEET SLOT</b><small>SHARE CODE TO INVITE</small></span>`;
    list.append(row);
  }
  const readyButton = $("ready-button"); readyButton.classList.toggle("is-ready", Boolean(me?.ready));
  readyButton.innerHTML = me?.ready ? "READY FOR DEPLOYMENT <span>✓</span>" : "MARK READY <span>→</span>";
  readyButton.disabled = room.state === "playing" || room.state === "results";
  $("lobby-status").textContent = room.state === "countdown" ? `Battle begins in ${room.countdown}…` : readyCount < 2 ? "Waiting for another captain to join." : `${readyCount} captains ready. ${host ? "Launch when your fleet is set." : "Waiting for the host to launch."}`;
  $("start-button").disabled = !host || readyCount < 2 || readyCount !== room.players.filter((player) => player.connected).length || room.state !== "lobby";
  $("countdown-banner").classList.toggle("hidden", room.state !== "countdown");
  $("countdown-banner").textContent = room.state === "countdown" ? `DEPLOYING IN ${room.countdown}…` : "";
}

function renderHud(): void {
  if (!room) return;
  const setText = (id: string, value: string) => { const node = $(id) as HTMLElement; if (node.textContent !== value) node.textContent = value; };
  const own = room.players.find((player) => player.id === playerId);
  setText("hud-mode", room.mode === "ffa" ? "FREE FOR ALL" : room.mode === "tdm" ? "TEAM DEATHMATCH" : "LAST SHIP STANDING");
  const seconds = Math.max(0, Math.ceil(room.timeLeft));
  setText("match-clock", `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`);
  setText("hud-fleet-count", String(room.players.filter((player) => player.connected).length).padStart(2, "0"));
  if (own) {
    const ship = SHIPS[own.ship];
    setText("hud-ship-name", ship.name.toUpperCase());
    setText("hud-ship-icon", ship.initials);
    setText("hud-hull-label", `${Math.max(0, own.hull)} / ${own.maxHull} HP`);
    const healthFill = $("health-fill") as HTMLElement;
    const healthWidth = `${Math.max(0, Math.min(100, own.hull / own.maxHull * 100))}%`;
    const healthColor = own.hull / own.maxHull < 0.35 ? "linear-gradient(90deg,#ee655f,#ffba67)" : "linear-gradient(90deg,#30c9bd,#96ecb0)";
    const nextHealthVisualKey = `${healthWidth}|${healthColor}`;
    if (nextHealthVisualKey !== healthVisualKey) {
      healthFill.style.width = healthWidth;
      healthFill.style.background = healthColor;
      healthVisualKey = nextHealthVisualKey;
    }
    const cds = own.cooldowns;
    const status = ["CANNON", "TORPEDO", "MACHINE GUN", "MISSILE", ship.specialName.toUpperCase()].map((label, i) => {
      const key = (["cannon", "torpedo", "machinegun", "missile", "special"] as const)[i];
      const left = cds[key] ?? 0; return left > 0.1 ? `${label} ${left.toFixed(1)}S` : `${label} READY`;
    });
    setText("hud-cooldowns", status.join(" · "));
  }
  const nextLeaderboardKey = room.players.map((player) => `${player.id}:${player.name}:${player.ship}:${player.score}:${player.kills}`).join("|");
  if (nextLeaderboardKey !== leaderboardKey) {
    const leaderboard = [...room.players].sort((a, b) => b.score - a.score || b.kills - a.kills).slice(0, 6);
    const leaderboardHtml = leaderboard.map((player, index) => `<div class="leader-row${player.id === playerId ? " self" : ""}"><span class="leader-rank">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(player.name)}</strong><span>${player.kills}</span></div>`).join("");
    const board = $("hud-leaderboard") as HTMLElement;
    if (board.innerHTML !== leaderboardHtml) board.innerHTML = leaderboardHtml;
    leaderboardKey = nextLeaderboardKey;
  }
  const nextFeedKey = room.feed.slice(0, 4).map((entry) => `${entry.id}:${entry.text}:${entry.kind}`).join("|");
  if (nextFeedKey !== feedKey) {
    const feedHtml = room.feed.slice(0, 4).map((entry) => `<div class="feed-item ${escapeHtml(entry.kind)}">${escapeHtml(entry.text)}</div>`).join("");
    const feed = $("kill-feed") as HTMLElement;
    if (feed.innerHTML !== feedHtml) feed.innerHTML = feedHtml;
    feedKey = nextFeedKey;
  }
  const teamScore = $("team-score");
  teamScore.classList.toggle("hidden", room.mode !== "tdm");
  if (room.mode === "tdm") {
    const scoreHtml = `TEAM A <strong>${room.teamScores[0]}</strong> : <strong>${room.teamScores[1]}</strong> TEAM B`;
    if (teamScore.innerHTML !== scoreHtml) teamScore.innerHTML = scoreHtml;
  }
  if (performance.now() - lastMinimapDrawAt >= 200) { drawMinimap(); lastMinimapDrawAt = performance.now(); }
}

function drawMinimap(): void {
  const canvas = $("minimap"); const context = canvas.getContext("2d");
  if (!context || !room) return;
  const sx = canvas.width / WORLD.width; const sy = canvas.height / WORLD.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0c3b4b"; context.fillRect(0, 0, canvas.width, canvas.height);
  for (const obstacle of [
    { x: 480, y: 430, radius: 112 }, { x: 1510, y: 370, radius: 144 }, { x: 1100, y: 800, radius: 92 },
    { x: 560, y: 1190, radius: 152 }, { x: 1740, y: 1190, radius: 100 }, { x: 1000, y: 300, radius: 44 }, { x: 1290, y: 1300, radius: 50 }
  ]) { context.fillStyle = "#426a68"; context.beginPath(); context.ellipse(obstacle.x * sx, obstacle.y * sy, obstacle.radius * sx, obstacle.radius * sy, 0, 0, Math.PI * 2); context.fill(); }
  for (const player of room.players) {
    if (!player.connected || !player.alive) continue;
    const x = player.x * sx; const y = player.y * sy;
    context.fillStyle = player.id === playerId ? "#fff2b5" : room.mode === "tdm" ? (player.team ? "#ff9a72" : "#73dce0") : `#${SHIPS[player.ship].accent.toString(16).padStart(6, "0")}`;
    context.globalAlpha = player.stealth && player.id !== playerId ? 0.4 : 1;
    context.beginPath(); context.arc(x, y, player.id === playerId ? 4.2 : 3.1, 0, Math.PI * 2); context.fill();
    context.globalAlpha = 1;
  }
}

function showResults(): void {
  if (!room || lastResultShown === room.code) return;
  lastResultShown = room.code;
  const own = room.players.find((player) => player.id === playerId);
  const winner = room.winner ?? "No survivors";
  $("result-title").textContent = winner === own?.name ? "VICTORY" : winner === "Draw" ? "DRAW" : "BATTLE OVER";
  $("result-copy").textContent = winner === own?.name ? "The waters are yours. Well commanded." : `${winner} takes control of the open water.`;
  const ranked = [...room.players].sort((a, b) => b.score - a.score || b.kills - a.kills).slice(0, 3);
  $("result-stats").innerHTML = ranked.map((player, index) => `<div><strong>${index === 0 ? "#1" : `#${index + 1}`}</strong><span>${escapeHtml(player.name.toUpperCase())} · ${player.kills} KILLS</span></div>`).join("");
  $("results-overlay").classList.remove("hidden");
  sound.play(winner === own?.name ? "victory" : "explosion");
}

function fire(weapon: string): void {
  if (!socket.connected || !room || room.state !== "playing") return;
  socket.emit("weapon:fire", { weapon }, (reply: { ok: boolean; error?: string }) => {
    if (!reply?.ok && reply?.error && weapon === "special") toast(reply.error);
  });
}

function setPaused(value: boolean): void {
  if (!room || room.state !== "playing") return;
  game?.setPaused(value);
  $("pause-overlay").classList.toggle("hidden", !value);
}

async function goToDock(): Promise<void> {
  if (socket.connected && room) await request("room:leave").catch(() => undefined);
  sessionStorage.removeItem("oc_resume");
  room = null; playerId = ""; pendingAction = null; busy = false; lastResultShown = "";
  game?.destroy(); game = null;
  gameInit = null;
  $("pause-overlay").classList.add("hidden"); $("results-overlay").classList.add("hidden");
  show("home");
}

async function resumeSession(): Promise<void> {
  const token = sessionStorage.getItem("oc_resume");
  if (!token || resumeAttempted) return;
  resumeAttempted = true;
  try {
    const reply = await request("session:resume", { token });
    if (reply.ok && reply.data) {
      playerId = reply.data.playerId; room = reply.data.room; sessionStorage.setItem("oc_resume", reply.data.token);
      updateRoom(room); if (room.state === "playing") enterGame(); else show("lobby");
      toast("Command link restored.");
    } else {
      sessionStorage.removeItem("oc_resume");
      toast(reply.error || "Reconnect window expired.");
    }
  } catch { resumeAttempted = false; }
}

socket.on("connect", () => { setConnection(true); void resumeSession(); });
socket.on("disconnect", () => { setConnection(false); resumeAttempted = false; reportedPing = null; renderPerformance(); });
socket.on("connect_error", () => { setConnection(false, "COMMS RETRYING"); });
socket.on("room:update", (next: RoomSnapshot) => updateRoom(next));
socket.on("room:closed", () => { toast("Battle room closed."); void goToDock(); });
socket.on("fx", (effect: { kind: string; x?: number; y?: number; color?: number; size?: number; damage?: number }) => {
  game?.effect(effect);
  if (effect.kind === "explosion" || effect.kind === "hit") sound.play(effect.kind);
  else if (["cannon", "torpedo", "missile", "machinegun", "boost"].includes(effect.kind)) sound.play(effect.kind);
});

$("play-button").addEventListener("click", () => beginSelection({ type: "match" }));
$("create-button").addEventListener("click", () => beginSelection({ type: "create" }));
$("join-button").addEventListener("click", () => $("join-code-row").classList.toggle("hidden"));
$("confirm-join").addEventListener("click", () => {
  const code = $("room-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (code.length < 4) { toast("Enter a valid room code."); return; }
  beginSelection({ type: "join", code });
});
$("room-code").addEventListener("keydown", (event: KeyboardEvent) => { if (event.key === "Enter") $("confirm-join").click(); });
$("confirm-ship").addEventListener("click", () => void confirmSelection());
document.querySelectorAll("[data-back-home]").forEach((button) => button.addEventListener("click", () => { pendingAction = null; show("home"); }));
$("ready-button").addEventListener("click", async () => {
  if (!room) return;
  const me = room.players.find((player) => player.id === playerId);
  const reply = await request("player:ready", { ready: !me?.ready });
  if (!reply.ok) toast(reply.error || "Unable to update readiness.");
});
$("start-button").addEventListener("click", async () => {
  const reply = await request("room:start");
  if (!reply.ok) toast(reply.error || "Unable to start the battle.");
});
$("lobby-mode").addEventListener("change", async () => {
  const reply = await request("room:mode", { mode: $("lobby-mode").value });
  if (!reply.ok) toast(reply.error || "Unable to change battle mode.");
});
$("copy-code").addEventListener("click", async () => {
  if (!room) return;
  try { await navigator.clipboard.writeText(room.code); toast(`Room code ${room.code} copied.`); }
  catch { toast(`Share room code: ${room.code}`); }
});
$("leave-room").addEventListener("click", () => void goToDock());
$("pause-button").addEventListener("click", () => setPaused(true));
$("resume-button").addEventListener("click", () => setPaused(false));
$("quit-button").addEventListener("click", () => void goToDock());
$("results-dock").addEventListener("click", () => void goToDock());
$("volume-slider").addEventListener("input", () => {
  const value = Number($("volume-slider").value); sound.setVolume(value / 100); $("volume-value").textContent = `${value}%`;
});
$("low-graphics-toggle").checked = lowGraphics;
$("graphics-mode-status").textContent = lowGraphics ? "ON" : "OFF";
document.body.classList.toggle("low-graphics", lowGraphics);
$("low-graphics-toggle").addEventListener("change", () => {
  lowGraphics = Boolean($("low-graphics-toggle").checked);
  $("graphics-mode-status").textContent = lowGraphics ? "ON" : "OFF";
  localStorage.setItem("oc_graphics", lowGraphics ? "low" : "high");
  document.body.classList.toggle("low-graphics", lowGraphics);
  game?.setLowGraphics(lowGraphics);
});
$("sound-toggle").addEventListener("click", () => {
  sound.unlock(); sound.setMuted(!sound.isMuted);
  $("sound-toggle").textContent = sound.isMuted ? "♫̸" : "♫";
  $("sound-toggle").title = sound.isMuted ? "Sound off" : "Sound on";
});

const joystick = $("joystick"); const knob = $("joystick-knob"); let joystickPointer: number | null = null;
function updateJoystick(event: PointerEvent): void {
  const bounds = joystick.getBoundingClientRect();
  const max = bounds.width * 0.31; const cx = bounds.left + bounds.width / 2; const cy = bounds.top + bounds.height / 2;
  let dx = event.clientX - cx; let dy = event.clientY - cy;
  const length = Math.hypot(dx, dy); if (length > max) { dx *= max / length; dy *= max / length; }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  game?.setTouchVector(dx / max, dy / max);
}
joystick.addEventListener("pointerdown", (event: PointerEvent) => { joystickPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); updateJoystick(event); });
joystick.addEventListener("pointermove", (event: PointerEvent) => { if (event.pointerId === joystickPointer) updateJoystick(event); });
const resetJoystick = (event: PointerEvent) => {
  if (event.pointerId !== joystickPointer) return;
  joystickPointer = null; knob.style.transform = "translate(0,0)"; game?.setTouchVector(0, 0);
};
joystick.addEventListener("pointerup", resetJoystick); joystick.addEventListener("pointercancel", resetJoystick);
document.querySelectorAll<HTMLButtonElement>("[data-touch-weapon]").forEach((button) => {
  const weapon = button.dataset.touchWeapon!;
  if (weapon === "cannon") {
    button.addEventListener("pointerdown", (event) => { event.preventDefault(); sound.unlock(); game?.setTouchFire(true); });
    const stop = () => game?.setTouchFire(false);
    button.addEventListener("pointerup", stop); button.addEventListener("pointercancel", stop); button.addEventListener("pointerleave", stop);
  } else button.addEventListener("pointerdown", (event) => { event.preventDefault(); sound.unlock(); fire(weapon); });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && room?.state === "playing") setPaused($("pause-overlay").classList.contains("hidden"));
  if (room?.state === "playing" && [" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
});
window.addEventListener("pointerdown", () => sound.unlock(), { once: true });
const pingTimer = window.setInterval(() => {
  if (!socket.connected || !room) return;
  const startedAt = performance.now();
  socket.emit("perf:ping", (reply: { ok: boolean }) => {
    if (!reply?.ok) return;
    reportedPing = Math.round(performance.now() - startedAt);
    renderPerformance();
  });
}, 2000);
window.addEventListener("pagehide", () => window.clearInterval(pingTimer));
renderShipSelection();
renderPerformance();
socket.connect();

