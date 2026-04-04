import * as THREE from 'three';
import { CONFIG } from './Config.js';

export let targets = [];
export let bots = [];
export let obstacles = [];
export let tracers = [];
export let mapStructure = []; // For Minimap Floorplans
const _tempVec = new THREE.Vector3();
const _zeroVec = new THREE.Vector3(0, 0, 0);
const _botRaycaster = new THREE.Raycaster();
const _playerPos = new THREE.Vector3();

export function initWorld(scene, game) {
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
        { size: [300, wallHeight, 1], pos: [0, wallHeight / 2, -150] }, // Back
        { size: [300, wallHeight, 1], pos: [0, wallHeight / 2, 150] },  // Front
        { size: [1, wallHeight, 300], pos: [-150, wallHeight / 2, 0] }, // Left
        { size: [1, wallHeight, 300], pos: [150, wallHeight / 2, 0] }   // Right
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
        { size: [40, 1.5, 20], pos: [0, 5, -50] }, // Large 2nd floor balcony
        { size: [8, 4, 8], pos: [35, 2, -15] },
        // Tactical Pillars
        { size: [2, 10, 2], pos: [10, 5, 10], mat: accentMaterial },
        { size: [2, 10, 2], pos: [-10, 5, 10], mat: accentMaterial },
        { size: [2, 10, 2], pos: [10, 5, -10], mat: accentMaterial },
        { size: [2, 10, 2], pos: [-10, 5, -10], mat: accentMaterial },
        { size: [2, 10, 2], pos: [40, 5, 40], mat: accentMaterial },
        { size: [2, 10, 2], pos: [-40, 5, -40], mat: accentMaterial },
        { size: [2, 10, 2], pos: [40, 5, -40], mat: accentMaterial },
        { size: [2, 10, 2], pos: [-40, 5, 40], mat: accentMaterial },
        // Crate Stacks
        { size: [4, 4, 4], pos: [0, 2, -25] },
        { size: [3, 6, 3], pos: [-30, 3, 5] },
        { size: [5, 2, 5], pos: [-5, 1, 0] },
        // Extra Obstacles for CQB
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
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add(wall);
        obstacles.push(wall);
    });

    // 4.5. Tactical Complexes (Architected Symmetrically)
    const complexSize = 25;
    const outpostPositions = [
        { x: 80, z: 80 }, { x: -80, z: 80 },
        { x: 80, z: -80 }, { x: -80, z: -80 }
    ];

    outpostPositions.forEach(pos => {
        // Base structure
        createBuilding(scene, pos.x, pos.z, complexSize, complexSize, 8, platformMaterial);
        mapStructure.push({ x: pos.x, z: pos.z, w: complexSize, d: complexSize });
        
        // High-speed ramps instead of stairs
        const rampStart = new THREE.Vector3(pos.x, 0, pos.z + complexSize/2 + 20);
        createRamp(scene, rampStart, 20, 8, 12, platformMaterial);
    });

    // 6. Bots (Diversified Types)
    for (let i = 0; i < CONFIG.BOT_COUNT; i++) {
        const botGroup = new THREE.Group();
        const isSniper = Math.random() < CONFIG.BOT_TYPES.SNIPER.probability;
        const botType = isSniper ? 'SNIPER' : 'GRUNT';
        const config = CONFIG.BOT_TYPES[botType];
        
        const bHeight = isSniper ? 3.0 : CONFIG.BOT_HEIGHT;
        const bRadius = isSniper ? 0.9 : CONFIG.BOT_RADIUS;

        // Body
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

        // Head
        const headGeom = new THREE.SphereGeometry(isSniper ? 0.5 : 0.4, 16, 16);
        headGeom.translate(0, bHeight - 0.2, 0);
        const headMat = new THREE.MeshStandardMaterial({ 
            color: 0xffff00, 
            emissive: 0xffff00, 
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
            isBot: true,
            botType: botType,
            health: CONFIG.BOT_HEALTH,
            isDead: false,
            respawnTimer: 0,
            hitTimer: 0,
            shootCooldown: Math.random() * config.fireRate,
            strafeTimer: 0,
            strafeDir: 1,
            state: 'idle',
            reactionTimer: 0,
            isAiming: false,
            aimTimer: 0,
            laserLine: null
        };

        scene.add(botGroup);
        bots.push(botGroup);
    }

    // 7. Pickups
    initPickups(scene, game);

    // 8. Cache AABBs for performance
    obstacles.forEach(obs => {
        obs.userData.aabb = new THREE.Box3().setFromObject(obs);
    });
}

