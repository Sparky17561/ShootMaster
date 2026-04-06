import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { targets, bots, spawnTracer } from './world.js';

const raycaster = new THREE.Raycaster();
const _camDir = new THREE.Vector3();
const _spreadDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

const hitMarker = document.getElementById('hit-marker');

let muzzleFlash = null;
let trajectoryLine = null;
let wasAimingGrenade = false;

export function initWeapon(scene, camera) {
    muzzleFlash = new THREE.PointLight(0xffaa00, 0, 5);
    muzzleFlash.visible = false;
    scene.add(muzzleFlash);

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

    // ADS
    const isSniper = currentWep.name === 'Heavy Sniper';
    const targetFOV = (playerState.isADS && isSniper) ? 15 :
        (playerState.isADS ? CONFIG.FOV_ADS : CONFIG.FOV_BASE);

    playerState.currentFOV += (targetFOV - playerState.currentFOV) * CONFIG.ADS_LERP_SPEED * dt;

    // Reload
    if (playerState.isReloading) {
        playerState.reloadTimer -= dt;
        if (playerState.reloadTimer <= 0) {
            const needed = currentWep.magSize - currentWep.ammo;
            const transfer = Math.min(needed, currentWep.reserve);
            currentWep.ammo += transfer;
            if (currentWep.reserve !== Infinity) currentWep.reserve -= transfer;
            playerState.isReloading = false;
        }
    } else if (playerState.isReloadingRequested && currentWep.ammo < currentWep.magSize) {
        playerState.isReloading = true;
        playerState.reloadTimer = currentWep.reloadTime;
        playerState.isReloadingRequested = false; // Clear the trigger
    }

    // ✅ GRENADE FIX (IMPORTANT)
    if (playerState.isAimingGrenade) {
        updateGrenadeTrajectory(game);
        wasAimingGrenade = true;
    } else {
        if (wasAimingGrenade) {
            throwGrenade(game); // THROW ON RELEASE
            wasAimingGrenade = false;
        }
        if (trajectoryLine) trajectoryLine.visible = false;
    }

    // Fire
    if (weapon.cooldown > 0) weapon.cooldown -= dt;

    if (!playerState.isReloading) {
    if (currentWep.isAutomatic) {
        if (playerState.isShooting && weapon.cooldown <= 0) {
            handleShooting(game);
        }
    } else {
        if (playerState.isShooting && weapon.cooldown <= 0) {
            handleShooting(game);
            playerState.isShooting = false; // single shot
        }
    }
}

    // Muzzle flash fade
    if (muzzleFlash && muzzleFlash.visible) {
        muzzleFlash.intensity *= 0.6;
        if (muzzleFlash.intensity < 0.1) muzzleFlash.visible = false;
    }
}

export function handleShooting(game) {
    const { playerState, weapon, camera } = game;
    const currentWep = playerState.inventory[playerState.currentWeaponIndex];

    if (currentWep.ammo <= 0) {
        if (currentWep.reserve > 0 || currentWep.reserve === Infinity) {
            playerState.isReloadingRequested = true;
        }
        return;
    }

    weapon.cooldown = currentWep.fireRate;
    currentWep.ammo--;

    camera.getWorldDirection(_camDir);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    // Build shootable list
    const shootables = [];

    bots.forEach(bot => {
    if (!bot.userData.isDead && bot.visible) {
        shootables.push(...bot.children);
    }
    });

    shootables.push(...targets);

    Object.values(game.remotePlayers).forEach(rp => {
        if (rp.mesh) shootables.push(rp.mesh);
        if (rp.headMesh) shootables.push(rp.headMesh);
    });

    const muzzlePos = camera.position.clone().addScaledVector(_camDir, 0.8);

    raycaster.set(muzzlePos, _camDir);
    const intersects = raycaster.intersectObjects(shootables, true);

    if (intersects.length === 0) return;

    const hitObj = intersects[0].object;

    // ✅ FIX: find bot root safely
    let bot = hitObj;
    while (bot.parent && !bot.userData.isBot) {
        bot = bot.parent;
    }

    if (!bot.userData) return;
    if (bot.userData.isDead) return;

    let damage = currentWep.damage;

    if (hitObj.userData.isHead) {
        damage *= (currentWep.headshotMult || 2.0);
    }

    damage = Math.round(damage);

    bot.userData.health -= damage;

    flashBot(bot, true);
    bot.userData.hitTimer = 0.1;

    // ✅ FIX: PROPER KILL HANDLING
    if (bot.userData.health <= 0 && !bot.userData.isDead) {

        bot.userData.isDead = true;
        bot.userData.respawnTimer = CONFIG.RESPAWN_DELAY;

        bot.rotation.x = -Math.PI / 2;
        bot.position.y = 0.5;

        bot.traverse(c => {
            if (c.isMesh) {
                c.material.color.set(0x555555);
                c.material.emissive.set(0x000000);
            }
        });

        // 🔥 THIS WAS YOUR MAIN BUG (kills not increasing)
        game.playerState.score += 1;

        game.addEvent("BOT KILLED", "#00ff00");
    }

    // Hit marker
    if (hitMarker) {
        hitMarker.classList.remove('hidden');
        setTimeout(() => hitMarker.classList.add('hidden'), 100);
    }

    // Tracer
    const dist = intersects[0].distance;
    const end = muzzlePos.clone().addScaledVector(_camDir, dist);
    spawnTracer(muzzlePos, end, game.scene);

    // Muzzle flash
    muzzleFlash.position.copy(camera.position);
    muzzleFlash.intensity = 3;
    muzzleFlash.visible = true;
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
    const v0 = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(game.camera.quaternion)
        .multiplyScalar(CONFIG.WEAPONS.GRENADE.tossForce);

    const g = new THREE.Vector3(0, CONFIG.GRENADE_GRAVITY, 0);

    for (let i = 0; i < CONFIG.TRAJECTORY_POINTS; i++) {
        const t = i * 0.1;
        const p = p0.clone()
            .addScaledVector(v0, t)
            .addScaledVector(g, 0.5 * t * t);
        points.push(p);
    }

    trajectoryLine.geometry.setFromPoints(points);
}

function throwGrenade(game) {
    if (game.playerState.grenades <= 0) return;

    game.playerState.grenades--;

    const p0 = game.camera.position.clone();
    const v0 = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(game.camera.quaternion)
        .multiplyScalar(CONFIG.WEAPONS.GRENADE.tossForce);

    import('./world.js').then(world => {
        world.spawnGrenade(p0, v0, game);
        game.addEvent("GRENADE THROWN", "#ffaa00");
    });
}