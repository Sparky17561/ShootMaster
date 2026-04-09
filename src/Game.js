import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { updateInput, initInput } from './input.js';
import { updatePhysics } from './physics.js';
import { updateWeapon, initWeapon } from './weapon.js';
import { initWorld, updateWorld, updateBots, clearAllBots, spawnBots, bots, obstacles, mapStructure } from './world.js';
import { RemotePlayer } from './RemotePlayer.js';
import { initNetwork, sendChatMessage, isConnected, disconnect, emitStartGame, emitLeaveRoom, emitPlayerDied, clearChat } from './network.js';

class Game {
    constructor() {
        this.container = document.getElementById('game-container');
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.clock = new THREE.Clock();
        this.accumulator = 0;
        this.isStarted = false;

        // Profile (set by menu)
        this.playerProfile = { name: 'Ghost', skinColor: '#00e5ff', mode: 'solo', roomId: null };

        // Network State
        this.networkState = {
            myId: null,
            roomId: null,
            isHost: false,
            leaderboard: [],
            connected: false
        };

        this.missionTimer = CONFIG.MISSION_TIME;

        this.playerState = {
            position: { x: 0, y: CONFIG.PLAYER_HEIGHT, z: 80 },
            velocity: { x: 0, y: 0, z: 0 },
            rotation: { pitch: 0, yaw: 0 },
            health: 100,
            score: 0,
            isGrounded: false,
            isJumping: false,
            isShooting: false,
            isADS: false,
            isSliding: false,
            isCrouching: false,
            controlMode: 'pointerlock',
            slideDirection: { x: 0, z: 0 },
            slideTimer: 0,
            slideCooldown: 0,
            lastHitTime: 0,
            recoilOffset: { x: 0, y: 0 },
            currentFOV: CONFIG.FOV_BASE,
            cameraTilt: 0,
            cameraShake: { x: 0, y: 0, z: 0 },
            isDead: false,
            respawnTimer: 0,
            eventFeed: [],
            inventory: [
                { ...CONFIG.WEAPONS.PISTOL },
                { ...CONFIG.WEAPONS.RIFLE },
                { ...CONFIG.WEAPONS.SHOTGUN },
                { ...CONFIG.WEAPONS.SNIPER }
            ],
            currentWeaponIndex: 0,
            isReloading: false,
            reloadTimer: 0,
            grenades: 3,
            deaths: 0
        };

        this.worldGrenades = [];
        this.minimapElements = { buildings: [], bots: [], players: {} };
        this.pickups = [];
        this.remotePlayers = {}; // { socketId: RemotePlayer }

        this.inputBuffer = {
            forward: false, backward: false, left: false, right: false,
            jump: false, modifier: false, shoot: false, ads: false,
            mouseDelta: { x: 0, y: 0 }
        };

        this.weapon = { cooldown: 0 };
        this.playerHitbox = null;

        this._init3D();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3D Scene Init (runs immediately, before menu)
    // ──────────────────────────────────────────────────────────────────────────

    _init3D() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a12);
        this.scene.fog = new THREE.FogExp2(0x0a0a12, 0.008);

        this.camera = new THREE.PerspectiveCamera(CONFIG.FOV_BASE, window.innerWidth / window.innerHeight, 0.1, 1000);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        initWorld(this.scene, this);
        initInput(this);
        initWeapon(this.scene, this.camera);

        // Player Hitbox
        const hitboxGeom = new THREE.BoxGeometry(CONFIG.PLAYER_WIDTH, CONFIG.PLAYER_HEIGHT, CONFIG.PLAYER_WIDTH);
        const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
        this.playerHitbox = new THREE.Mesh(hitboxGeom, hitboxMat);
        this.scene.add(this.playerHitbox);

        window.addEventListener('resize', () => this.onWindowResize());

        // Start render loop (renders menu background before game starts)
        this.animate();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Start Game (called after menu)
    // ──────────────────────────────────────────────────────────────────────────

