import * as THREE from 'three';
import { CONFIG } from './Config.js';

export let targets = [];
export let bots = [];
export let obstacles = [];
export let tracers = [];
export let mapStructure = [];
export let healthKits = [];
export let ammoBoxes = [];
export let playerHitboxes = [];

const _tempVec = new THREE.Vector3();
const _zeroVec = new THREE.Vector3(0, 0, 0);
const _botRaycaster = new THREE.Raycaster();
const _playerPos = new THREE.Vector3();
const _dirToPlayer = new THREE.Vector3();
const _strafeVec = new THREE.Vector3();
let _gameRef = null;

// ── Persistent, pre-allocated working arrays ──────────────────────────────────
// These are built ONCE (or rebuilt only when player count changes) and reused
// every frame. No spread operators, no .filter(), no .map() in the hot path.
const _botRayTargets = [];  // obstacles + playerHitboxes + localHitbox
const _allTargetPos = [];  // { pos:Vector3, id, isDead } — reused objects

// Bot AI is expensive. Throttle to BOT_AI_HZ so the host's main thread
// stays free for rendering and network IO.
const BOT_AI_HZ = 20;   // AI ticks per second (was effectively 60)
const BOT_AI_DT = 1 / BOT_AI_HZ;
let _botAiAccumulator = 0;

// Cached counters — updated on state change, never via .filter() every frame
let _cachedSniperCount = 0;
let _cachedTargetSnipers = 0;

// ─────────────────────────────────────────────────────────────────────────────

