import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { targets, bots, spawnTracer } from './world.js';

const raycaster = new THREE.Raycaster();
const _camDir = new THREE.Vector3();
const _spreadDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

// CACHE DOM ELEMENT
const hitMarker = document.getElementById('hit-marker');

// REUSE LIGHT
let muzzleFlash = null;
let trajectoryLine = null;

export function initWeapon(scene, camera) {
    muzzleFlash = new THREE.PointLight(0xffaa00, 0, 5);
    muzzleFlash.visible = false;
    scene.add(muzzleFlash);

    // Trajectory Line for Grenades
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineDashedMaterial({ 
        color: 0xffaa00, 
        dashSize: 0.5, 
        gapSize: 0.3 
    });
    trajectoryLine = new THREE.Line(geometry, material);
    trajectoryLine.visible = false;
    scene.add(trajectoryLine);
}

export function updateWeapon(game, dt) {
    const { playerState, inputBuffer, weapon } = game;
    const currentWep = playerState.inventory[playerState.currentWeaponIndex];
    
    // 1. ADS (FOV Zoom)
    const isSniper = currentWep.name === 'Heavy Sniper';
    const targetFOV = (playerState.isADS && isSniper) ? 15 :
                      (playerState.isADS ? CONFIG.FOV_ADS : CONFIG.FOV_BASE);
    playerState.currentFOV += (targetFOV - playerState.currentFOV) * CONFIG.ADS_LERP_SPEED * dt;

    // Sniper Scope Overlay — works whenever holding Sniper + ADS
    const scope = document.getElementById('sniper-scope');
    const xhair = document.getElementById('crosshair');
    if (isSniper && playerState.isADS) {
        scope.classList.remove('hidden');  // Show scope
        xhair.style.opacity = '0';
    } else {
        scope.classList.add('hidden');     // Hide scope
        xhair.style.opacity = '1';
    }

    // 2. Reloading Logic
    if (playerState.isReloading) {
        playerState.reloadTimer -= dt;
        if (playerState.reloadTimer <= 0) {
            const needed = currentWep.magSize - currentWep.ammo;
            const transfer = Math.min(needed, currentWep.reserve);
            currentWep.ammo += transfer;
            if (currentWep.reserve !== Infinity) currentWep.reserve -= transfer;
            playerState.isReloading = false;
        }
    } else if (playerState.isReloadingRequested && currentWep.ammo < currentWep.magSize && currentWep.reserve > 0) {
        playerState.isReloading = true;
        playerState.reloadTimer = currentWep.reloadTime;
    }

    // 3. Grenade Aiming
    if (playerState.isAimingGrenade) {
        updateGrenadeTrajectory(game);
    } else if (trajectoryLine && trajectoryLine.visible) {
        throwGrenade(game);
        trajectoryLine.visible = false;
    }

    // 4. Fire Logic
    if (weapon.cooldown > 0) weapon.cooldown -= dt;

    if (playerState.isShooting && !playerState.isReloading) {
        if (currentWep.isAutomatic) {
            if (weapon.cooldown <= 0) handleShooting(game);
        } else {
            if (inputBuffer.shoot) handleShooting(game);
        }
    }
    
    // 5. Recoil Recovery
    const recoverySpeed = 5;
    playerState.recoilOffset.x *= (1.0 - recoverySpeed * dt);
    playerState.recoilOffset.y *= (1.0 - recoverySpeed * dt);

    // 6. Hit Marker Cooldown
    if (playerState.lastHitTime > 0) {
        playerState.lastHitTime -= dt;
        if (playerState.lastHitTime <= 0 && hitMarker) {
            hitMarker.classList.add('hidden');
            hitMarker.classList.remove('hit-animate');
        }
    }

    // 7. Fade Muzzle Flash
    if (muzzleFlash && muzzleFlash.visible) {
        muzzleFlash.intensity *= 0.6;
        if (muzzleFlash.intensity < 0.1) muzzleFlash.visible = false;
    }
}