    async startGame(profile) {
        this.playerProfile = profile;
        this._resetState();

        // Always ensure a clean bot state before starting any match logic
        clearAllBots(this.scene);

        // Hiding the specific main menu / setup screen is handled by menu.js.
        // We do NOT hide screens-layer here because we might need to show the Lobby.
        // We will hide screens-layer and remove game-hidden when the match actually starts.

        // Update HUD with name and mode
        const nameEl = document.getElementById('player-name-hud');
        if (nameEl) nameEl.textContent = profile.name;

        const modeEl = document.getElementById('mode-badge');
        const modeLabels = { solo: 'SOLO', pvp: 'PVP' };
        if (modeEl) modeEl.textContent = modeLabels[profile.mode] || profile.mode.toUpperCase();

        // Show/hide chat based on mode
        const chatPanel = document.getElementById('chat-panel');
        if (chatPanel) {
            chatPanel.style.display = profile.mode === 'pvp' ? 'flex' : 'none';
        }

        // Network for PvP/bots mode
        if (profile.mode === 'pvp' || profile.mode === 'bots') {
            this.addEvent('Connecting...', '#0ef');
            try {
                // Clear chat for new room
                clearChat();
                
                // Show chat
                if (chatPanel) chatPanel.style.display = 'flex';
                // Move chat slightly above other screens if in lobby
                chatPanel.style.zIndex = '10000';

                await initNetwork(this, profile.roomId, profile);
                this.networkState.connected = true;
                this._setupChatInput();

                // Show Lobby instead of starting
                const lobby = document.getElementById('lobby-screen');
                if (lobby) {
                    lobby.classList.remove('hidden');
                    document.getElementById('lobby-room-code').textContent = this.networkState.roomId;
                }

                // Bind Lobby Buttons
                const leaveBtn = document.getElementById('lobby-leave-btn');
                if (leaveBtn) leaveBtn.onclick = () => {
                    emitLeaveRoom();
                    disconnect();
                    this.returnToMenu();
                };

                const startBtn = document.getElementById('lobby-start-btn');
                if (startBtn) startBtn.onclick = () => {
                    emitStartGame();
                };

                const terminateBtn = document.getElementById('lobby-terminate-btn');
                if (terminateBtn) terminateBtn.onclick = () => {
                    if (confirm("Are you sure you want to completely terminate this room?")) {
                        import('./network.js').then(net => {
                            if (net.emitTerminateRoom) net.emitTerminateRoom();
                        });
                    }
                };

                return; // Do NOT request pointer lock yet. User is in lobby.
            } catch (err) {
                this.addEvent(`Connection failed: ${err.message}`, '#f44');
                if (chatPanel) chatPanel.style.display = 'none';
                this.returnToMenu();
            }
        } else {
            // Solo game starts immediately
            this.startNetworkMatch();
        }
    }

    startNetworkMatch() {
        this.isStarted = true;

        // Spawn bots if we are the authority (Solo or PvP Host)
        if (this.playerProfile.mode === 'solo' || this.networkState.isHost) {
            spawnBots(this.scene, this);
        }
        
        // Hide screens-layer and show game
        const screensLayer = document.getElementById('screens-layer');
        if (screensLayer) screensLayer.style.display = 'none';
        this.container.classList.remove('game-hidden');

        const lobby = document.getElementById('lobby-screen');
        if (lobby) lobby.classList.add('hidden');
        
        // Reset chat z-index 
        const chatPanel = document.getElementById('chat-panel');
        if (chatPanel) chatPanel.style.zIndex = '';
        
        // Clear chat for a fresh game start
        clearChat();

        this.container.requestPointerLock();
    }

    returnToMenu() {
        this.isStarted = false;
        document.body.classList.remove('dead');
        const screensLayer = document.getElementById('screens-layer');
        if (screensLayer) screensLayer.style.display = '';
        this.container.classList.add('game-hidden');
        
        const lobby = document.getElementById('lobby-screen');
        if (lobby) lobby.classList.add('hidden');
        const deathScreen = document.getElementById('death-screen');
        if (deathScreen) deathScreen.classList.add('hidden');
        const matchEnd = document.getElementById('match-end-screen');
        if (matchEnd) matchEnd.style.display = 'none';

        // Reset state & clear world
        this._resetState();
        clearAllBots(this.scene);

        // Clean Remote Players
        Object.keys(this.remotePlayers).forEach(id => this.removeRemotePlayer(id));

        const menu = document.getElementById('main-menu');
        if (menu) menu.classList.remove('hidden');
    }