export function initWorld(scene, game) {
    _gameRef = game;

    // 1. Lighting & Fog
    const ambient = new THREE.AmbientLight(0x404040);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(20, 40, 20);
    directional.castShadow = true;
    directional.shadow.mapSize.width = 1024;
    directional.shadow.mapSize.height = 1024;
    scene.add(directional);

    scene.fog = new THREE.Fog(0x050505, 10, 130);

    // 2. Ground
    const groundGeometry = new THREE.PlaneGeometry(300, 300);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 3. Boundary Walls
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const wallHeight = 10;
    const wallGeoms = [
        { size: [300, wallHeight, 1], pos: [0, wallHeight / 2, -150] },
        { size: [300, wallHeight, 1], pos: [0, wallHeight / 2, 150] },
        { size: [1, wallHeight, 300], pos: [-150, wallHeight / 2, 0] },
        { size: [1, wallHeight, 300], pos: [150, wallHeight / 2, 0] }
    ];
    wallGeoms.forEach(cfg => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(...cfg.size), wallMaterial);
        wall.position.set(...cfg.pos);
        scene.add(wall);
        obstacles.push(wall);
    });

    // 4. Platforms & Covers
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5 });

    const platformConfigs = [
        { size: [14, 2, 14], pos: [20, 1, 20] },
        { size: [10, 5, 10], pos: [-25, 2.5, -25] },
        { size: [40, 1.5, 20], pos: [0, 5, -50] },
        { size: [8, 4, 8], pos: [35, 2, -15] },
        { size: [2, 10, 2], pos: [10, 5, 10], mat: accentMaterial },
        { size: [2, 10, 2], pos: [-10, 5, 10], mat: accentMaterial },
        { size: [2, 10, 2], pos: [10, 5, -10], mat: accentMaterial },
        { size: [2, 10, 2], pos: [-10, 5, -10], mat: accentMaterial },
        { size: [2, 10, 2], pos: [40, 5, 40], mat: accentMaterial },
        { size: [2, 10, 2], pos: [-40, 5, -40], mat: accentMaterial },
        { size: [2, 10, 2], pos: [40, 5, -40], mat: accentMaterial },
        { size: [2, 10, 2], pos: [-40, 5, 40], mat: accentMaterial },
        { size: [4, 4, 4], pos: [0, 2, -25] },
        { size: [3, 6, 3], pos: [-30, 3, 5] },
        { size: [5, 2, 5], pos: [-5, 1, 0] },
        { size: [3, 8, 3], pos: [50, 4, 50], mat: accentMaterial },
        { size: [3, 8, 3], pos: [-50, 4, 50], mat: accentMaterial },
        { size: [3, 8, 3], pos: [50, 4, -50], mat: accentMaterial },
        { size: [3, 8, 3], pos: [-50, 4, -50], mat: accentMaterial },
        { size: [6, 4, 6], pos: [80, 2, 20] },
        { size: [6, 4, 6], pos: [-80, 2, -20] },
        { size: [2, 12, 2], pos: [0, 6, -100], mat: accentMaterial },
        { size: [4, 4, 4], pos: [-40, 2, 80] },
        { size: [4, 4, 4], pos: [40, 2, 80] }
    ];
    platformConfigs.forEach(cfg => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(...cfg.size), cfg.mat || platformMaterial);
        wall.position.set(...cfg.pos);
        wall.castShadow = true; wall.receiveShadow = true;
        scene.add(wall);
        obstacles.push(wall);
    });

    // 4.5. Tactical Complexes
    const complexSize = 25;
    const outpostPositions = [
        { x: 80, z: 80 }, { x: -80, z: 80 },
        { x: 80, z: -80 }, { x: -80, z: -80 }
    ];
    outpostPositions.forEach(pos => {
        createBuilding(scene, pos.x, pos.z, complexSize, complexSize, 8, platformMaterial);
        mapStructure.push({ x: pos.x, z: pos.z, w: complexSize, d: complexSize });
        const rampStart = new THREE.Vector3(pos.x, 0, pos.z + complexSize / 2 + 20);
        createRamp(scene, rampStart, 20, 8, 12, platformMaterial);
    });

    // 6. Bots (ONLY in Solo or Vs Bots modes, Not in Pure PvP)
    _cachedSniperCount = 0;
    const isPvP = game.playerProfile && game.playerProfile.mode === 'pvp';
    
    if (!isPvP) {
        for (let i = 0; i < CONFIG.BOT_COUNT; i++) {
        const botGroup = new THREE.Group();
        const isSniper = Math.random() < CONFIG.BOT_TYPES.SNIPER.probability;
        const botType = isSniper ? 'SNIPER' : 'GRUNT';
        const config = CONFIG.BOT_TYPES[botType];
        const bHeight = isSniper ? 3.0 : CONFIG.BOT_HEIGHT;
        const bRadius = isSniper ? 0.9 : CONFIG.BOT_RADIUS;

        const bodyGeom = new THREE.CylinderGeometry(bRadius, bRadius, bHeight - 0.5, 16);
        bodyGeom.translate(0, (bHeight - 0.5) / 2, 0);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: isSniper ? 0xcc00ff : 0xff4400,
            emissive: isSniper ? 0xcc00ff : 0xff4400,
            emissiveIntensity: isSniper ? 5.0 : 0.8
        });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.userData.parentBot = botGroup;
        botGroup.add(body);

        const headGeom = new THREE.SphereGeometry(isSniper ? 0.5 : 0.4, 16, 16);
        headGeom.translate(0, bHeight - 0.2, 0);
        const headMat = new THREE.MeshStandardMaterial({
            color: 0xffff00, emissive: 0xffff00,
            emissiveIntensity: isSniper ? 5.0 : 0.5
        });
        const head = new THREE.Mesh(headGeom, headMat);
        head.userData.isHead = true;
        head.userData.parentBot = botGroup;
        botGroup.add(head);

        const spawnPos = getRandomSafePosition(new THREE.Vector3(0, 0, 80));
        botGroup.position.copy(spawnPos);
        botGroup.position.y = 0;

        botGroup.userData = {
            isBot: true, botType,
            health: CONFIG.BOT_HEALTH,
            isDead: false, respawnTimer: 0, hitTimer: 0,
            shootCooldown: Math.random() * config.fireRate,
            strafeTimer: 0, strafeDir: 1,
            state: 'idle', reactionTimer: 0,
            isAiming: false, aimTimer: 0,
            laserLine: null, baseScale: 1.0
        };

        if (isSniper) _cachedSniperCount++;
        scene.add(botGroup);
        bots.push(botGroup);
    }
    }

    // 7. Pickups
    initPickups(scene, game);

    // 8. Cache AABBs
    obstacles.forEach(obs => {
        obs.userData.aabb = new THREE.Box3().setFromObject(obs);
    });
}

// ─────────────────────────────────────────────────────────────────────────────

