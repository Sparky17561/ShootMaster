import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { targets, bots } from './world.js';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0);

// CACHE DOM ELEMENT
const hitMarker = document.getElementById('hit-marker');

// REUSE LIGHT
let muzzleFlash = null;

export function initWeapon(scene, camera) {
    muzzleFlash = new THREE.PointLight(0xffaa00, 0, 5);
    muzzleFlash.visible = false;
    scene.add(muzzleFlash);
}

export function updateWeapon(game, dt) {
    const { playerState, inputBuffer } = game;
    
    // 1. ADS (FOV Zoom)
    const targetFOV = playerState.isADS ? CONFIG.FOV_ADS : CONFIG.FOV_BASE;
    playerState.currentFOV += (targetFOV - playerState.currentFOV) * CONFIG.ADS_LERP_SPEED * dt;

    // 2. Fire Logic
    if (inputBuffer.shoot) {
        handleShooting(game);
    }
    
    // Update cooldown
    if (game.weapon.cooldown > 0) {
        game.weapon.cooldown -= dt;
    }

    // 3. Recoil Recovery
    playerState.recoilOffset.x *= (1.0 - CONFIG.RECOIL_RECOVERY_SPEED * dt);
    playerState.recoilOffset.y *= (1.0 - CONFIG.RECOIL_RECOVERY_SPEED * dt);

    // 4. Hit Marker Cooldown
    if (playerState.lastHitTime > 0) {
        playerState.lastHitTime -= dt;
    }

    // 5. Fade Muzzle Flash
    if (muzzleFlash && muzzleFlash.visible) {
        muzzleFlash.intensity *= 0.6;
        if (muzzleFlash.intensity < 0.1) muzzleFlash.visible = false;
    }
}

export function handleShooting(game) {
    const { playerState, inputBuffer, weapon, scene, camera } = game;
    
    // Cooldown check
    if (weapon.cooldown > 0) return;
    weapon.cooldown = 0.1; // 10 shots per second

    // Raycast against targets and bots
    if (playerState.isDead) return;
    raycaster.setFromCamera(mouse, camera);
    const shootables = [...targets, ...bots];
    const intersects = raycaster.intersectObjects(shootables, false);

    if (intersects.length > 0) {
        const target = intersects[0].object;

        if (!target.userData.isDead) {
            // Damage
            target.userData.health -= CONFIG.DAMAGE_PER_SHOT;

            // Feedback
            target.material.color.set(0xff0000);
            target.userData.hitTimer = 0.1;

            if (!target.userData.baseScale) target.userData.baseScale = target.scale.x;
            target.scale.setScalar(target.userData.baseScale * 1.2);

            // Death
            if (target.userData.health <= 0) {
                target.userData.isDead = true;
                target.userData.respawnTimer = CONFIG.RESPAWN_DELAY;
                playerState.score += 1;
            }

            // Hit Marker UI
            if (playerState.lastHitTime <= 0) {
                hitMarker.classList.remove('hidden');
                hitMarker.classList.remove('hit-animate');
                void hitMarker.offsetWidth;
                hitMarker.classList.add('hit-animate');
                playerState.lastHitTime = CONFIG.HIT_COOLDOWN;
            }
        }
    }

    // Apply Recoil & Shake (Managed by Game.js render loop)
    playerState.recoilOffset.y += CONFIG.RECOIL_KICK;
    playerState.recoilOffset.x += (Math.random() - 0.5) * CONFIG.RECOIL_RANDOM_HORIZONTAL;

    // Muzzle Flash
    muzzleFlash.position.copy(camera.position);
    muzzleFlash.intensity = 3;
    muzzleFlash.visible = true;

    // Consume input
    inputBuffer.shoot = false;
}