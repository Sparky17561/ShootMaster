const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3001;
const MAX_PLAYERS = 6;
const MATCH_DURATION = 300; // 5 minutes in seconds
const SYNC_RATE = 1000 / 15; // 15 Hz broadcast

// ──────────────────────────────────────────────────────────────────────────────
// Room State
// ──────────────────────────────────────────────────────────────────────────────
const rooms = {};

function createRoom(roomId) {
    return {
        id: roomId,
        players: {},
        gameStarted: false,
        timer: MATCH_DURATION,
        hostId: null,
        intervalId: null
    };
}

function getOrCreateRoom(roomId) {
    if (!rooms[roomId]) {
        rooms[roomId] = createRoom(roomId);
    }
    return rooms[roomId];
}

function startMatchTimer(roomId) {
    const room = rooms[roomId];
    if (!room || room.intervalId) return;

    room.gameStarted = true;
    room.timer = MATCH_DURATION;

    room.intervalId = setInterval(() => {
        if (!rooms[roomId]) { clearInterval(room.intervalId); return; }

        room.timer -= 1;

        io.to(roomId).emit('timer-update', { timer: room.timer });

        // Broadcast leaderboard every 10 seconds
        if (room.timer % 10 === 0) {
            broadcastLeaderboard(roomId);
        }

        if (room.timer <= 0) {
            clearInterval(room.intervalId);
            room.intervalId = null;
            room.gameStarted = false;
            broadcastLeaderboard(roomId);
            io.to(roomId).emit('match-end', { leaderboard: buildLeaderboard(roomId) });
        }
    }, 1000);
}

function broadcastLobbyState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('lobby-update', {
        players: room.players,
        hostId: room.hostId
    });
}

function broadcastLeaderboard(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('leaderboard-update', { leaderboard: buildLeaderboard(roomId) });
}

function buildLeaderboard(roomId) {
    const room = rooms[roomId];
    if (!room) return [];
    return Object.values(room.players)
        .map(p => {
            const kd = p.deaths === 0 ? p.score : parseFloat((p.score / p.deaths).toFixed(2));
            return { id: p.id, name: p.name, skinColor: p.skinColor, score: p.score, deaths: p.deaths, kd };
        })
        .sort((a, b) => b.kd - a.kd || b.score - a.score);
}

function cleanRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (Object.keys(room.players).length === 0) {
        if (room.intervalId) clearInterval(room.intervalId);
        delete rooms[roomId];
        console.log(`[Room] ${roomId} deleted (empty)`);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Socket Events
// ──────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[Connect] ${socket.id}`);

    let currentRoomId = null;

    // ── JOIN ROOM ──
    socket.on('join-room', ({ roomId, name, skinColor, mode }) => {
        const cleanRoomId = (roomId || '').trim().toUpperCase();
        // If room doesn't exist, don't auto-create (Prevents Accidental Host)
        if (!rooms[cleanRoomId]) {
            socket.emit('join-error', { message: `Room ${cleanRoomId} not found. Check the code!` });
            return;
        }

        const room = rooms[cleanRoomId];

        if (Object.keys(room.players).length >= MAX_PLAYERS) {
            socket.emit('join-error', { message: 'Room is full (max 6 players)' });
            return;
        }

        currentRoomId = cleanRoomId;
        socket.join(cleanRoomId);

        const isHost = Object.keys(room.players).length === 0;
        if (isHost) {
            room.hostId = socket.id;
            room.mode = mode || 'pvp';
        }

        const player = {
            id: socket.id,
            name: name || `Player_${socket.id.slice(0, 4)}`,
            skinColor: skinColor || '#00aaff',
            position: { x: 0, y: 2, z: 0 },
            rotation: { pitch: 0, yaw: 0 },
            score: 0,
            deaths: 0,
            health: 100,
            currentWeapon: 'Pistol',
            isHost
        };

        room.players[socket.id] = player;

        // Send current room state to the new player
        socket.emit('room-joined', {
            yourId: socket.id,
            roomId: cleanRoomId,
            mode: room.mode,
            isHost,
            players: room.players,
            timer: room.timer,
            gameStarted: room.gameStarted
        });

        // Tell everyone else a new player joined
        socket.to(cleanRoomId).emit('player-joined', { player });

        // Update Lobby UI
        broadcastLobbyState(cleanRoomId);

        console.log(`[Join] ${player.name} → Room ${cleanRoomId} (${Object.keys(room.players).length}/${MAX_PLAYERS})`);
    });

    // ── START GAME (Host Only) ──
    socket.on('start-game', () => {
        const room = currentRoomId ? rooms[currentRoomId] : null;
        if (room && room.hostId === socket.id) {
            io.to(currentRoomId).emit('match-start');
            startMatchTimer(currentRoomId);
        }
    });

    // ── TERMINATE ROOM (Host Only) ──
    socket.on('terminate-room', () => {
        const room = currentRoomId ? rooms[currentRoomId] : null;
        if (room && room.hostId === socket.id) {
            io.to(currentRoomId).emit('room-terminated');
            if (room.intervalId) clearInterval(room.intervalId);
            delete rooms[currentRoomId];
            socket.leave(currentRoomId);
            console.log(`[Room] ${currentRoomId} externally terminated by host`);
        }
    });

    // ── CREATE ROOM ──
    socket.on('create-room', ({ name, skinColor, mode }) => {
        let roomId = uuidv4().slice(0, 4).toUpperCase();
        // Ensure no collision (unlikely but safe)
        while (rooms[roomId]) { roomId = uuidv4().slice(0, 4).toUpperCase(); }

        rooms[roomId] = createRoom(roomId);
        const room = rooms[roomId];
        
        currentRoomId = roomId;
        socket.join(roomId);
        
        room.hostId = socket.id;
        room.mode = mode || 'pvp';
        console.log(`[Create] ${name} → Room ${roomId}`);
        
        const player = {
            id: socket.id,
            name: name || `Player_${socket.id.slice(0, 4)}`,
            skinColor: skinColor || '#00aaff',
            position: { x: 0, y: 2, z: 0 },
            rotation: { pitch: 0, yaw: 0 },
            score: 0,
            deaths: 0,
            health: 100,
            currentWeapon: 'Pistol',
            isHost: true
        };

        room.players[socket.id] = player;
        
        socket.emit('room-joined', {
            yourId: socket.id,
            roomId,
            mode: room.mode,
            isHost: true,
            players: room.players,
            timer: room.timer,
            gameStarted: room.gameStarted
        });
    });

    // ── REMOTE DAMAGE (Host tells server someone got hit by bot) ──
    socket.on('remote-damage', ({ victimId, damage }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        // Host is the only one who should send this
        if (room.hostId !== socket.id) return;

        const victim = room.players[victimId];
        if (victim) {
            victim.health = Math.max(0, (victim.health || 100) - damage);
            
            // Tell the victim specifically
            io.to(victimId).emit('take-damage', {
                fromName: 'BOT',
                damage,
                health: victim.health
            });
        }
    });

    // ── PLAYER UPDATE (position / rotation) ──
    socket.on('player-update', ({ position, rotation, currentWeapon, health, isAiming, bots, pickups }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const player = room.players[socket.id];
        if (player) {
            player.position = position || player.position;
            player.rotation = rotation || player.rotation;
            player.currentWeapon = currentWeapon || player.currentWeapon;
            player.health = health !== undefined ? health : (player.health || 100);
            player.isAiming = !!isAiming;

            socket.to(currentRoomId).emit('player-moved', {
                id: socket.id,
                position: player.position,
                rotation: player.rotation,
                currentWeapon: player.currentWeapon,
                health: player.health,
                isAiming: player.isAiming,
                bots,
                pickups
            });
        }
    });

    // ── SHOOT (bullet tracer relay) ──
    socket.on('shoot', ({ from, to }) => {
        if (!currentRoomId) return;
        socket.to(currentRoomId).emit('player-shoot', { from, to });
    });

    // ── DAMAGE (lethal PvP relay) ──
    socket.on('remote-damage', ({ victimId, damage }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const shooter = room.players[socket.id];
        if (shooter) {
            io.to(victimId).emit('take-damage', {
                amount: damage,
                killerId: socket.id,
                killerName: shooter.name
            });
        }
    });

    // ── BOT KILL (update host) ──
    socket.on('bot-kill', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const shooter = room.players[socket.id];
        if (!shooter) return;
        
        shooter.score += 1;
        socket.emit('score-update', { score: shooter.score });
        
        // Broadcast the kill feed
        io.to(currentRoomId).emit('bot-killed', {
            botId: `bot_${data.botIdx}`,
            killerId: socket.id,
            killerName: shooter.name,
            killerScore: shooter.score
        });

        // Tell the Host to physically kill the bot immediately
        if (room.hostId && room.hostId !== socket.id) {
            socket.to(room.hostId).emit('bot-died-remote', { botIdx: data.botIdx });
        }
    });

    // ── PICKUP COLLECTED (relay to host) ──
    socket.on('pickup-collected', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        // Notify the host so the timer can start
        if (room.hostId && room.hostId !== socket.id) {
            socket.to(room.hostId).emit('pickup-collected-remote', { 
                type: data.type, 
                index: data.index 
            });
        }
    });

    // ── CHAT ──
    socket.on('chat', ({ message }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const player = rooms[currentRoomId].players[socket.id];
        if (!player || !message || message.trim() === '') return;

        const sanitized = message.trim().slice(0, 150);
        io.to(currentRoomId).emit('chat-message', {
            senderId: socket.id,
            senderName: player.name,
            senderColor: player.skinColor,
            message: sanitized,
            timestamp: Date.now()
        });
    });

    // ── SCORE UPDATE (from killing bots client-side) ──
    socket.on('bot-kill', ({ score }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const player = rooms[currentRoomId].players[socket.id];
        if (!player) return;
        player.score = score;
        socket.to(currentRoomId).emit('score-sync', { id: socket.id, score });
    });

    // ── PLAYER DIED (self/bot) ──
    socket.on('player-died', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const player = rooms[currentRoomId].players[socket.id];
        if (!player) return;
        player.deaths += 1;
    });

    // ── LEAVE ROOM ──
    socket.on('leave-room', () => {
        handlePlayerDeparture(socket);
    });

    // ── PLAYER COMBAT ──
    socket.on('shoot', ({ targetId, damage, weaponName }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const targetPlayer = room.players[targetId];

        if (targetPlayer && !targetPlayer.isDead) { // simplified check
            // Relay to victim
            socket.to(targetId).emit('take-damage', { 
                fromName: room.players[socket.id].name, 
                damage, 
                health: targetPlayer.health - damage 
            });
        }
    });

    socket.on('player-died', ({ killerId, killerName, weaponType }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const victim = room.players[socket.id];
        
        if (victim) {
            victim.deaths = (victim.deaths || 0) + 1;
            const killer = room.players[killerId];
            if (killer && killerId !== socket.id) {
                killer.score = (killer.score || 0) + 1;
                io.to(currentRoomId).emit('player-killed', {
                    killerId,
                    killerName,
                    victimId: socket.id,
                    victimName: victim.name,
                    killerScore: killer.score
                });
            }
        }
    });


    // ── DISCONNECT ──
    socket.on('disconnect', () => {
        console.log(`[Disconnect] ${socket.id}`);
        handlePlayerDeparture(socket);
    });

    function handlePlayerDeparture(targetSocket) {
        if (currentRoomId && rooms[currentRoomId]) {
            const room = rooms[currentRoomId];
            const player = room.players[targetSocket.id];
            delete room.players[targetSocket.id];

            targetSocket.leave(currentRoomId);

            io.to(currentRoomId).emit('player-left', {
                id: targetSocket.id,
                name: player ? player.name : 'Unknown'
            });

            // Reassign host if needed
            if (room.hostId === targetSocket.id) {
                const remaining = Object.keys(room.players);
                if (remaining.length > 0) {
                    room.hostId = remaining[0];
                    room.players[remaining[0]].isHost = true;
                    io.to(remaining[0]).emit('you-are-host');
                }
            }

            broadcastLobbyState(currentRoomId);
            cleanRoom(currentRoomId);
            currentRoomId = null;
        }
    }

    // ── PING (latency check) ──
    socket.on('ping-check', (cb) => {
        if (typeof cb === 'function') cb();
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Health Check (for Render)
// ──────────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        status: 'ShootMaster Server Online',
        rooms: Object.keys(rooms).length,
        players: Object.values(rooms).reduce((sum, r) => sum + Object.keys(r.players).length, 0)
    });
});

server.listen(PORT, () => {
    console.log(`🚀 ShootMaster Server running on port ${PORT}`);
});