function initPickups(scene, game) {
    const healthGeom = new THREE.BoxGeometry(1, 1, 1);
    const ammoGeom = new THREE.BoxGeometry(1.2, 0.6, 1.2);
    const healthMat = new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 0.5 });
    const ammoMat = new THREE.MeshStandardMaterial({ color: 0x0044ff, emissive: 0x0044ff, emissiveIntensity: 0.5 });

    for (let i = 0; i < CONFIG.PICKUP_SPAWN_COUNT; i++) {
        const h = new THREE.Mesh(healthGeom, healthMat);
        const posH = getRandomSafePosition(new THREE.Vector3(0, 0, 0));
        h.position.set(posH.x, 0.5, posH.z);
        h.userData = { type: 'health', respawnTimer: 0 };
        scene.add(h); game.pickups.push(h); healthKits.push(h);

        const a = new THREE.Mesh(ammoGeom, ammoMat);
        const posA = getRandomSafePosition(new THREE.Vector3(0, 0, 0));
        a.position.set(posA.x, 0.3, posA.z);
        a.userData = { type: 'ammo', respawnTimer: 0 };
        scene.add(a); game.pickups.push(a); ammoBoxes.push(a);
    }
}

function createBuilding(scene, x, z, w, d, h, material) {
    const wallThick = 2.0;
    const wallConfigs = [
        { size: [w, h + wallThick, wallThick], pos: [x, h / 2, z - d / 2] },
        { size: [w, h + wallThick, wallThick], pos: [x, h / 2, z + d / 2], door: true },
        { size: [wallThick, h + wallThick, d], pos: [x - w / 2, h / 2, z] },
        { size: [wallThick, h + wallThick, d], pos: [x + w / 2, h / 2, z] }
    ];
    wallConfigs.forEach(cfg => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(...cfg.size), material);
        wall.position.set(...cfg.pos);
        if (cfg.door) { wall.scale.x = 0.3; wall.position.x += w * 0.35; }
        wall.castShadow = true; wall.receiveShadow = true;
        scene.add(wall); obstacles.push(wall);
    });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w, wallThick, d), material);
    roof.position.set(x, h + wallThick / 2, z);
    roof.castShadow = true; roof.receiveShadow = true;
    scene.add(roof); obstacles.push(roof);
}

function createRamp(scene, startPos, length, height, width, material) {
    const steps = 20;
    const stepL = length / steps;
    const stepH = height / steps;
    for (let i = 0; i < steps; i++) {
        const stepMesh = new THREE.Mesh(
            new THREE.BoxGeometry(width, 0.4, stepL),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        stepMesh.position.set(
            startPos.x,
            startPos.y + (i + 0.5) * stepH,
            startPos.z - (i + 0.5) * stepL
        );
        scene.add(stepMesh);
        obstacles.push(stepMesh);
    }
    const angle = Math.atan2(height, length);
    const rampLen = Math.sqrt(length * length + height * height);
    const rampVis = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, rampLen), material);
    rampVis.position.set(startPos.x, startPos.y + height / 2, startPos.z - length / 2);
    rampVis.rotation.x = angle;
    rampVis.castShadow = true; rampVis.receiveShadow = true;
    scene.add(rampVis);
}

