import * as THREE from 'three';
import { CONFIG } from './Config.js';

export let targets = [];
export let bots = [];
export let obstacles = [];
export let tracers = [];
const _tempVec = new THREE.Vector3();
const _zeroVec = new THREE.Vector3(0, 0, 0);
const _botRaycaster = new THREE.Raycaster();
const _playerPos = new THREE.Vector3();

export function initWorld(scene) {
    // 1. Lighting
    const ambient = new THREE.AmbientLight(0x404040); 
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(10, 20, 10);
    directional.castShadow = true;
    scene.add(directional);

    // 2. Ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 3. Boundary Walls
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const wallHeight = 10;

    const wallGeoms = [
        { size: [100, wallHeight, 1], pos: [0, wallHeight / 2, -50] }, // Back
        { size: [100, wallHeight, 1], pos: [0, wallHeight / 2, 50] },  // Front
        { size: [1, wallHeight, 100], pos: [-50, wallHeight / 2, 0] }, // Left
        { size: [1, wallHeight, 100], pos: [50, wallHeight / 2, 0] }   // Right
    ];

    wallGeoms.forEach(cfg => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(...cfg.size), wallMaterial);
        wall.position.set(...cfg.pos);
        scene.add(wall);
        obstacles.push(wall);
    });

    // 4. Platforms & Covers
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const platformConfigs = [
        { size: [10, 2, 10], pos: [15, 1, 15] },
        { size: [8, 4, 8], pos: [-20, 2, -20] },
        { size: [12, 1, 6], pos: [0, 0.5, -30] },
        { size: [5, 3, 5], pos: [30, 1.5, -10] }
    ];

    platformConfigs.forEach(cfg => {
        const platform = new THREE.Mesh(new THREE.BoxGeometry(...cfg.size), platformMaterial);
        platform.position.set(...cfg.pos);
        scene.add(platform);
        obstacles.push(platform);
    });

    // 5. Moving Targets (Removed)
    targets = []; // Ensure empty

    // 6. Bots (Cylinders)
    for (let i = 0; i < CONFIG.BOT_COUNT; i++) {
        const geometry = new THREE.CylinderGeometry(CONFIG.BOT_RADIUS, CONFIG.BOT_RADIUS, CONFIG.BOT_HEIGHT, 16);
        const material = new THREE.MeshStandardMaterial({ color: 0xff4400 });
        const bot = new THREE.Mesh(geometry, material);

        const spawnPos = getRandomSafePosition(new THREE.Vector3(0, 0, 10)); 
        bot.position.copy(spawnPos);
        bot.position.y = CONFIG.BOT_HEIGHT / 2; // Sit on ground

        bot.userData = {
            isBot: true,
            originalColor: 0xff4400,
            baseScale: 1,
            health: CONFIG.BOT_HEALTH,
            isDead: false,
            respawnTimer: 0,
            hitTimer: 0,
            state: 'idle', 
            shootCooldown: 0,
            reactionTimer: 0,
            isAiming: false,
            aimTimer: 0,
            laserLine: null,
            strafeDir: Math.random() > 0.5 ? 1 : -1,
            strafeTimer: 0
        };

        scene.add(bot);
        bots.push(bot);
    }
}

function getRandomSafePosition(playerPosition) {
    const range = 40;
    const minDistanceSq = CONFIG.MIN_SPAWN_DISTANCE * CONFIG.MIN_SPAWN_DISTANCE;
    let pos = new THREE.Vector3();
    let attempts = 0;

    while (attempts < 10) {
        pos.set(
            (Math.random() - 0.5) * range,
            Math.random() * 5 + 1,
            (Math.random() - 0.5) * range
        );

        if (pos.distanceToSquared(playerPosition) > minDistanceSq) {
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

    // 4. Update Tracers
    updateTracers(game.scene, dt);
}

const _dirToPlayer = new THREE.Vector3();
const _strafeVec = new THREE.Vector3();

export function updateBots(game, dt, playerHitbox) {
    const { playerState, scene } = game;
    _playerPos.set(playerState.position.x, playerState.position.y - CONFIG.PLAYER_HEIGHT / 2, playerState.position.z);

    bots.forEach(bot => {
        // 1. Death & Respawn Logic
        if (bot.userData.isDead) {
            bot.scale.lerp(_zeroVec, CONFIG.DEATH_ANIMATION_SPEED * dt);
            bot.userData.respawnTimer -= dt;
            if (bot.userData.respawnTimer <= 0) {
                const newPos = getRandomSafePosition(_playerPos);
                bot.position.copy(newPos);
                bot.position.y = CONFIG.BOT_HEIGHT / 2;
                bot.userData.isDead = false;
                bot.userData.health = CONFIG.BOT_HEALTH;
                bot.userData.respawnTimer = 0;
                bot.material.color.set(bot.userData.originalColor);
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
                bot.material.color.set(bot.userData.originalColor);
            }
        }
        if (bot.scale.x > bot.userData.baseScale) {
            bot.scale.setScalar(Math.max(bot.userData.baseScale, bot.scale.x - 2 * dt));
        }

        // 3. AI Behavior
        const distToPlayer = bot.position.distanceTo(_playerPos);

        // State Transition & Reaction Timing
        if (bot.userData.state === 'idle' && distToPlayer < CONFIG.BOT_DETECTION_RANGE) {
            bot.userData.state = 'chasing';
            // Set a random reaction time before firing the first shot
            bot.userData.reactionTimer = CONFIG.BOT_REACTION_MIN + Math.random() * (CONFIG.BOT_REACTION_MAX - CONFIG.BOT_REACTION_MIN);
        } else if (bot.userData.state === 'chasing' && distToPlayer > CONFIG.BOT_DETECTION_RANGE * 1.5) {
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
                    if (!bot.userData.laserLine) {
                        const geom = new THREE.BufferGeometry().setFromPoints([rayOrigin, endPoint]);
                        const mat = new THREE.LineBasicMaterial({ color: CONFIG.LASER_COLOR, transparent: true, opacity: 0.3 });
                        bot.userData.laserLine = new THREE.Line(geom, mat);
                        scene.add(bot.userData.laserLine);
                    } else {
                        bot.userData.laserLine.geometry.setFromPoints([rayOrigin, endPoint]);
                    }

                    // FIRE!
                    if (bot.userData.aimTimer <= 0) {
                        // 1. Calculate Spread Direction
                        const spread = CONFIG.BOT_AIM_SPREAD;
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
                                game.takeDamage(CONFIG.BOT_DAMAGE);
                            }
                        }
                        
                        // 3. Spawn Visual Tracer (Matched to Raycast)
                        const tracerEnd = rayOrigin.clone().addScaledVector(shotDir, Math.min(hitDist, distToPlayer+5));
                        spawnTracer(rayOrigin, tracerEnd, scene);
                        
                        // Cleanup
                        bot.userData.isAiming = false;
                        bot.userData.shootCooldown = CONFIG.BOT_SHOOT_INTERVAL + (Math.random() * 1.0);
                        if (bot.userData.laserLine) {
                            scene.remove(bot.userData.laserLine);
                            bot.userData.laserLine = null;
                        }
                        
                        // Shot feedback
                        bot.material.emissive.set(0xff0000);
                        setTimeout(() => { if(bot.material) bot.material.emissive.set(0x000000); }, 100);
                    }
                }
            } else {
                bot.userData.shootCooldown -= dt;
            }
        }
    });
}

export function spawnTracer(start, end, scene) {
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ 
        color: CONFIG.TRACER_COLOR, 
        transparent: true, 
        opacity: 0.8 
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
