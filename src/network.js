/**
 * network.js — Client-side Socket.IO multiplayer module
 * Handles all server communication for ShootMaster
 */

// When running locally, point to localhost. When deployed, set this via env/config.
export const SERVER_URL = 'http://localhost:3001';

let socket = null;
let gameRef = null;
let updateInterval = null;
const UPDATE_RATE_MS = 50; // 20 Hz position updates

import * as worldMod from './world.js';

// ──────────────────────────────────────────────────────────────────────────────
// Connection
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Initialize network connection
 * @param {Game} game - The game instance
 * @param {string} roomId - Room ID to join
 * @param {object} profile - { name, skinColor, mode }
 * @returns {Promise} resolves when room is joined
 */
export function initNetwork(game, roomId, profile) {
    gameRef = game;

    return new Promise((resolve, reject) => {
        gameRef = game;

        // High-performance Combat Relay Callback (Used by world.js to avoid async storm)
        game.emitRemoteDamage = (victimId, damage) => {
            if (socket && socket.connected && game.networkState.isHost) {
                socket.emit('remote-damage', { victimId, damage });
            }
        };

        // Dynamic import of socket.io-client (loaded via CDN in index.html)
        if (typeof io === 'undefined') {
            reject(new Error('Socket.IO client not loaded'));
            return;
        }

        socket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        socket.on('connect', () => {
            console.log(`[Network] Connected: ${socket.id}`);
            game.addEvent('Connected to server', '#0ef');

            // Strict Room Intent: If roomId exists and is min 4-chars, we JOIN.
            // Otherwise, we CREATE (Host flow).
            const isJoinIntent = (typeof roomId === 'string' && roomId.trim().length >= 4);

            if (isJoinIntent) {
                socket.emit('join-room', {
                    roomId: roomId.trim().toUpperCase(),
                    name: profile.name,
                    skinColor: profile.skinColor,
                    mode: profile.mode
                });
            } else {
                socket.emit('create-room', {
                    name: profile.name,
                    skinColor: profile.skinColor,
                    mode: profile.mode
                });
            }
        });

        socket.on('connect_error', (err) => {
            console.error('[Network] Connection error:', err.message);
            game.addEvent('Connection failed!', '#f44');
            reject(err);
        });

        socket.on('join-error', ({ message }) => {
            alert(message); // Explicit UI feedback for wrong room code
            disconnect();
            game.returnToMenu();
            reject(new Error(message));
        });

        // ── ROOM JOINED ──
        socket.on('room-joined', (data) => {
            game.networkState.connected = true;
            game.networkState.myId = data.yourId;
            game.networkState.roomId = data.roomId;
            game.networkState.isHost = data.isHost;

            // CRITICAL: Force mode to match the Host's Room 
            if (data.mode) game.playerProfile.mode = data.mode;

            // Clear previous remote players if reconnecting
            Object.keys(game.remotePlayers).forEach(id => {
                game.removeRemotePlayer(id);
            });

            // Add existing players
            Object.values(data.players).forEach(p => {
                if (p.id !== data.yourId) {
                    game.addRemotePlayer(p);
                }
            });

            game.addEvent(`Joined room: ${data.roomId}`, '#0ef');
            if (data.isHost) game.addEvent('You are the host', '#ff0');

            resolve(data);

            // Force initial lobby UI population 
            const hostId = Object.values(data.players).find(p => p.isHost)?.id;
            if (game.constructor.updateLobbyUI) game.constructor.updateLobbyUI(data.players, hostId, game);
        });

        socket.on('lobby-update', ({ players, hostId }) => {
            game.networkState.isHost = hostId === game.networkState.myId;
            if (game.constructor.updateLobbyUI) game.constructor.updateLobbyUI(players, hostId, game);
        });

        socket.on('match-start', () => {
            game.startNetworkMatch();
            startSendingUpdates(game);
        });

        // Single consolidated join-error listener exists above in initNetwork

        // ── ROBUST LOCAL UI REFRESHER ──
        function refreshLobbyUI() {
            const lobby = document.getElementById('lobby-screen');
            if (!lobby || lobby.classList.contains('hidden')) return;

            const players = {};
            // Self
            players[game.networkState.myId] = {
                id: game.networkState.myId,
                name: game.playerProfile.name,
                skinColor: game.playerProfile.skinColor,
                isHost: game.networkState.isHost
            };

            // Others
            let hostId = game.networkState.myId;
            Object.values(game.remotePlayers).forEach(rp => {
                players[rp.id] = {
                    id: rp.id,
                    name: rp.name,
                    skinColor: rp.skinColor,
                    isHost: rp.isHost || false
                };
                if (rp.isHost) hostId = rp.id;
            });

            if (!game.networkState.isHost && players[game.networkState.myId].isHost) {
                game.networkState.isHost = true; // Fallback sync
            }

            import('./Game.js').then(m => m.default.updateLobbyUI(players, hostId, game));
        }

        // ── OTHER PLAYERS ──
        socket.on('player-joined', ({ player }) => {
            if (player.id !== game.networkState.myId) {
                game.addRemotePlayer(player);
                game.addEvent(`${player.name} joined`, '#0ef');
                refreshLobbyUI();
            }
        });

        socket.on('player-moved', (data) => {
            if (data.id === game.networkState.myId) return;
            
            const remote = game.remotePlayers[data.id];
            if (remote) {
                remote.setTarget(data.position, data.rotation, data.health, data.isAiming, data.isInvulnerable);
                remote.currentWeapon = data.currentWeapon;
            }

            // Sync AI & Pickups perfectly exactly as seen by the Host
            if (data.bots && !game.networkState.isHost) {
                 if (worldMod.syncBots) worldMod.syncBots(data.bots, game);
                 if (worldMod.syncPickups && data.pickups) worldMod.syncPickups(data.pickups);
            }
        });

        socket.on('player-left', ({ id, name }) => {
            game.removeRemotePlayer(id);
            game.addEvent(`${name} left`, '#aaa');
            refreshLobbyUI();
        });

        // ── DAMAGE / COMBAT ──
        socket.on('take-damage', ({ fromId, fromName, damage, health }) => {
            game.playerState.health = health || 0;
            game.takeDamage(0, fromId, fromName); // trigger visual and death if 0
            if (fromName) game.addEvent(`Hit by ${fromName} (-${damage})`, '#f44');
        });

        socket.on('player-killed', ({ killerId, killerName, victimId, victimName, killerScore }) => {
            if (victimId === game.networkState.myId) {
                game.die(killerId, killerName);
                game.addEvent(`Killed by ${killerName}`, '#f00');
            }
            if (killerId === game.networkState.myId) {
                game.playerState.score = killerScore;
                game.addEvent(`You killed ${victimName}!`, '#0f4');
            }
            // Update remote player score
            const remote = game.remotePlayers[killerId];
            if (remote) remote.score = killerScore;
        });

        socket.on('bot-killed', (data) => {
            const { killerId, killerName, killerScore } = data;
            
            // Log to feed (unless it's you, you already saw the "You killed" event)
            if (killerId !== game.networkState.myId) {
                game.addEvent(`${killerName} killed a bot`, '#fa0');
            }

            // Sync visual Score on HUD for whoever killed it
            if (killerId === game.networkState.myId) {
                game.playerState.score = killerScore || 0;
            } else {
                const remote = game.remotePlayers[killerId];
                if (remote) remote.score = killerScore || 0;
            }
        });

        socket.on('score-sync', ({ id, score }) => {
            const remote = game.remotePlayers[id];
            if (remote) remote.score = score;
        });

        // ── TIMER ──
        socket.on('timer-update', ({ timer }) => {
            game.missionTimer = timer;
        });

        // ── LEADERBOARD ──
        socket.on('leaderboard-update', ({ leaderboard }) => {
            game.networkState.leaderboard = leaderboard;
            updateLeaderboardUI(leaderboard);
        });

        socket.on('match-end', ({ leaderboard }) => {
            game.isStarted = false;
            if (document.pointerLockElement) document.exitPointerLock();
            const pauseMenu = document.getElementById('instruction');
            if (pauseMenu) pauseMenu.classList.add('hidden');
            showMatchEnd(leaderboard, game.playerProfile.name, game);
        });

        // ── CHAT ──
        socket.on('chat-message', ({ senderName, senderColor, message }) => {
            appendChatMessage(senderName, senderColor, message);
        });

        // ── HOST PROMOTION ──
        socket.on('chat-cleared', () => {
            const chatLog = document.getElementById('chat-messages');
            if (chatLog) chatLog.innerHTML = '<div class="chat-system">Chat history cleared for new match.</div>';
        });

        socket.on('room-terminated', () => {
            game.addEvent('Host terminated the room', '#f44');
            disconnect();
            game.returnToMenu();
        });

        socket.on('disconnect', () => {
            console.log('[Network] Disconnected');
            game.addEvent('Disconnected from server', '#f44');
            stopSendingUpdates();
        });

        // ── HOST SPECIFIC BOT KILL HOOK ──
        socket.on('bot-died-remote', ({ botIdx }) => {
             if (game.networkState.isHost) {
                  const bot = worldMod.bots[botIdx];
                  if (bot && !bot.userData.isDead) {
                      bot.userData.health = 0;
                      bot.userData.isDead = true;
                      bot.userData.respawnTimer = 5.0; // CONFIG.RESPAWN_DELAY
                      
                      bot.rotation.x = -Math.PI / 2;
                      bot.position.y = 0.5;
                      bot.traverse(c => { 
                          if(c.isMesh) { c.material.color.set(0x555555); c.material.emissive.set(0x000000); } 
                      });
                      
                      if (bot.userData.laserLine) bot.userData.laserLine.visible = false;
                  }
             }
        });

        // ── HOST SPECIFIC PICKUP HOOK ──
        socket.on('pickup-collected-remote', ({ type, index }) => {
            if (game.networkState.isHost) {
                const list = type === 'health' ? worldMod.healthKits : worldMod.ammoBoxes;
                const item = list[index];
                if (item && item.visible) {
                    item.visible = false;
                    item.userData.respawnTimer = 15; // CONFIG.PICKUP_RESPAWN_TIME
                }
            }
        });
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Sending Updates
// ──────────────────────────────────────────────────────────────────────────────

function startSendingUpdates(game) {
    stopSendingUpdates();
    updateInterval = setInterval(() => {
        if (!socket || !game.isStarted) return;
        const currentWeapon = game.playerState.inventory[game.playerState.currentWeaponIndex];
        const payload = {
            position: game.playerState.position,
            rotation: game.playerState.rotation,
            currentWeapon: currentWeapon ? currentWeapon.name : 'PISTOL',
            health: game.playerState.health,
            isAiming: !!game.inputBuffer.ads,
            isInvulnerable: !!game.playerState.isInvulnerable
        };

        if (game.networkState.isHost) {
            // Always sync pickups
            payload.pickups = {
                healthKits: worldMod.healthKits.map(h => h.visible),
                ammoBoxes: worldMod.ammoBoxes.map(a => a.visible)
            };

            // SYNC BOTS (Multiplayer PvE Support)
            payload.bots = worldMod.bots.map((b, i) => ({
                idx: i,
                x: +b.position.x.toFixed(2), z: +b.position.z.toFixed(2),
                yaw: +b.rotation.y.toFixed(3),
                hp: b.userData.health,
                dead: b.userData.isDead,
                type: b.userData.botType
            }));
        }
        socket.emit('player-update', payload);
    }, UPDATE_RATE_MS);
}

function stopSendingUpdates() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Shoot Events
// ──────────────────────────────────────────────────────────────────────────────

export function emitShoot(from, to) {
    if (!socket || !socket.connected) return;
    socket.emit('shoot', { from, to });
}

export function emitPlayerDied(killerId, killerName, weaponType) {
    if (!socket || !socket.connected) return;
    socket.emit('player-died', { killerId, killerName, weaponType });
}

export function emitRemoteDamage(victimId, damage) {
    if (!socket || !gameRef.networkState.connected) return;
    socket.emit('remote-damage', { victimId, damage });
}

export function emitPickupCollected(type, index) {
    if (!socket || !gameRef.networkState.connected) return;
    socket.emit('pickup-collected', { type, index });
}

export function emitTerminateRoom() {
    if (!socket || !gameRef.networkState.connected) return;
    socket.emit('terminate-room');
}

export function emitStartGame() {
    if (!socket || !socket.connected) return;
    socket.emit('start-game');
}

export function emitLeaveRoom() {
    if (!socket || !socket.connected) return;
    socket.emit('leave-room');
}

// ──────────────────────────────────────────────────────────────────────────────
// Chat
// ──────────────────────────────────────────────────────────────────────────────

export function sendChatMessage(message) {
    if (!socket || !socket.connected) return;
    socket.emit('chat', { message });
}

export function clearChat() {
    const messages = document.querySelectorAll('.chat-msg');
    messages.forEach(msg => msg.remove());
}

export function isConnected() {
    return socket && socket.connected;
}

export function disconnect() {
    stopSendingUpdates();
    if (socket) socket.disconnect();
}

// ──────────────────────────────────────────────────────────────────────────────
// UI Helpers
// ──────────────────────────────────────────────────────────────────────────────

function appendChatMessage(senderName, senderColor, message) {
    const panel = document.getElementById('chat-messages');
    if (!panel) return;

    const el = document.createElement('div');
    el.className = 'chat-msg';
    el.innerHTML = `<span class="chat-sender" style="color:${senderColor}">${escapeHTML(senderName)}</span>: ${escapeHTML(message)}`;
    panel.appendChild(el);
    panel.scrollTop = panel.scrollHeight;

    // Keep max 50 messages
    while (panel.children.length > 50) {
        panel.removeChild(panel.firstChild);
    }
}

function updateLeaderboardUI(leaderboard) {
    const el = document.getElementById('leaderboard-list');
    if (!el) return;
    el.innerHTML = leaderboard.map((p, i) =>
        `<div class="lb-entry"><span class="lb-rank">#${i + 1}</span><span class="lb-name" style="color:${p.skinColor}">${escapeHTML(p.name)}</span><span class="lb-score">${p.score}</span></div>`
    ).join('');
}

export function showMatchEnd(leaderboard, myName, gameInstance) {
    const endScreen = document.getElementById('match-end-screen');
    const list = document.getElementById('end-leaderboard');
    if (!endScreen || !list) return;

    let html = '';
    let winner = null;
    let place = 1;
    leaderboard.forEach(p => {
        if (!winner) winner = p;
        html += `<div style="display:flex; justify-content:space-between; margin-bottom:5px; color:${p.name===myName ? '#fff' : '#ccc'}">
            <span>#${place} ${p.name}</span>
            <span>${p.score} Kills | ${p.deaths} Deaths</span>
        </div>`;
        place++;
    });

    list.innerHTML = `
        <div style="text-align:center; font-size: 24px; margin-bottom: 10px; color: #ffeb3b">
            Winner: <span style="color: ${winner ? winner.skinColor : '#fff'}">${winner ? escapeHTML(winner.name) : 'Nobody'}</span>
        </div>
        ${html}
        
        <button id="match-end-lobby-btn" style="width:100%; padding:15px; margin-top:20px; background:var(--blue); border:none; color:#fff; border-radius:6px; font-weight:bold; cursor:pointer;">BACK TO LOBBY</button>
    `;

    const screensLayer = document.getElementById('screens-layer');
    if (screensLayer) screensLayer.style.display = 'block';

    endScreen.classList.remove('hidden');
    endScreen.style.display = 'flex';

    const lobbyBtn = document.getElementById('match-end-lobby-btn');
    if (lobbyBtn) lobbyBtn.onclick = () => {
        endScreen.style.display = 'none';
        if (gameInstance) {
            gameInstance.returnToMenu();
            const setup = document.getElementById('setup-screen');
            if (setup) setup.classList.add('hidden');
            const lobby = document.getElementById('lobby-screen');
            if (lobby) lobby.classList.remove('hidden');
        }
    };
}

function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, s => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[s]));
}
