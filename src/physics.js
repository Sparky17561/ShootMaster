import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { obstacles } from './world.js';

const tempVec = new THREE.Vector3();
const moveDir = new THREE.Vector3();

export function updatePhysics(game, dt) {
    const { playerState, inputBuffer } = game;

    // 1. Calculate direction
    moveDir.set(0, 0, 0);
    if (!playerState.isSliding) {
        if (inputBuffer.forward) moveDir.z -= 1;
        if (inputBuffer.backward) moveDir.z += 1;
        if (inputBuffer.left) moveDir.x -= 1;
        if (inputBuffer.right) moveDir.x += 1;
        moveDir.normalize();
    } else {
        // Direction is locked during slide
        moveDir.set(playerState.slideDirection.x, 0, playerState.slideDirection.z);
    }

    // 2. Rotate direction based on camera yaw (only if not sliding)
    const yaw = playerState.rotation.yaw;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    
    let worldDX, worldDZ;
    if (!playerState.isSliding) {
        worldDX = (moveDir.x * cosYaw) + (moveDir.z * sinYaw);
        worldDZ = (moveDir.z * cosYaw) - (moveDir.x * sinYaw);
    } else {
        worldDX = moveDir.x;
        worldDZ = moveDir.z;
    }

    // 2.5 Slide / Crouch Trigger Logic
    const horizSpeed = Math.sqrt(playerState.velocity.x**2 + playerState.velocity.z**2);
    
    // Check for Slide TRIGGER (requires speed)
    const canSlide = playerState.isGrounded && !playerState.isSliding && playerState.slideCooldown <= 0 && horizSpeed > CONFIG.SLIDE_THRESHOLD;

    if (inputBuffer.modifier && canSlide) {
        playerState.isSliding = true;
        playerState.isCrouching = false;
        playerState.slideTimer = CONFIG.SLIDE_MAX_DURATION;
        playerState.slideDirection.x = worldDX;
        playerState.slideDirection.z = worldDZ;
        
        // Add Impulse
        playerState.velocity.x += worldDX * CONFIG.SLIDE_IMPULSE;
        playerState.velocity.z += worldDZ * CONFIG.SLIDE_IMPULSE;
    } 
    // Crouch check (if not sliding and modifier is held)
    else if (inputBuffer.modifier && !playerState.isSliding) {
        playerState.isCrouching = true;
    } else {
        playerState.isCrouching = false;
    }

    // 3. Movement logic with acceleration and friction
    let friction = playerState.isGrounded ? CONFIG.FRICTION : 0.5;
    let accel = playerState.isGrounded ? CONFIG.ACCELERATION : CONFIG.AIR_RESISTANCE;

    if (playerState.isSliding) {
        friction = CONFIG.SLIDE_FRICTION;
        playerState.slideTimer -= dt;
        
        // Camera tilt feedback
        playerState.cameraTilt = THREE.MathUtils.lerp(playerState.cameraTilt, CONFIG.SLIDE_TILT, 5 * dt);
        game.playerState.currentFOV = THREE.MathUtils.lerp(game.playerState.currentFOV, CONFIG.FOV_BASE + CONFIG.SLIDE_FOV_MOD, 5 * dt);

        // Terminate slide if too slow or time up
        if (playerState.slideTimer <= 0 || horizSpeed < 20) {
            playerState.isSliding = false;
            playerState.slideCooldown = CONFIG.SLIDE_COOLDOWN;
        }
    } else {
        playerState.cameraTilt = THREE.MathUtils.lerp(playerState.cameraTilt, 0, 5 * dt);
        // FOV is handled by ADS/Weapon but we ensure base for non-slide
        if (!playerState.isADS) {
            game.playerState.currentFOV = THREE.MathUtils.lerp(game.playerState.currentFOV, CONFIG.FOV_BASE, 5 * dt);
        }
        if (playerState.slideCooldown > 0) playerState.slideCooldown -= dt;
    }

    let currentSpeedLimit = CONFIG.WALK_SPEED;
    if (playerState.isCrouching) currentSpeedLimit *= CONFIG.CROUCH_SPEED_MOD;

    // Apply acceleration (not if sliding)
    if (!playerState.isSliding) {
        playerState.velocity.x += worldDX * accel;
        playerState.velocity.z += worldDZ * accel;
    }

    // Apply friction
    playerState.velocity.x *= (1.0 - friction * dt);
    playerState.velocity.z *= (1.0 - friction * dt);

    // Clamp speed (not if sliding)
    if (!playerState.isSliding) {
        const hSpeed = Math.sqrt(playerState.velocity.x**2 + playerState.velocity.z**2);
        if (hSpeed > currentSpeedLimit) {
            playerState.velocity.x = (playerState.velocity.x / hSpeed) * currentSpeedLimit;
            playerState.velocity.z = (playerState.velocity.z / hSpeed) * currentSpeedLimit;
        }
    }

    // 4. Gravity & Jump
    if (playerState.isGrounded && inputBuffer.jump) {
        playerState.velocity.y = CONFIG.JUMP_FORCE;
        playerState.isGrounded = false;
    }
    // 5. Apply velocity to position
    playerState.position.x += playerState.velocity.x * dt;
    playerState.position.y += playerState.velocity.y * dt;
    playerState.position.z += playerState.velocity.z * dt;

    // 6. Collision & Boundary Handling
    
    // A. Map Boundaries (+/- 50)
    const boundary = CONFIG.MAP_BOUNDARY;
    if (Math.abs(playerState.position.x) > boundary) {
        playerState.position.x = Math.sign(playerState.position.x) * boundary;
        playerState.velocity.x = 0;
    }
    if (Math.abs(playerState.position.z) > boundary) {
        playerState.position.z = Math.sign(playerState.position.z) * boundary;
        playerState.velocity.z = 0;
    }

    // B. Obstacle Collisions (AABB)
    const playerHalfWidth = CONFIG.PLAYER_WIDTH / 2;
    const playerMinX = playerState.position.x - playerHalfWidth;
    const playerMaxX = playerState.position.x + playerHalfWidth;
    const playerMinZ = playerState.position.z - playerHalfWidth;
    const playerMaxZ = playerState.position.z + playerHalfWidth;

    obstacles.forEach(obstacle => {
        const box = new THREE.Box3().setFromObject(obstacle);
        
        // Check for overlap on X and Z
        const overlapX = Math.min(playerMaxX, box.max.x) - Math.max(playerMinX, box.min.x);
        const overlapZ = Math.min(playerMaxZ, box.max.z) - Math.max(playerMinZ, box.min.z);

        if (overlapX > 0 && overlapZ > 0) {
            // Resolve along the shallowest axis
            if (overlapX < overlapZ) {
                const dir = playerState.position.x > (box.min.x + box.max.x) / 2 ? 1 : -1;
                playerState.position.x += overlapX * dir;
                playerState.velocity.x = 0;
            } else {
                const dir = playerState.position.z > (box.min.z + box.max.z) / 2 ? 1 : -1;
                playerState.position.z += overlapZ * dir;
                playerState.velocity.z = 0;
            }
        }
    });

    // 7. Ground / Height Handling
    const targetHeight = playerState.isCrouching ? CONFIG.CROUCH_HEIGHT : CONFIG.PLAYER_HEIGHT;
    if (playerState.isGrounded) {
        playerState.position.y = THREE.MathUtils.lerp(playerState.position.y, targetHeight, 10 * dt);
    }

    if (playerState.position.y <= targetHeight + 0.05) {
        if (playerState.position.y < targetHeight) playerState.position.y = targetHeight;
        playerState.isGrounded = true;
    } else {
        playerState.isGrounded = false;
        playerState.velocity.y -= CONFIG.GRAVITY * dt;
    }
}