    _resetState() {
        this.playerState.score = 0;
        this.playerState.deaths = 0;
        this.playerState.health = 100;
        this.playerState.isDead = false;
        this.playerState.position = { x: 0, y: CONFIG.PLAYER_HEIGHT, z: 80 };
        this.playerState.velocity = { x: 0, y: 0, z: 0 };
        this.playerState.grenades = 3; 
        this.missionTimer = CONFIG.MISSION_TIME;
        
        // Reset Ammo
        this.playerState.inventory = [
            { ...CONFIG.WEAPONS.PISTOL },
            { ...CONFIG.WEAPONS.RIFLE },
            { ...CONFIG.WEAPONS.SHOTGUN },
            { ...CONFIG.WEAPONS.SNIPER }
        ];

        // Reset Input Buffer
        Object.keys(this.inputBuffer).forEach(key => {
            if (typeof this.inputBuffer[key] === 'boolean') this.inputBuffer[key] = false;
            if (key === 'mouseDelta') { this.inputBuffer.mouseDelta.x = 0; this.inputBuffer.mouseDelta.y = 0; }
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Remote Player Management
    // ──────────────────────────────────────────────────────────────────────────

    addRemotePlayer(playerData) {
        if (this.remotePlayers[playerData.id]) return;
        const rp = new RemotePlayer(this.scene, playerData);
        rp.isHost = playerData.isHost || false;
        this.remotePlayers[playerData.id] = rp;
    }

    removeRemotePlayer(id) {
        const rp = this.remotePlayers[id];
        if (rp) {
            rp.dispose();
            delete this.remotePlayers[id];
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Game Loop
    // ──────────────────────────────────────────────────────────────────────────

    animate() {
        requestAnimationFrame(() => this.animate());

        const deltaTime = Math.min(this.clock.getDelta(), 0.05); // Cap at 50ms
        this.accumulator += deltaTime;

        while (this.accumulator >= CONFIG.FIXED_UPDATE_RATE) {
            this.fixedUpdate(CONFIG.FIXED_UPDATE_RATE);
            this.accumulator -= CONFIG.FIXED_UPDATE_RATE;
        }

        // Update remote player interpolation every frame
        Object.values(this.remotePlayers).forEach(rp => rp.update(deltaTime));

        this.render();
        this.updateHUD(deltaTime);
    }

    fixedUpdate(dt) {
        if (!this.isStarted) return;

        updateInput(this, dt);
        updatePhysics(this, dt);
        updateWeapon(this, dt);

        // Weapon switching
        if (this.inputBuffer.switchNext) {
            this.playerState.currentWeaponIndex = (this.playerState.currentWeaponIndex + 1) % this.playerState.inventory.length;
            this.playerState.isReloading = false;
            this.inputBuffer.switchNext = false;
        }
        if (this.inputBuffer.switchPrev) {
            this.playerState.currentWeaponIndex = (this.playerState.currentWeaponIndex - 1 + this.playerState.inventory.length) % this.playerState.inventory.length;
            this.playerState.isReloading = false;
            this.inputBuffer.switchPrev = false;
        }

        updateWorld(this, dt);

        // Pickups
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const p = this.pickups[i];
            if (p.visible) {
                const dist = p.position.distanceTo(new THREE.Vector3(this.playerState.position.x, 0.5, this.playerState.position.z));
                if (dist < 2.0) {
                    if (p.userData.type === 'health' && this.playerState.health < 100) {
                        this.playerState.health = Math.min(100, this.playerState.health + CONFIG.PICKUP_HEALTH_VALUE);
                        this.addEvent('+25 HEALTH', '#0f4');
                        p.visible = false;
                        p.userData.respawnTimer = CONFIG.PICKUP_RESPAWN_TIME;
                        
                        if (this.networkState.connected && !this.networkState.isHost) {
                            import('./network.js').then(net => net.emitPickupCollected('health', i));
                        }
                    } else if (p.userData.type === 'ammo') {
                        const curWep = this.playerState.inventory[this.playerState.currentWeaponIndex];
                        if (curWep.reserve !== Infinity && curWep.reserve !== null) {
                            curWep.reserve += CONFIG.PICKUP_AMMO_VALUE;
                            this.addEvent('+30 AMMO', '#04f');
                            p.visible = false;
                            p.userData.respawnTimer = CONFIG.PICKUP_RESPAWN_TIME;

                            if (this.networkState.connected && !this.networkState.isHost) {
                                import('./network.js').then(net => net.emitPickupCollected('ammo', i));
                            }
                        }
                    }
                }
            } else {
                // Only Host or Single Player updates respawn timer
                if (!this.networkState.connected || this.networkState.isHost) {
                    p.userData.respawnTimer -= dt;
                    if (p.userData.respawnTimer <= 0) p.visible = true;
                }
            }
            p.rotation.y += dt;
        }

        // Bot AI (Host Authority)
        this.playerHitbox.position.set(
            this.playerState.position.x,
            this.playerState.position.y - CONFIG.PLAYER_HEIGHT / 2,
            this.playerState.position.z
        );
        if (!this.networkState.connected || this.networkState.isHost) {
            updateBots(this, dt, this.playerHitbox);
        }

        // Respawn Timer (HUD only)
        if (this.playerState.isDead) {
            this.playerState.respawnTimer = Math.max(0, this.playerState.respawnTimer - dt);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Render
    // ──────────────────────────────────────────────────────────────────────────

    render() {
        this.playerState.cameraShake.x *= CONFIG.SCREEN_SHAKE_DECAY;
        this.playerState.cameraShake.y *= CONFIG.SCREEN_SHAKE_DECAY;
        this.playerState.cameraShake.z *= CONFIG.SCREEN_SHAKE_DECAY;

        this.camera.position.set(
            this.playerState.position.x + this.playerState.cameraShake.x,
            this.playerState.position.y + this.playerState.cameraShake.y,
            this.playerState.position.z + this.playerState.cameraShake.z
        );

        const pitch = this.playerState.rotation.pitch + this.playerState.recoilOffset.y + (Math.random() - 0.5) * this.playerState.cameraShake.y * 0.1;
        const yaw = this.playerState.rotation.yaw + this.playerState.recoilOffset.x + (Math.random() - 0.5) * this.playerState.cameraShake.x * 0.1;

        this.camera.rotation.set(pitch, yaw, this.playerState.cameraTilt + this.playerState.cameraShake.z * 0.05, 'YXZ');
        this.camera.fov = this.playerState.currentFOV;
        this.camera.updateProjectionMatrix();

        this.renderer.render(this.scene, this.camera);

        // --- Local Tactical Laser Sight ---
        if (this.playerState.isADS && !this.playerState.isDead) {
            if (!this._localLaser) {
                const geom = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(0, 0, -50)
                ]);
                const mat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.3 });
                this._localLaser = new THREE.Line(geom, mat);
                this.scene.add(this._localLaser);
            }
            
            // Align with camera
            this._localLaser.position.copy(this.camera.position).addScaledVector(new THREE.Vector3().set(0,0,-1).applyQuaternion(this.camera.quaternion), 1.0);
            this._localLaser.quaternion.copy(this.camera.quaternion);
            this._localLaser.visible = true;
        } else if (this._localLaser) {
            this._localLaser.visible = false;
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Combat
    // ──────────────────────────────────────────────────────────────────────────

    takeDamage(amount, killerId, killerName) {
        if (this.playerState.isDead || this.playerState.isInvulnerable) return;
        if (amount > 0) {
            this.playerState.health = Math.max(0, this.playerState.health - amount);
        }

        const flash = document.getElementById('damage-flash');
        if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 200); }

        this.playerState.cameraShake.x += (Math.random() - 0.5) * 1.5;
        this.playerState.cameraShake.y += (Math.random() - 0.5) * 1.5;
        this.playerState.cameraShake.z += (Math.random() - 0.5) * 0.5;

        if (this.playerState.health <= 0) this.die(killerId, killerName);
    }

    die(killerId, killerName) {
        if (this.playerState.isDead) return;
        this.playerState.isDead = true;
        this.playerState.deaths = (this.playerState.deaths || 0) + 1;
        this.playerState.respawnTimer = CONFIG.PLAYER_RESPAWN_TIME;
        this.playerState.velocity.x = 0;
        this.playerState.velocity.z = 0;

        // Force UI update
        document.body.classList.add('dead');
        const deathScreen = document.getElementById('death-screen');
        if (deathScreen) {
             deathScreen.style.display = 'flex';
             const killerInfo = document.getElementById('death-killer-info');
             if (killerInfo) killerInfo.textContent = `ELIMINATED BY ${killerName || 'THE ARENA'}`;
             
             // Setup click to respawn
             const respawnBtn = document.getElementById('respawn-btn');
             if (respawnBtn) {
                 respawnBtn.style.display = 'block';
                 respawnBtn.onclick = () => {
                     if (this.playerState.isDead && this.playerState.respawnTimer <= 0) {
                         this.respawnPlayer();
                     }
                 };
             }
        }
        
        // Secondary/Network tasks (safer here)
        try {
            this.updateDeathLeaderboard();
        } catch (e) { console.error("Leaderboard UI update failed:", e); }

        emitPlayerDied(killerId, killerName);
    }

    updateDeathLeaderboard() {
        const lbContainer = document.getElementById('death-leaderboard');
        if (!lbContainer) return;

        // If Single Player (Solo) - Show Player Stats
        if (this.playerProfile.mode === 'solo' || !this.networkState.connected) {
            const k = this.playerState.score || 0;
            const d = this.playerState.deaths || 0;
            const kd = d === 0 ? k : (k / d).toFixed(2);
            lbContainer.innerHTML = `
                <div class="solo-stats">
                    <p style="color:var(--cyan);font-size:12px;margin:0">YOUR PERFORMANCE</p>
                    <div style="display:flex;gap:20px;justify-content:center;margin-top:10px;">
                        <div><span style="display:block;font-size:32px;color:#fff">${k}</span><span style="font-size:10px;color:var(--muted)">KILLS</span></div>
                        <div><span style="display:block;font-size:32px;color:#fff">${d}</span><span style="font-size:10px;color:var(--muted)">DEATHS</span></div>
                        <div><span style="font-size:10px;color:var(--muted)"></span></div>
                        <div><span style="display:block;font-size:32px;color:var(--gold)">${kd}</span><span style="font-size:10px;color:var(--muted)">K/D</span></div>
                    </div>
                </div>`;
            return;
        }

        // Multiplayer Leaderboard (Safety check on array-like data)
        const lb = this.networkState.leaderboard;
        if (!lb || !Array.isArray(lb)) {
            lbContainer.innerHTML = "<div style='color:var(--muted);font-size:11px;text-align:center;'>Waiting for tactical data...</div>";
            return;
        }

        let html = '<table class="lb-table"><tr><th>PLAYER</th><th>K</th><th>D</th></tr>';
        lb.slice(0, 5).forEach(p => {
            html += `<tr><td style="color:${p.color}">${p.name}</td><td>${p.score}</td><td>${p.deaths}</td></tr>`;
        });
        html += '</table>';
        lbContainer.innerHTML = html;
    }

    respawnPlayer() {
        this._resetState();
        this.playerState.isInvulnerable = true;

        // Strategic Spawning: Furthest from all enemies
        let bestPoint = CONFIG.SPAWN_POINTS[0];
        let maxDist = -1;
        
        CONFIG.SPAWN_POINTS.forEach(pt => {
            let totalDist = 0;
            const rps = Object.values(this.remotePlayers);
            if (rps.length === 0) {
                totalDist = Math.random() * 100; // Random if alone
            } else {
                rps.forEach(rp => {
                    const d = Math.sqrt((pt.x - rp.mesh.position.x)**2 + (pt.z - rp.mesh.position.z)**2);
                    totalDist += d;
                });
            }
            if (totalDist > maxDist) {
                maxDist = totalDist;
                bestPoint = pt;
            }
        });

        this.playerState.position = { x: bestPoint.x, y: bestPoint.y, z: bestPoint.z };
        this.playerState.velocity = { x: 0, y: 0, z: 0 };
        document.body.classList.remove('dead');
        const deathScreen = document.getElementById('death-screen');
        if (deathScreen) deathScreen.style.display = 'none';

        // Shield Timeout
        setTimeout(() => {
            this.playerState.isInvulnerable = false;
        }, CONFIG.SPAWN_SHIELD_DURATION * 1000);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────────

    addEvent(text, color = '#fff') {
        const feed = document.getElementById('event-feed');
        if (!feed) return;

        const item = document.createElement('div');
        item.className = 'event-item';
        item.style.color = color;
        item.innerText = text;
        feed.prepend(item);

        // Fade after 2.5s, remove after 3s
        setTimeout(() => item.classList.add('fading'), 2500);
        setTimeout(() => item.remove(), 3000);

        // Cap at 5 messages
        while (feed.children.length > 5) feed.lastChild.remove();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Chat
    // ──────────────────────────────────────────────────────────────────────────

    _setupChatInput() {
        const chatInput = document.getElementById('chat-input');
        const chatForm = document.getElementById('chat-form');
        if (!chatInput || !chatForm) return;

        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const msg = chatInput.value.trim();
            if (msg) {
                sendChatMessage(msg);
                chatInput.value = '';
            }
            chatInput.blur();
        });

        window.addEventListener('keydown', (e) => {
            // Enter to focus chat - ONLY if not dead (to avoid overlap with respawn)
            if (e.code === 'Enter' && this.playerProfile.mode === 'pvp' && !this.playerState.isDead && document.activeElement !== chatInput) {
                e.preventDefault();
                chatInput.focus();
            }
            if (e.code === 'Escape') chatInput.blur();
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // HUD
    // ──────────────────────────────────────────────────────────────────────────

    updateHUD(dt) {
        if (!this.playerHitbox) return;

        const speed = Math.sqrt(this.playerState.velocity.x ** 2 + this.playerState.velocity.z ** 2);
        const currentWep = this.playerState.inventory[this.playerState.currentWeaponIndex];
        const ammoTextReserve = (currentWep.reserve === Infinity || currentWep.reserve === null) ? '∞' : currentWep.reserve;

        // Stats text
        const killEl = document.getElementById('kill-counter');
        if (killEl) killEl.textContent = `KILLS: ${this.playerState.score || 0}`;
        const fpsEl = document.getElementById('fps-counter');
        if (fpsEl) fpsEl.textContent = `FPS: ${Math.round(1 / Math.max(dt, 0.001))}`;
        const spdEl = document.getElementById('speed-meter');
        if (spdEl) spdEl.textContent = `SPD: ${speed.toFixed(1)}`;
        const hpEl = document.getElementById('player-hp-val');
        if (hpEl) hpEl.textContent = Math.round(this.playerState.health);
        const wepEl = document.getElementById('weapon-name');
        if (wepEl) wepEl.textContent = currentWep.name.toUpperCase();
        const ammoMag = document.getElementById('ammo-mag');
        if (ammoMag) ammoMag.textContent = currentWep.ammo;
        const ammoRes = document.getElementById('ammo-reserve');
        if (ammoRes) ammoRes.textContent = ammoTextReserve;
        const nameHud = document.getElementById('player-name-hud');
        if (nameHud && !nameHud.textContent) nameHud.textContent = this.playerProfile.name;

        // HP bar
        const hpBar = document.getElementById('health-bar-fill');
        if (hpBar) {
            hpBar.style.width = `${this.playerState.health}%`;
            hpBar.className = 'bar-fill ' + (this.playerState.health > 60 ? 'health-high' : this.playerState.health > 30 ? 'health-med' : 'health-low');
        }

        // Ammo bar
        const ammoBar = document.getElementById('ammo-bar-fill');
        if (ammoBar) {
            const ammoPct = (currentWep.ammo / currentWep.magSize) * 100;
            ammoBar.style.width = `${ammoPct}%`;
            ammoBar.className = 'bar-fill ' + (currentWep.ammo === 0 ? 'ammo-empty' : 'ammo-active');
        }

        // Inventory slots
        for (let i = 0; i < 4; i++) {
            const slot = document.getElementById(`slot-${i}`);
            if (slot) slot.classList.toggle('active', i === this.playerState.currentWeaponIndex);
        }

        // Action banner
        const banner = document.getElementById('action-banner');
        if (banner) {
            if (this.playerState.isReloading) { banner.textContent = 'RELOADING...'; banner.classList.remove('hidden'); }
            else if (currentWep.ammo === 0) { banner.textContent = '⚠ OUT OF AMMO'; banner.classList.remove('hidden'); }
            else if (currentWep.ammo < currentWep.magSize * 0.3) { banner.textContent = '⚠ LOW AMMO'; banner.classList.remove('hidden'); }
            else banner.classList.add('hidden');
        }

        // Chat Hint in PvP (strictly pvp only)
        const chatHint = document.getElementById('chat-hint');
        if (chatHint) {
            chatHint.style.display = (this.playerProfile.mode === 'pvp' && !this.playerState.isDead) ? 'block' : 'none';
        }

        // Mission Timer
        if (this.isStarted && !this.playerState.isDead && this.playerProfile.mode === 'solo') {
            this.missionTimer -= dt;
            if (this.missionTimer <= 0) {
                this.missionTimer = 0;
                this.isStarted = false;
                this.showEndScreen();
            }
        }

        const timerEl = document.getElementById('mission-timer');
        if (timerEl && this.missionTimer >= 0) {
            const t = Math.max(0, this.missionTimer);
            const mins = Math.floor(t / 60);
            const secs = Math.floor(t % 60);
            timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            timerEl.classList.toggle('timer-low', t < 30);
        }

        // Minimap
        this._updateMinimap();

        // Crosshair
        const crosshair = document.getElementById('crosshair');
        if (crosshair) {
            let spreadBase = 10;
            if (speed > 5) spreadBase += speed * 0.5;
            if (!this.playerState.isGrounded) spreadBase += 20;
            if (this.playerState.isShooting) spreadBase += 15;
            if (this.playerState.isADS) spreadBase = 2;
            crosshair.style.setProperty('--spread', `${spreadBase}px`);
        }

        // Death Screen UI Updates
        if (this.playerState.isDead) {
            const respawnBtn = document.getElementById('respawn-btn');
            const timerSub = document.querySelector('.respawn-timer-sub');
            
            if (this.playerState.respawnTimer > 0) {
                if (respawnBtn) {
                    respawnBtn.style.opacity = '0.3';
                    respawnBtn.style.cursor = 'not-allowed';
                    respawnBtn.textContent = `PREPARING (${Math.ceil(this.playerState.respawnTimer)}s)`;
                }
                if (timerSub) timerSub.textContent = "Wait for tactical readiness...";
            } else {
                if (respawnBtn) {
                    respawnBtn.style.opacity = '1';
                    respawnBtn.style.cursor = 'pointer';
                    respawnBtn.textContent = 'ENTER THE ARENA';
                }
                if (timerSub) timerSub.textContent = "DROPSHIP READY. PRESS [ENTER] TO DEPLOY.";
            }
        }

        // Debug
        const pos = this.playerState.position;
        const posEl = document.getElementById('pos-display');
        if (posEl) posEl.textContent = `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
        const vel = this.playerState.velocity;
        const velEl = document.getElementById('vel-display');
        if (velEl) velEl.textContent = `${vel.x.toFixed(1)}, ${vel.y.toFixed(1)}, ${vel.z.toFixed(1)}`;
    }

    _updateMinimap() {
        const minimap = document.getElementById('minimap-container');
        if (!minimap) return;
        const radarRadius = 80;
        const px = this.playerState.position.x;
        const pz = this.playerState.position.z;

        if (this.minimapElements.buildings.length === 0) {
            mapStructure.forEach(() => {
                const el = document.createElement('div');
                el.className = 'building-rect';
                minimap.appendChild(el);
                this.minimapElements.buildings.push(el);
            });
        }
        if (this.minimapElements.bots.length === 0) {
            for (let i = 0; i < CONFIG.BOT_COUNT; i++) {
                const el = document.createElement('div');
                el.className = 'bot-dot';
                minimap.appendChild(el);
                this.minimapElements.bots.push(el);
            }
        }

        mapStructure.forEach((rect, i) => {
            const el = this.minimapElements.buildings[i];
            if (!el) return;
            const dx = rect.x - px, dz = rect.z - pz;
            if (Math.abs(dx) < radarRadius + rect.w / 2 && Math.abs(dz) < radarRadius + rect.d / 2) {
                el.classList.remove('hidden');
                el.style.left = `${(dx / (radarRadius * 2) + 0.5) * 100}%`;
                el.style.top = `${(dz / (radarRadius * 2) + 0.5) * 100}%`;
                el.style.width = `${(rect.w / (radarRadius * 2)) * 100}%`;
                el.style.height = `${(rect.d / (radarRadius * 2)) * 100}%`;
            } else {
                el.classList.add('hidden');
            }
        });

        bots.forEach((bot, i) => {
            const el = this.minimapElements.bots[i];
            if (!el) return;
            const dx = bot.position.x - px, dz = bot.position.z - pz;
            if (!bot.userData.isDead && bot.visible && Math.abs(dx) < radarRadius && Math.abs(dz) < radarRadius) {
                el.classList.remove('hidden');
                el.style.left = `${(dx / (radarRadius * 2) + 0.5) * 100}%`;
                el.style.top = `${(dz / (radarRadius * 2) + 0.5) * 100}%`;
                el.style.background = bot.userData.botType === 'SNIPER' ? '#cc00ff' : '#ff4400';
            } else {
                el.classList.add('hidden');
            }
        });

        // Remote Players (Friends/Teammates)
        Object.values(this.remotePlayers).forEach(rp => {
            let el = this.minimapElements.players[rp.id];
            if (!el) {
                el = document.createElement('div');
                el.className = 'bot-dot'; // use same base styling
                el.style.background = rp.skinColor || '#00ffcc';
                el.style.width = '5px'; el.style.height = '5px'; // slightly larger
                el.style.borderRadius = '50%';
                minimap.appendChild(el);
                this.minimapElements.players[rp.id] = el;
            }
            
            const dx = rp._currentPos.x - px, dz = rp._currentPos.z - pz;
            // Only draw if inside radar range AND not dead 
            // (assume remote player is alive if model is present, remote death isn't hidden currently)
            if (Math.abs(dx) < radarRadius && Math.abs(dz) < radarRadius) {
                el.classList.remove('hidden');
                el.style.left = `${(dx / (radarRadius * 2) + 0.5) * 100}%`;
                el.style.top = `${(dz / (radarRadius * 2) + 0.5) * 100}%`;
            } else {
                el.classList.add('hidden');
            }
        });
        
        // Clean disconnected players from minimap
        Object.keys(this.minimapElements.players).forEach(id => {
            if (!this.remotePlayers[id]) {
                const el = this.minimapElements.players[id];
                if (el && el.parentNode) el.parentNode.removeChild(el);
                delete this.minimapElements.players[id];
            }
        });
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // End Screen
    // ──────────────────────────────────────────────────────────────────────────

    showEndScreen() {
        // Release pointer lock
        if (document.pointerLockElement) document.exitPointerLock();

        const kills  = this.playerState.score;
        const deaths = this.playerState.deaths || 0;
        const kd     = deaths === 0 ? kills : (kills / deaths).toFixed(2);

        const endEl = document.getElementById('match-end-screen');
        if (!endEl) return;
        endEl.classList.remove('hidden');
        endEl.style.display = 'flex';

        endEl.innerHTML = `
<div class="match-end-inner">
  <h1>MISSION COMPLETE</h1>
  <h2>Time's up! Here's how you did:</h2>
  <div class="end-stats-grid">
    <div class="end-stat">
      <div class="end-stat-val" style="color:#a8ff00">${kills}</div>
      <div class="end-stat-label">KILLS</div>
    </div>
    <div class="end-stat">
      <div class="end-stat-val" style="color:#ff2244">${deaths}</div>
      <div class="end-stat-label">DEATHS</div>
    </div>
    <div class="end-stat">
      <div class="end-stat-val" style="color:#ffd700">${kd}</div>
      <div class="end-stat-label">K/D RATIO</div>
    </div>
  </div>
  <div class="end-btn-row">
    <button id="end-play-again" class="play-btn">PLAY AGAIN</button>
    <button id="end-main-menu" class="play-btn" style="background:linear-gradient(135deg,#2a2a46,#1e1e36);color:#dde4ff">MAIN MENU</button>
  </div>
</div>`;

        document.getElementById('end-play-again').addEventListener('click', () => {
            endEl.style.display = 'none';
            // Reset state and restart
            this.playerState.score = 0;
            this.playerState.deaths = 0;
            this.playerState.health = 100;
            this.playerState.isDead = false;
            this.playerState.position = { x: 0, y: CONFIG.PLAYER_HEIGHT, z: 80 };
            this.playerState.velocity = { x: 0, y: 0, z: 0 };
            this.missionTimer = CONFIG.MISSION_TIME;
            document.body.classList.remove('dead');
            this.container.requestPointerLock();
        });

        document.getElementById('end-main-menu').addEventListener('click', () => {
            if (this.networkState.connected) {
                emitLeaveRoom();
                disconnect();
            }
            this.returnToMenu();
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Lobby UI
    // ──────────────────────────────────────────────────────────────────────────
    static updateLobbyUI(players, hostId, gameInstance) {
        const list = document.getElementById('lobby-player-list');
        const startBtn = document.getElementById('lobby-start-btn');
        const waitingMsg = document.getElementById('lobby-waiting-msg');
        if (!list) return;

        list.innerHTML = Object.values(players).map(p => `
            <div class="lobby-player-item">
                <div class="lobby-player-color" style="color: ${p.skinColor}; background: ${p.skinColor}"></div>
                <div class="lobby-player-name" style="color: ${p.id === gameInstance.networkState.myId ? '#fff' : '#ccc'}">${p.name} 
                    ${p.id === gameInstance.networkState.myId ? '<span style="color:var(--muted);font-size:10px;">(You)</span>' : ''}
                </div>
                ${p.id === hostId ? '<div class="host-crown">👑 HOST</div>' : ''}
            </div>
        `).join('');

        // Update Lobby specific UI
        const terminateBtn = document.getElementById('lobby-terminate-btn');

        if (gameInstance.networkState.myId === hostId || gameInstance.networkState.isHost) {
            if (startBtn) {
                startBtn.style.display = 'flex';
                startBtn.style.visibility = 'visible';
                startBtn.style.opacity = '1';
                startBtn.style.zIndex = '10001';
            }
            if (terminateBtn) terminateBtn.style.display = 'flex';
            if (waitingMsg) waitingMsg.classList.add('hidden');
        } else {
            if (startBtn) startBtn.style.display = 'none';
            if (terminateBtn) terminateBtn.style.display = 'none';
            if (waitingMsg) waitingMsg.classList.remove('hidden');
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Pause Screen Updates
    // ──────────────────────────────────────────────────────────────────────────
    updatePauseScreen() {
        const k = this.playerState.score || 0;
        const d = this.playerState.deaths || 0;
        const kd = d === 0 ? k : (k / d).toFixed(2);
        
        const elK = document.getElementById('pause-val-kills');
        const elD = document.getElementById('pause-val-deaths');
        const elKD = document.getElementById('pause-val-kd');
        
        if (elK) elK.textContent = k;
        if (elD) elD.textContent = d;
        if (elKD) elKD.textContent = kd;

        // Ensure buttons are bound once
        if (!this._pauseBound) {
            this._pauseBound = true;
            const resumeBtn = document.getElementById('pause-resume-btn');
            const abortBtn = document.getElementById('pause-abort-btn');

            if (resumeBtn) resumeBtn.onclick = () => {
                if (!this.isStarted || this.playerState.isDead) return;
                this.container.requestPointerLock();
            };

            if (abortBtn) abortBtn.onclick = () => {
                const instruction = document.getElementById('instruction');
                if (instruction) instruction.classList.add('hidden');
                
                if (this.networkState.connected) {
                    emitLeaveRoom();
                    disconnect();
                }
                this.returnToMenu();
            };
        }
    }
}

export default Game;