function initPickups(scene, game) {
    const healthGeom = new THREE.BoxGeometry(1, 1, 1);
    const ammoGeom = new THREE.BoxGeometry(1.2, 0.6, 1.2);
    
    const healthMat = new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 0.5 });
    const ammoMat = new THREE.MeshStandardMaterial({ color: 0x0044ff, emissive: 0x0044ff, emissiveIntensity: 0.5 });

    for (let i = 0; i < CONFIG.PICKUP_SPAWN_COUNT; i++) {
        // Health
        const h = new THREE.Mesh(healthGeom, healthMat);
        const posH = getRandomSafePosition(new THREE.Vector3(0,0,0));
        h.position.set(posH.x, 0.5, posH.z);
        h.userData = { type: 'health', respawnTimer: 0 };
        scene.add(h); game.pickups.push(h);

        // Ammo
        const a = new THREE.Mesh(ammoGeom, ammoMat);
        const posA = getRandomSafePosition(new THREE.Vector3(0,0,0));
        a.position.set(posA.x, 0.3, posA.z);
        a.userData = { type: 'ammo', respawnTimer: 0 };
        scene.add(a); game.pickups.push(a);
    }
}

function createBuilding(scene, x, z, w, d, h, material) {
    const wallThick = 2.0; 
    const wallConfigs = [
        { size: [w, h + wallThick, wallThick], pos: [x, h/2, z - d/2] }, 
        { size: [w, h + wallThick, wallThick], pos: [x, h/2, z + d/2], door: true }, 
        { size: [wallThick, h + wallThick, d], pos: [x - w/2, h/2, z] }, 
        { size: [wallThick, h + wallThick, d], pos: [x + w/2, h/2, z] }  
    ];

    wallConfigs.forEach(cfg => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(...cfg.size), material);
        wall.position.set(...cfg.pos);
        if (cfg.door) {
            wall.scale.x = 0.3;
            wall.position.x += w * 0.35;
        }
        wall.castShadow = true; wall.receiveShadow = true;
        scene.add(wall); obstacles.push(wall);
    });

    // Solid Roof Platform
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w, wallThick, d), material);
    roof.position.set(x, h + wallThick/2, z);
    roof.castShadow = true; roof.receiveShadow = true;
    scene.add(roof); obstacles.push(roof);
}

function createRamp(scene, startPos, length, height, width, material) {
    const angle = Math.atan2(height, length);
    const rampLen = Math.sqrt(length * length + height * height);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(width, 0.2, rampLen), material);
    
    // Position at midpoint and rotate
    ramp.position.set(startPos.x, startPos.y + height/2, startPos.z - length/2);
    ramp.rotation.x = angle;
    
    ramp.castShadow = true; ramp.receiveShadow = true;
    scene.add(ramp); obstacles.push(ramp);
}

function getRandomSafePosition(playerPosition) {
    const range = 280; // 300m map
    const minPlayerDistSq = CONFIG.MIN_SPAWN_DISTANCE * CONFIG.MIN_SPAWN_DISTANCE;
    let pos = new THREE.Vector3();
    let attempts = 0;
    while (attempts < 50) {
        pos.set((Math.random() - 0.5) * range, 1.5, (Math.random() - 0.5) * range);
        if (pos.distanceToSquared(playerPosition) > minPlayerDistSq) {
            pos.y = 0; // Snap to ground to avoid floating
            return pos;
        }
        attempts++;
    }
    return pos;
}