export function handleShooting(game) {
    const { playerState, inputBuffer, weapon, camera } = game;
    const currentWep = playerState.inventory[playerState.currentWeaponIndex];
    
    if (playerState.isDead || playerState.isReloading) return;
    if (weapon.cooldown > 0) return;
    if (currentWep.ammo <= 0) {
        if (currentWep.reserve > 0 && !playerState.isReloading) {
            playerState.isReloading = true;
            playerState.reloadTimer = currentWep.reloadTime;
        }
        return;
    }

    weapon.cooldown = currentWep.fireRate;
    currentWep.ammo--;

    // PINPOINT WORLD DIRECTION
    camera.getWorldDirection(_camDir);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    // 1. Raycasting
    const shootables = [];
    bots.forEach(bot => {
        if (!bot.userData.isDead) shootables.push(...bot.children);
    });
    shootables.push(...targets);

    // Add Remote Players for PvP
    Object.values(game.remotePlayers).forEach(rp => {
        if (rp.mesh) shootables.push(rp.mesh);
    });

    const numPellets = currentWep.pellets || 1;
    let spread = currentWep.isADS ? 0 : (currentWep.spread || 0.02);

    for (let i = 0; i < numPellets; i++) {
        _spreadDir.copy(_camDir);
        
        // Apply spread 
        if (spread > 0) {
            const sx = (Math.random() - 0.5) * spread;
            const sy = (Math.random() - 0.5) * spread;
            _spreadDir.addScaledVector(_right, sx);
            _spreadDir.addScaledVector(_up, sy);
            _spreadDir.normalize();
        }

        // Offset origin to clear player body and immediate wall clipping
        const muzzlePos = camera.position.clone().addScaledVector(_camDir, 0.8);
        raycaster.set(muzzlePos, _spreadDir);
        
        const intersects = raycaster.intersectObjects(shootables, false);

        if (intersects.length > 0) {
            const hitObj = intersects[0].object;
            const bot = hitObj.userData.parentBot || hitObj;
            if (bot.userData.isDead) continue; // Safety guard for multi-part bots
            
            let damage = currentWep.damage;
            let isHeadshot = false;

            if (hitObj.userData.isHead) {
                damage = 999;
                isHeadshot = true;
            }

            bot.userData.health -= damage;

            // Flash White (Recursive for Group)
            flashBot(bot, true); 
            bot.userData.hitTimer = 0.1;
            
            // Handle Local Damage Response for Remote Players
            if (hitObj.userData.isRemotePlayer) {
                const victimId = hitObj.userData.playerId;
                import('./network.js').then(net => {
                    if (net.emitRemoteDamage) net.emitRemoteDamage(victimId, damage);
                });
            }

            if (bot.userData.health <= 0 && !hitObj.userData.isRemotePlayer) {
                bot.userData.isDead = true;
                bot.userData.respawnTimer = CONFIG.RESPAWN_DELAY;
                bot.userData.isAiming = false;
                bot.userData.aimTimer = 0;
                bot.userData.state = 'idle';
                
                bot.rotation.x = -Math.PI / 2;
                bot.position.y = 0.5;
                bot.traverse(c => { 
                    if(c.isMesh) { c.material.color.set(0x555555); c.material.emissive.set(0x000000); } 
                });

                playerState.score += 1;
                game.addEvent(isHeadshot ? "HEADSHOT KILL!" : "BOT KILLED", isHeadshot ? "#ffaa00" : "#0f4");

                // Remove laser line immediately
                if (bot.userData.laserLine) {
                    game.scene.remove(bot.userData.laserLine);
                    bot.userData.laserLine = null;
                }
            }

            if (playerState.lastHitTime <= 0) {
                hitMarker.classList.remove('hidden', 'hit-animate');
                void hitMarker.offsetWidth;
                hitMarker.classList.add('hit-animate');
                playerState.lastHitTime = CONFIG.HIT_COOLDOWN;
            }
        }

        // Tracer
        const dist = intersects.length > 0 ? intersects[0].distance : 100;
        const tracerStart = camera.position.clone();
        const tracerEnd = tracerStart.clone().addScaledVector(_spreadDir, dist);
        spawnTracer(tracerStart, tracerEnd, game.scene);

        // Network Tracer (Tell others to spawn this tracer)
        if (game.networkState.connected) {
            import('./network.js').then(net => {
                if (net.emitShoot) net.emitShoot(tracerStart, tracerEnd);
            });
        }
    }

    // 2. Feedback
    const recoilMod = (playerState.isCrouching ? 0.4 : 1.0) * (playerState.isADS ? 0.5 : 1.0);
    playerState.recoilOffset.y += currentWep.recoil * recoilMod;
    playerState.recoilOffset.x += (Math.random() - 0.5) * (currentWep.recoil * 0.5) * recoilMod;

    playerState.cameraShake.x += (Math.random() - 0.5) * currentWep.recoil * 2 * recoilMod;
    playerState.cameraShake.y += (Math.random() - 0.5) * currentWep.recoil * 2 * recoilMod;

    muzzleFlash.position.copy(camera.position);
    muzzleFlash.intensity = 3;
    muzzleFlash.visible = true;

    if (!currentWep.isAutomatic) inputBuffer.shoot = false;
}

function flashBot(bot, isWhite) {
    bot.traverse(child => {
        if (child.isMesh) {
            if (isWhite) {
                child.userData.oldColor = child.material.color.getHex();
                child.material.color.set(0xffffff);
            } else if (child.userData.oldColor !== undefined) {
                child.material.color.set(child.userData.oldColor);
            }
        }
    });
}

function updateGrenadeTrajectory(game) {
    if (!trajectoryLine) return;
    trajectoryLine.visible = true;

    const points = [];
    const p0 = game.camera.position.clone();
    const v0 = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion).multiplyScalar(CONFIG.WEAPONS.GRENADE.tossForce);
    const g = new THREE.Vector3(0, CONFIG.GRENADE_GRAVITY, 0);

    for (let i = 0; i < CONFIG.TRAJECTORY_POINTS; i++) {
        const t = i * 0.1;
        const p = p0.clone().addScaledVector(v0, t).addScaledVector(g, 0.5 * t * t);
        points.push(p);
    }

    trajectoryLine.geometry.setFromPoints(points);
    trajectoryLine.computeLineDistances();
}

function throwGrenade(game) {
    if (game.playerState.grenades <= 0) {
        game.addEvent("OUT OF GRENADES", "#f44");
        return;
    }
    game.playerState.grenades--;
    
    const p0 = game.camera.position.clone();
    const v0 = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion).multiplyScalar(CONFIG.WEAPONS.GRENADE.tossForce);
    
    import('./world.js').then(world => {
        world.spawnGrenade(p0, v0, game);
        game.addEvent("GRENADE AWAY!");
    });
}