function getRandomSafePosition(playerPosition) {
    const range = 280;
    const minPlayerDistSq = CONFIG.MIN_SPAWN_DISTANCE * CONFIG.MIN_SPAWN_DISTANCE;
    const pos = new THREE.Vector3();
    let attempts = 0;
    while (attempts < 50) {
        pos.set((Math.random() - 0.5) * range, 1.5, (Math.random() - 0.5) * range);
        if (pos.distanceToSquared(playerPosition) > minPlayerDistSq) {
            pos.y = 0;
            return pos;
        }
        attempts++;
    }
    return pos;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateWorld — called every render frame
// ─────────────────────────────────────────────────────────────────────────────

export function updateWorld(game, dt) {
    const playerState = game.playerState;

    targets.forEach(target => {
        if (target.userData.isDead) {
            target.scale.lerp(_zeroVec, CONFIG.DEATH_ANIMATION_SPEED * dt);
            target.userData.respawnTimer -= dt;
            if (target.userData.respawnTimer <= 0) {
                const newPos = getRandomSafePosition(_tempVec.set(
                    playerState.position.x, playerState.position.y, playerState.position.z
                ));
                target.position.copy(newPos);
                target.userData.startPos = (target.userData.moveAxis === 'x') ? target.position.x : target.position.z;
                target.userData.isDead = false;
                target.userData.health = 100;
                target.userData.respawnTimer = 0;
                target.material.color.set(target.userData.originalColor);
                target.scale.setScalar(target.userData.baseScale);
            }
            return;
        }
        if (target.userData.hitTimer > 0) {
            target.userData.hitTimer -= dt;
            if (target.userData.hitTimer <= 0) target.material.color.set(target.userData.originalColor);
        }
        const ts = target.userData.baseScale;
        if (target.scale.x > ts) target.scale.setScalar(Math.max(ts, target.scale.x - 2 * dt));
        if (target.userData.isMoving) {
            const axis = target.userData.moveAxis;
            target.position[axis] += target.userData.moveSpeed * target.userData.moveDir * dt;
            if (Math.abs(target.position[axis] - target.userData.startPos) > target.userData.moveRange) {
                target.userData.moveDir *= -1;
            }
        }
    });

    updateTracers(game.scene, dt);
    updateGrenades(game, dt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Grenades
// ─────────────────────────────────────────────────────────────────────────────

export function spawnGrenade(pos, vel, game) {
    const geometry = new THREE.SphereGeometry(0.2, 8, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x550000 });
    const grenade = new THREE.Mesh(geometry, material);
    grenade.position.copy(pos);
    grenade.userData = { velocity: vel, fuse: CONFIG.WEAPONS.GRENADE.fuse, isGrenade: true };
    game.scene.add(grenade);
    game.worldGrenades.push(grenade);
}

function updateGrenades(game, dt) {
    for (let i = game.worldGrenades.length - 1; i >= 0; i--) {
        const g = game.worldGrenades[i];
        g.userData.velocity.y += CONFIG.GRENADE_GRAVITY * dt;
        g.position.addScaledVector(g.userData.velocity, dt);
        if (g.position.y < 0.2) {
            g.position.y = 0.2;
            g.userData.velocity.y *= -0.3;
            g.userData.velocity.x *= 0.5;
            g.userData.velocity.z *= 0.5;
        }
        g.userData.fuse -= dt;
        if (g.userData.fuse <= 0) {
            explode(g.position, game);
            game.scene.remove(g);
            game.worldGrenades.splice(i, 1);
        }
    }
}

function explode(pos, game) {
    const geometry = new THREE.SphereGeometry(CONFIG.WEAPONS.GRENADE.radius, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.6 });
    const explosion = new THREE.Mesh(geometry, material);
    explosion.position.copy(pos);
    game.scene.add(explosion);

    const light = new THREE.PointLight(0xff4400, 10, 20);
    light.position.copy(pos);
    game.scene.add(light);

    const distToPlayer = pos.distanceTo(game.playerState.position);
    if (distToPlayer < 20) {
        const intensity = (1.0 - distToPlayer / 20) * 2;
        game.playerState.cameraShake.x += (Math.random() - 0.5) * intensity;
        game.playerState.cameraShake.y += (Math.random() - 0.5) * intensity;
    }

    for (let i = 0; i < bots.length; i++) {
        const bot = bots[i];
        if (bot.userData.isDead) continue;
        const dist = bot.position.distanceTo(pos);
        if (dist < CONFIG.WEAPONS.GRENADE.radius) {
            bot.userData.health -= CONFIG.WEAPONS.GRENADE.damage;
            flashBot(bot, true);
            bot.userData.hitTimer = 0.2;
            if (bot.userData.health <= 0) _killBot(bot, game, "GRENADE KILL!");
        }
    }

    let t = 0;
    const interval = setInterval(() => {
        t += 0.05;
        explosion.scale.setScalar(2 + t * 4);
        explosion.material.opacity = 0.9 * (1 - t);
        light.intensity = 20 * (1 - t);
        if (t >= 1) {
            game.scene.remove(explosion);
            game.scene.remove(light);
            clearInterval(interval);
        }
    }, 16);
}

// Shared bot-kill helper — keeps kill logic DRY and updates the cached counter
function _killBot(bot, game, eventLabel) {
    bot.userData.isDead = true;
    bot.userData.respawnTimer = CONFIG.RESPAWN_DELAY;
    game.playerState.score += 1;
    game.addEvent(eventLabel || "BOT DOWN", "#ff4400");

    if (bot.userData.botType === 'SNIPER') _cachedSniperCount = Math.max(0, _cachedSniperCount - 1);

    bot.rotation.x = -Math.PI / 2;
    bot.position.y = 0.5;
    bot.traverse(c => {
        if (c.isMesh) { c.material.color.set(0x555555); c.material.emissive.set(0x000000); }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// updateBots — THROTTLED to BOT_AI_HZ (20 Hz)
// ─────────────────────────────────────────────────────────────────────────────

export function updateBots(game, dt, playerHitbox) {
    if (game.playerProfile && game.playerProfile.mode === 'pvp') return; 
    
    // Accumulate real time; skip if a full AI tick hasn't elapsed yet
    _botAiAccumulator += dt;
    if (_botAiAccumulator < BOT_AI_DT) return;
    const aiDt = _botAiAccumulator;   // use accumulated time so movement is still smooth
    _botAiAccumulator = 0;

    const { playerState, scene, remotePlayers } = game;

    // ── Build target list in-place (zero allocation) ──────────────────────────
    if (_allTargetPos.length === 0) {
        _allTargetPos.push({ pos: new THREE.Vector3(), id: 'local', isDead: false });
    }
    const localSlot = _allTargetPos[0];
    localSlot.pos.set(
        playerState.position.x,
        playerState.position.y - CONFIG.PLAYER_HEIGHT / 2,
        playerState.position.z
    );
    localSlot.isDead = !!playerState.isDead;

    const remoteValues = Object.values(remotePlayers);
    while (_allTargetPos.length < remoteValues.length + 1) {
        _allTargetPos.push({ pos: new THREE.Vector3(), id: '', isDead: false });
    }
    let targetCount = 1;
    for (let r = 0; r < remoteValues.length; r++) {
        const rp = remoteValues[r];
        const slot = _allTargetPos[targetCount++];
        slot.pos.copy(rp.mesh.position);
        slot.id = rp.id;
        slot.isDead = false;
    }

    // ── Rebuild ray-target list ONCE per AI tick ──────────────────────────────
    _botRayTargets.length = 0;
    for (let i = 0; i < obstacles.length; i++) _botRayTargets.push(obstacles[i]);
    for (let i = 0; i < playerHitboxes.length; i++) _botRayTargets.push(playerHitboxes[i]);
    if (playerHitbox) _botRayTargets.push(playerHitbox);

    // ── Sniper promotion (cached counter — no .filter()) ─────────────────────
    _cachedTargetSnipers = Math.floor(game.playerState.score / 5);
    if (_cachedSniperCount < _cachedTargetSnipers) {
        for (let i = 0; i < bots.length; i++) {
            const b = bots[i];
            if (b.userData.botType === 'GRUNT' && !b.userData.isDead) {
                b.userData.botType = 'SNIPER';
                _cachedSniperCount++;
                b.traverse(c => {
                    if (c.isMesh) {
                        c.material = c.material.clone();
                        if (c.userData.isHead) {
                            c.material.color.set(0xffff00); c.material.emissive.set(0xffff00); c.material.emissiveIntensity = 5.0;
                        } else {
                            c.material.color.set(0xcc00ff); c.material.emissive.set(0xcc00ff); c.material.emissiveIntensity = 5.0;
                        }
                    }
                });
                game.addEvent("SNIPER INBOUND!", "#cc00ff");
                break; // one promotion per tick
            }
        }
    }

    // ── Per-bot AI loop ───────────────────────────────────────────────────────
    for (let bi = 0; bi < bots.length; bi++) {
        const bot = bots[bi];

        // 1. Dead / respawn
        if (bot.userData.isDead) {
            bot.visible = false;
            if (bot.userData.laserLine) {
                scene.remove(bot.userData.laserLine);
                bot.userData.laserLine = null;
            }
            bot.userData.respawnTimer -= aiDt;
            if (bot.userData.respawnTimer <= 0) {
                // Demote to grunt if we have enough snipers
                if (bot.userData.botType === 'SNIPER' && _cachedSniperCount >= _cachedTargetSnipers) {
                    bot.userData.botType = 'GRUNT';
                    bot.traverse(c => {
                        if (c.isMesh && !c.userData.isHead) {
                            c.material = c.material.clone();
                            c.material.color.set(0xff4400); c.material.emissive.set(0xff4400); c.material.emissiveIntensity = 0.8;
                        }
                    });
                } else if (bot.userData.botType === 'SNIPER') {
                    _cachedSniperCount++; // re-entering the field
                }

                const newPos = getRandomSafePosition(_playerPos.set(
                    playerState.position.x, playerState.position.y, playerState.position.z
                ));
                bot.position.copy(newPos);
                bot.position.y = 0;
                bot.rotation.set(0, 0, 0);
                bot.scale.set(1, 1, 1);
                bot.visible = true;
                bot.userData.isDead = false;
                bot.userData.health = CONFIG.BOT_HEALTH;
                bot.userData.respawnTimer = 0;
                bot.userData.state = 'idle';
                bot.userData.reactionTimer = 1.5;
                bot.userData.isAiming = false;
                bot.userData.aimTimer = 0;
                bot.userData.shootCooldown = 2.0;
                flashBot(bot, false);
            }
            continue;
        }

        // 2. Hit flash recovery
        if (bot.userData.hitTimer > 0) {
            bot.userData.hitTimer -= aiDt;
            if (bot.userData.hitTimer <= 0) flashBot(bot, false);
        }

        // 3. Find closest target — plain for-loop, zero allocation
        const isSniper = bot.userData.botType === 'SNIPER';
        const detectRange = isSniper ? 120 : CONFIG.BOT_DETECTION_RANGE;
        let closestTarget = null;
        let minDist = Infinity;
        for (let t = 0; t < targetCount; t++) {
            const tgt = _allTargetPos[t];
            if (tgt.isDead) continue;
            const d = bot.position.distanceTo(tgt.pos);
            if (d < minDist) { minDist = d; closestTarget = tgt; }
        }

        const distToPlayer = closestTarget ? minDist : Infinity;
        const targetPos = closestTarget ? closestTarget.pos : null;

        // 4. State transitions
        if (bot.userData.state === 'idle' && distToPlayer < detectRange) {
            bot.userData.state = 'chasing';
            bot.userData.reactionTimer = CONFIG.BOT_REACTION_MIN +
                Math.random() * (CONFIG.BOT_REACTION_MAX - CONFIG.BOT_REACTION_MIN);
        } else if (bot.userData.state === 'chasing' && (distToPlayer > detectRange * 1.5 || !closestTarget)) {
            bot.userData.state = 'idle';
        }

        if (bot.userData.state !== 'chasing' || !targetPos) continue;

        // 5. Rotation
        _dirToPlayer.subVectors(targetPos, bot.position).normalize();
        const targetYaw = Math.atan2(_dirToPlayer.x, _dirToPlayer.z);
        bot.rotation.y = THREE.MathUtils.lerp(bot.rotation.y, targetYaw, CONFIG.BOT_ROTATION_SPEED * aiDt);

        // 6. Movement
        if (!bot.userData.isAiming) {
            if (distToPlayer > CONFIG.BOT_STOP_DISTANCE) {
                bot.position.addScaledVector(_dirToPlayer, CONFIG.BOT_SPEED * aiDt);
            } else {
                bot.userData.strafeTimer -= aiDt;
                if (bot.userData.strafeTimer <= 0) {
                    bot.userData.strafeDir *= -1;
                    bot.userData.strafeTimer = 1 + Math.random() * 2;
                }
                _strafeVec.set(-_dirToPlayer.z, 0, _dirToPlayer.x);
                bot.position.addScaledVector(_strafeVec, bot.userData.strafeDir * CONFIG.BOT_STRAFE_SPEED * aiDt);
            }
        }

        // 7. Obstacle push-out (cached AABB, plain for-loop)
        for (let oi = 0; oi < obstacles.length; oi++) {
            const box = obstacles[oi].userData.aabb;
            if (!box) continue;
            const bMinX = bot.position.x - 0.5, bMaxX = bot.position.x + 0.5;
            const bMinZ = bot.position.z - 0.5, bMaxZ = bot.position.z + 0.5;
            if (bMaxX > box.min.x && bMinX < box.max.x && bMaxZ > box.min.z && bMinZ < box.max.z) {
                const ox = Math.min(bMaxX, box.max.x) - Math.max(bMinX, box.min.x);
                const oz = Math.min(bMaxZ, box.max.z) - Math.max(bMinZ, box.min.z);
                if (ox < oz) {
                    bot.position.x += (ox + 0.1) * (bot.position.x > (box.min.x + box.max.x) / 2 ? 1 : -1);
                } else {
                    bot.position.z += (oz + 0.1) * (bot.position.z > (box.min.z + box.max.z) / 2 ? 1 : -1);
                }
            }
        }

        // 8. Reaction delay
        if (bot.userData.reactionTimer > 0) { bot.userData.reactionTimer -= aiDt; continue; }

        // 9. Aim / shoot
        const rayOrigin = bot.position.clone();
        rayOrigin.y += 0.5;

        if (bot.userData.shootCooldown <= 0 && !bot.userData.isAiming) {
            _botRaycaster.set(rayOrigin, _dirToPlayer);
            const hits = _botRaycaster.intersectObjects(obstacles, true);
            if (hits.length === 0 || hits[0].distance > distToPlayer) {
                bot.userData.isAiming = true;
                bot.userData.aimTimer = CONFIG.BOT_AIM_TIME;
            }
        }

        if (bot.userData.isAiming) {
            bot.userData.aimTimer -= aiDt;

            _botRaycaster.set(rayOrigin, _dirToPlayer);
            const losHits = _botRaycaster.intersectObjects(obstacles, true);
            const isBlocked = losHits.length > 0 && losHits[0].distance < distToPlayer;

            if (isBlocked) {
                bot.userData.isAiming = false;
                if (bot.userData.laserLine) { scene.remove(bot.userData.laserLine); bot.userData.laserLine = null; }
            } else {
                // Laser sight
                const endPoint = rayOrigin.clone().addScaledVector(_dirToPlayer, distToPlayer);
                const isSniperBot = bot.userData.botType === 'SNIPER';
                if (!bot.userData.laserLine) {
                    const geom = new THREE.BufferGeometry().setFromPoints([rayOrigin, endPoint]);
                    const mat = new THREE.LineBasicMaterial({
                        color: isSniperBot ? 0xff00ff : 0xff0000,
                        transparent: true,
                        opacity: isSniperBot ? 1.0 : 0.4,
                        linewidth: isSniperBot ? 5 : 1
                    });
                    bot.userData.laserLine = new THREE.Line(geom, mat);
                    scene.add(bot.userData.laserLine);
                } else {
                    bot.userData.laserLine.geometry.setFromPoints([rayOrigin, endPoint]);
                    bot.userData.laserLine.material.color.setHex(isSniperBot ? 0xff00ff : 0xff0000);
                    bot.userData.laserLine.material.opacity = isSniperBot ? 1.0 : 0.4;
                }

                // Fire
                if (bot.userData.aimTimer <= 0) {
                    const cfg = CONFIG.BOT_TYPES[bot.userData.botType];
                    const playerVel = game.playerState.velocity;
                    const playerSpeed = Math.sqrt(playerVel.x * playerVel.x + playerVel.z * playerVel.z);
                    const spread = (isSniperBot ? 0.001 : cfg.accuracy) + playerSpeed * CONFIG.BOT_EVASION_FACTOR;

                    const shotDir = _dirToPlayer.clone();
                    shotDir.x += (Math.random() - 0.5) * spread;
                    shotDir.y += (Math.random() - 0.5) * spread;
                    shotDir.z += (Math.random() - 0.5) * spread;
                    shotDir.normalize();

                    // Full raycast against pre-built list — zero allocation
                    _botRaycaster.set(rayOrigin, shotDir);
                    const allHits = _botRaycaster.intersectObjects(_botRayTargets, true);

                    let hitDist = Infinity;
                    if (allHits.length > 0) {
                        const firstHit = allHits[0];
                        hitDist = firstHit.distance;
                        if (firstHit.object === playerHitbox) {
                            game.takeDamage(cfg.damage);
                        } else if (firstHit.object.userData?.isRemotePlayer) {
                            const victimId = firstHit.object.userData.playerId;
                            if (victimId && game.emitRemoteDamage) game.emitRemoteDamage(victimId, cfg.damage);
                        }
                    }

                    const tracerEnd = rayOrigin.clone().addScaledVector(shotDir, Math.min(hitDist, distToPlayer + 5));
                    spawnTracer(rayOrigin, tracerEnd, scene, isSniperBot ? 0xff00ff : 0xffff00);

                    bot.userData.isAiming = false;
                    bot.userData.shootCooldown = cfg.fireRate + Math.random() * 2.0;
                    if (bot.userData.laserLine) { scene.remove(bot.userData.laserLine); bot.userData.laserLine = null; }
                }
            }
        } else {
            bot.userData.shootCooldown -= aiDt;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracers
// ─────────────────────────────────────────────────────────────────────────────

export function spawnTracer(start, end, scene, color = 0xffff00) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
        color, transparent: true,
        opacity: color === 0xff00ff ? 1.0 : 0.8
    });
    const line = new THREE.Line(geometry, material);
    line.userData = { life: CONFIG.TRACER_DURATION };
    scene.add(line);
    tracers.push(line);
}

export function updateTracers(scene, dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
        const tracer = tracers[i];
        tracer.userData.life -= dt;
        if (tracer.userData.life <= 0) {
            scene.remove(tracer);
            tracers.splice(i, 1);
        } else {
            tracer.material.opacity = (tracer.userData.life / CONFIG.TRACER_DURATION) * 0.8;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function flashBot(bot, isWhite) {
    bot.traverse(child => {
        if (child.isMesh) {
            if (isWhite) {
                if (child.userData.oldColor === undefined) child.userData.oldColor = child.material.color.getHex();
                child.material.color.set(0xffffff);
            } else if (child.userData.oldColor !== undefined) {
                child.material.color.set(child.userData.oldColor);
            }
        }
    });
}

export function syncBots(botStateData) {
    for (let i = 0; i < botStateData.length; i++) {
        const bd = botStateData[i];
        const bot = bots[bd.idx];
        if (!bot) continue;

        bot.position.set(bd.x, 0, bd.z);

        if (bd.dead && !bot.userData.isDead) {
            bot.rotation.set(-Math.PI / 2, bd.yaw, 0);
            bot.position.y = 0.5;
            bot.userData.isDead = true;
            bot.traverse(c => {
                if (c.isMesh) { c.material.color.set(0x555555); c.material.emissive.set(0x000000); }
            });
            if (bot.userData.laserLine) bot.userData.laserLine.visible = false;
        } else if (!bd.dead && bot.userData.isDead) {
            bot.rotation.set(0, bd.yaw, 0);
            bot.position.y = 0;
            bot.userData.isDead = false;
            const isSniper = bd.type === 'SNIPER';
            bot.traverse(c => {
                if (c.isMesh) {
                    if (c.userData.isHead) {
                        c.material.color.set(0xffff00); c.material.emissive.set(0xffff00);
                        c.material.emissiveIntensity = isSniper ? 5.0 : 0.5;
                    } else {
                        c.material.color.set(isSniper ? 0xcc00ff : 0xff4400);
                        c.material.emissive.set(isSniper ? 0xcc00ff : 0xff4400);
                        c.material.emissiveIntensity = isSniper ? 5.0 : 0.8;
                    }
                }
            });
        } else if (!bd.dead) {
            bot.rotation.set(0, bd.yaw, 0);
            bot.position.y = 0;
            if (bot.userData.botType !== bd.type) {
                bot.userData.botType = bd.type;
                const isSniper = bd.type === 'SNIPER';
                bot.traverse(c => {
                    if (c.isMesh) {
                        if (c.userData.isHead) {
                            c.material.color.set(0xffff00); c.material.emissive.set(0xffff00);
                            c.material.emissiveIntensity = isSniper ? 5.0 : 0.5;
                        } else {
                            c.material.color.set(isSniper ? 0xcc00ff : 0xff4400);
                            c.material.emissive.set(isSniper ? 0xcc00ff : 0xff4400);
                            c.material.emissiveIntensity = isSniper ? 5.0 : 0.8;
                        }
                    }
                });
            }
        }
    }
}

export function syncPickups(pickupData) {
    if (!pickupData) return;
    if (pickupData.healthKits) {
        for (let i = 0; i < pickupData.healthKits.length; i++) {
            if (healthKits[i]) healthKits[i].visible = pickupData.healthKits[i];
        }
    }
    if (pickupData.ammoBoxes) {
        for (let i = 0; i < pickupData.ammoBoxes.length; i++) {
            if (ammoBoxes[i]) ammoBoxes[i].visible = pickupData.ammoBoxes[i];
        }
    }
}