export function updateWorld(game, dt) {
    const playerState = game.playerState;

    targets.forEach(target => {
        // 1. Death & Respawn Logic
        if (target.userData.isDead) {
            target.scale.lerp(_zeroVec, CONFIG.DEATH_ANIMATION_SPEED * dt);
            
            target.userData.respawnTimer -= dt;
            if (target.userData.respawnTimer <= 0) {
                const newPos = getRandomSafePosition(_tempVec.set(
                    playerState.position.x,
                    playerState.position.y,
                    playerState.position.z
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

        // 2. Feedback Recovery 
        if (target.userData.hitTimer > 0) {
            target.userData.hitTimer -= dt;
            if (target.userData.hitTimer <= 0) {
                target.material.color.set(target.userData.originalColor);
            }
        }
        
        const targetScale = target.userData.baseScale;
        if (target.scale.x > targetScale) {
            const newScale = Math.max(targetScale, target.scale.x - 2 * dt);
            target.scale.setScalar(newScale);
        }

        // 3. Linear Movement
        if (target.userData.isMoving) {
            const axis = target.userData.moveAxis;
            const startPos = target.userData.startPos;
            const range = target.userData.moveRange;
            
            target.position[axis] += target.userData.moveSpeed * target.userData.moveDir * dt;
            
            if (Math.abs(target.position[axis] - startPos) > range) {
                target.userData.moveDir *= -1;
            }
        }
    });

    // 4. Update Tracers & Grenades
    updateTracers(game.scene, dt);
    updateGrenades(game, dt);
}

export function spawnGrenade(pos, vel, game) {
    const geometry = new THREE.SphereGeometry(0.2, 8, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x550000 });
    const grenade = new THREE.Mesh(geometry, material);
    
    grenade.position.copy(pos);
    grenade.userData = {
        velocity: vel,
        fuse: CONFIG.WEAPONS.GRENADE.fuse,
        isGrenade: true
    };
    
    game.scene.add(grenade);
    game.worldGrenades.push(grenade);
}

function updateGrenades(game, dt) {
    for (let i = game.worldGrenades.length - 1; i >= 0; i--) {
        const g = game.worldGrenades[i];
        
        // Physics
        g.userData.velocity.y += CONFIG.GRENADE_GRAVITY * dt;
        g.position.addScaledVector(g.userData.velocity, dt);

        // Ground Collision (Simple)
        if (g.position.y < 0.2) {
            g.position.y = 0.2;
            g.userData.velocity.y *= -0.3; // Bounce
            g.userData.velocity.x *= 0.5;
            g.userData.velocity.z *= 0.5;
        }

        // Fuse
        g.userData.fuse -= dt;
        if (g.userData.fuse <= 0) {
            explode(g.position, game);
            game.scene.remove(g);
            game.worldGrenades.splice(i, 1);
        }
    }
}

function explode(pos, game) {
    // 1. Visual Effect
    const geometry = new THREE.SphereGeometry(CONFIG.WEAPONS.GRENADE.radius, 16, 16);
    const material = new THREE.MeshBasicMaterial({ 
        color: 0xff4400, 
        transparent: true, 
        opacity: 0.6 
    });
    const explosion = new THREE.Mesh(geometry, material);
    explosion.position.copy(pos);
    game.scene.add(explosion);

    // Flash light
    const light = new THREE.PointLight(0xff4400, 10, 20);
    light.position.copy(pos);
    game.scene.add(light);

    // Screen Shake
    const distToPlayer = pos.distanceTo(game.playerState.position);
    if (distToPlayer < 20) {
        const intensity = (1.0 - distToPlayer / 20) * 2;
        game.playerState.cameraShake.x += (Math.random() - 0.5) * intensity;
        game.playerState.cameraShake.y += (Math.random() - 0.5) * intensity;
    }

    // 2. Damage Logic
    bots.forEach(bot => {
        if (bot.userData.isDead) return;
        const dist = bot.position.distanceTo(pos);
        if (dist < CONFIG.WEAPONS.GRENADE.radius) {
            bot.userData.health -= CONFIG.WEAPONS.GRENADE.damage;
            flashBot(bot, true);
            bot.userData.hitTimer = 0.2;
            
            if (bot.userData.health <= 0) {
                bot.userData.isDead = true;
                bot.userData.respawnTimer = CONFIG.RESPAWN_DELAY;
                game.playerState.score += 1;
                game.addEvent("GRENADE KILL!", "#ff4400");
                
                // Fall Over animation
                bot.rotation.x = -Math.PI / 2;
                bot.position.y = 0.5;
            }
        }
    });

    // Fade out effect
    let t = 0;
    const interval = setInterval(() => {
        t += 0.05;
        explosion.scale.setScalar(2 + t * 4); // Bigger blast
        explosion.material.opacity = 0.9 * (1 - t);
        light.intensity = 20 * (1 - t);
        if (t >= 1) {
            game.scene.remove(explosion);
            game.scene.remove(light);
            clearInterval(interval);
        }
    }, 16);
}

const _dirToPlayer = new THREE.Vector3();
const _strafeVec = new THREE.Vector3();

export function updateBots(game, dt, playerHitbox) {
    const { playerState, scene } = game;
    _playerPos.set(playerState.position.x, playerState.position.y - CONFIG.PLAYER_HEIGHT / 2, playerState.position.z);

    // Sniper Promotion Logic (Every 5 kills)
    const sniperCount = bots.filter(b => b.userData.botType === 'SNIPER' && !b.userData.isDead).length;
    const targetSnipers = Math.floor(game.playerState.score / 5);
    
    if (sniperCount < targetSnipers) {
        const eligible = bots.filter(b => b.userData.botType === 'GRUNT' && !b.userData.isDead);
        if (eligible.length > 0) {
            const bot = eligible[Math.floor(Math.random() * eligible.length)];
            bot.userData.botType = 'SNIPER';
            bot.traverse(c => { if(c.isMesh && !c.userData.isHead) c.material.color.set(0xcc00ff); });
            game.addEvent("SNIPER INBOUND!", "#cc00ff");
        }
    }

    bots.forEach(bot => {
        // 1. Death & Respawn Logic
        if (bot.userData.isDead) {
            bot.userData.respawnTimer -= dt;
            if (bot.userData.respawnTimer <= 0) {
                // When respawning, reset to Grunt if we have too many snipers
                if (sniperCount >= targetSnipers) {
                   bot.userData.botType = 'GRUNT';
                   bot.traverse(c => { if(c.isMesh && !c.userData.isHead) c.material.color.set(0xff4400); });
                }
                const newPos = getRandomSafePosition(_playerPos);
                bot.position.copy(newPos);
                bot.position.y = 0; 
                bot.rotation.x = 0; // Stand Up
                bot.userData.isDead = false;
                bot.userData.health = CONFIG.BOT_HEALTH;
                bot.userData.respawnTimer = 0;
                flashBot(bot, false); // Reset color
                bot.scale.setScalar(bot.userData.baseScale);
                bot.userData.state = 'idle';
                bot.userData.reactionTimer = 0;
                bot.userData.isAiming = false;
                if (bot.userData.laserLine) {
                    scene.remove(bot.userData.laserLine);
                    bot.userData.laserLine = null;
                }
            }
            return;
        }

        // 2. Feedback Recovery
        if (bot.userData.hitTimer > 0) {
            bot.userData.hitTimer -= dt;
            if (bot.userData.hitTimer <= 0) {
                flashBot(bot, false);
            }
        }
        if (bot.scale.x > bot.userData.baseScale) {
            bot.scale.setScalar(Math.max(bot.userData.baseScale, bot.scale.x - 2 * dt));
        }

        // 3. AI Behavior
        const isSniper = bot.userData.botType === 'SNIPER';
        const detectRange = isSniper ? 120 : CONFIG.BOT_DETECTION_RANGE;
        const distToPlayer = bot.position.distanceTo(_playerPos);

        // State Transition & Reaction Timing
        if (bot.userData.state === 'idle' && distToPlayer < detectRange) {
            bot.userData.state = 'chasing';
            bot.userData.reactionTimer = CONFIG.BOT_REACTION_MIN + Math.random() * (CONFIG.BOT_REACTION_MAX - CONFIG.BOT_REACTION_MIN);
        } else if (bot.userData.state === 'chasing' && distToPlayer > detectRange * 1.5) {
            bot.userData.state = 'idle';
            bot.userData.reactionTimer = 0;
        }

        if (bot.userData.state === 'chasing') {
            // A. Smooth Rotation (Now in 3D)
            _dirToPlayer.subVectors(_playerPos, bot.position).normalize();
            
            // For a cylinder, lookAt might be tricky. Let's just rotate Y for the body
            // but use the full 3D direction for the raycast/laser.
            const targetYaw = Math.atan2(_dirToPlayer.x, _dirToPlayer.z);
            bot.rotation.y = THREE.MathUtils.lerp(bot.rotation.y, targetYaw, CONFIG.BOT_ROTATION_SPEED * dt);

            // B. Movement & Strafing (Only if not aiming)
            if (!bot.userData.isAiming) {
                if (distToPlayer > CONFIG.BOT_STOP_DISTANCE) {
                    bot.position.addScaledVector(_dirToPlayer, CONFIG.BOT_SPEED * dt);
                } else {
                    bot.userData.strafeTimer -= dt;
                    if (bot.userData.strafeTimer <= 0) {
                        bot.userData.strafeDir *= -1;
                        bot.userData.strafeTimer = 1 + Math.random() * 2;
                    }
                    _strafeVec.set(-_dirToPlayer.z, 0, _dirToPlayer.x);
                    bot.position.addScaledVector(_strafeVec, bot.userData.strafeDir * CONFIG.BOT_STRAFE_SPEED * dt);
                }
            }

            // BOT COLLISION CHECK
            obstacles.forEach(obs => {
                const box = obs.userData.aabb;
                if (!box) return;
                
                // Simple radius-based check for bots
                const botMinX = bot.position.x - 0.5;
                const botMaxX = bot.position.x + 0.5;
                const botMinZ = bot.position.z - 0.5;
                const botMaxZ = bot.position.z + 0.5;

                if (botMaxX > box.min.x && botMinX < box.max.x &&
                    botMaxZ > box.min.z && botMinZ < box.max.z) {
                    // Overlap detected. Push out.
                    const overlapX = Math.min(botMaxX, box.max.x) - Math.max(botMinX, box.min.x);
                    const overlapZ = Math.min(botMaxZ, box.max.z) - Math.max(botMinZ, box.min.z);

                    if (overlapX < overlapZ) {
                        const dir = bot.position.x > (box.min.x + box.max.x) / 2 ? 1 : -1;
                        bot.position.x += (overlapX + 0.1) * dir;
                    } else {
                        const dir = bot.position.z > (box.min.z + box.max.z) / 2 ? 1 : -1;
                        bot.position.z += (overlapZ + 0.1) * dir;
                    }
                }
            });

            // C. Shooting with LoS Check & Reaction Delay
            if (bot.userData.reactionTimer > 0) {
                bot.userData.reactionTimer -= dt;
                return;
            }

            // D. Aiming Mode
            const rayOrigin = bot.position.clone();
            rayOrigin.y += 0.5; // Chest height
            
            // Trigger Aiming
            if (bot.userData.shootCooldown <= 0 && !bot.userData.isAiming) {
                // Initial LoS check before aiming
                _botRaycaster.set(rayOrigin, _dirToPlayer);
                const intersections = _botRaycaster.intersectObjects(obstacles, true);
                if (intersections.length === 0 || intersections[0].distance > distToPlayer) {
                    bot.userData.isAiming = true;
                    bot.userData.aimTimer = CONFIG.BOT_AIM_TIME;
                }
            }

            if (bot.userData.isAiming) {
                bot.userData.aimTimer -= dt;
                
                // LoS check during aiming
                _botRaycaster.set(rayOrigin, _dirToPlayer);
                const intersections = _botRaycaster.intersectObjects(obstacles, true);
                const isBlocked = intersections.length > 0 && intersections[0].distance < distToPlayer;

                if (isBlocked) {
                    // Cancel aim if player takes cover
                    bot.userData.isAiming = false;
                    if (bot.userData.laserLine) {
                        scene.remove(bot.userData.laserLine);
                        bot.userData.laserLine = null;
                    }
                } else {
                    // Update/Create Laser Sight
                    const endPoint = rayOrigin.clone().addScaledVector(_dirToPlayer, distToPlayer);
                    const isSniper = bot.userData.botType === 'SNIPER';
                    if (!bot.userData.laserLine) {
                        const geom = new THREE.BufferGeometry().setFromPoints([rayOrigin, endPoint]);
                        const mat = new THREE.LineBasicMaterial({ 
                            color: isSniper ? 0xff00ff : 0xff0000, 
                            transparent: true, 
                            opacity: isSniper ? 1.0 : 0.4,
                            linewidth: isSniper ? 5 : 1
                        });
                        bot.userData.laserLine = new THREE.Line(geom, mat);
                        scene.add(bot.userData.laserLine);
                    } else {
                        bot.userData.laserLine.geometry.setFromPoints([rayOrigin, endPoint]);
                        bot.userData.laserLine.material.color.setHex(isSniper ? 0xff00ff : 0xff0000);
                        bot.userData.laserLine.material.opacity = isSniper ? 1.0 : 0.4;
                    }

                    // FIRE!
                    if (bot.userData.aimTimer <= 0) {
                        const config = CONFIG.BOT_TYPES[bot.userData.botType];
                        // 1. Calculate Spread with Evasion Factor
                        const playerVel = game.playerState.velocity;
                        const playerSpeed = Math.sqrt(playerVel.x * playerVel.x + playerVel.z * playerVel.z);
                        const evasionSpread = playerSpeed * CONFIG.BOT_EVASION_FACTOR;
                        
                        const spread = (isSniper ? 0.001 : config.accuracy) + evasionSpread;
                        const shotDir = _dirToPlayer.clone();
                        shotDir.x += (Math.random() - 0.5) * spread;
                        shotDir.y += (Math.random() - 0.5) * spread;
                        shotDir.z += (Math.random() - 0.5) * spread;
                        shotDir.normalize();

                        // 2. Real Raycast for Hit Detection
                        _botRaycaster.set(rayOrigin, shotDir);
                        const allIntersections = _botRaycaster.intersectObjects([...obstacles, playerHitbox], true);
                        
                        let hitDist = Infinity;
                        if (allIntersections.length > 0) {
                            const firstHit = allIntersections[0];
                            hitDist = firstHit.distance;

                            if (firstHit.object === playerHitbox) {
                                game.takeDamage(config.damage);
                            }
                        }
                        
                        // 3. Spawn Visual Tracer (Matched to Raycast)
                        const tracerEnd = rayOrigin.clone().addScaledVector(shotDir, Math.min(hitDist, distToPlayer+5));
                        spawnTracer(rayOrigin, tracerEnd, scene, bot.userData.botType === 'SNIPER' ? 0xff00ff : 0xffff00);

                        // Cleanup
                        bot.userData.isAiming = false;
                        bot.userData.shootCooldown = config.fireRate + (Math.random() * 2.0);
                        if (bot.userData.laserLine) {
                            scene.remove(bot.userData.laserLine);
                            bot.userData.laserLine = null;
                        }
                    }
                }
            } else {
                bot.userData.shootCooldown -= dt;
            }
        }
    });
}

export function spawnTracer(start, end, scene, color = 0xffff00) {
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ 
        color: color, 
        transparent: true, 
        opacity: color === 0xff00ff ? 1.0 : 0.8 
    });
    const line = new THREE.Line(geometry, material);
    
    line.userData = {
        life: CONFIG.TRACER_DURATION
    };
    
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
            // Fade out
            tracer.material.opacity = (tracer.userData.life / CONFIG.TRACER_DURATION) * 0.8;
        }
    }
}
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
