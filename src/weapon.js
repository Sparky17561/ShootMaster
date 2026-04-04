import * as THREE from 'three';
import { CONFIG } from './Config.js';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0); // Center of screen

export function updateWeapon(game, dt) {
    const { playerState, inputBuffer } = game;

    // ADS (FOV Zoom)
    const targetFOV = playerState.isADS ? CONFIG.FOV_ADS : CONFIG.FOV_BASE;
    playerState.currentFOV += (targetFOV - playerState.currentFOV) * CONFIG.ADS_LERP_SPEED * dt;

    // Shooting
    if (inputBuffer.shoot) {
        handleShooting(game);
        inputBuffer.shoot = false; // Prevents full auto unless logic added
    }

    // Recoil Recovery
    playerState.recoilOffset.x *= (1.0 - CONFIG.RECOIL_RECOVERY_SPEED * dt);
    playerState.recoilOffset.y *= (1.0 - CONFIG.RECOIL_RECOVERY_SPEED * dt);

    // Hit Marker Cooldown
    if (playerState.lastHitTime > 0) playerState.lastHitTime -= dt;
}

export function handleShooting(game) {
    const { scene, camera, playerState } = game;

    // 1. Raycast
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
        const hit = intersects[0];
        if (hit.object.userData.isTarget) {
            // 1.1 Target Feedback
            hit.object.material.color.set(0xff0000);
            hit.object.userData.hitTimer = 0.1; // 100ms flash
            
            // Scale Pop
            if (!hit.object.userData.baseScale) hit.object.userData.baseScale = hit.object.scale.x;
            hit.object.scale.setScalar(hit.object.userData.baseScale * 1.2);
            
            // 1.2 Hit Marker UI
            if (playerState.lastHitTime <= 0) {
                const marker = document.getElementById('hit-marker');
                marker.classList.remove('hidden');
                marker.classList.remove('hit-animate');
                void marker.offsetWidth; // Trigger reflow
                marker.classList.add('hit-animate');
                
                playerState.lastHitTime = CONFIG.HIT_COOLDOWN;
            }
        }
    }

    // 2. Apply Recoil
    playerState.recoilOffset.y += CONFIG.RECOIL_KICK;
    playerState.recoilOffset.x += (Math.random() - 0.5) * CONFIG.RECOIL_RANDOM_HORIZONTAL;

    // 3. Muzzle Flash (Visual only light)
    const flash = new THREE.PointLight(0xffaa00, 5, 5);
    flash.position.set(camera.position.x, camera.position.y - 0.2, camera.position.z);
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 50);

    // 4. Subtle Screen Shake (Simple position nudge)
    camera.position.x += (Math.random() - 0.5) * 0.05;
    camera.position.y += (Math.random() - 0.5) * 0.05;
}
