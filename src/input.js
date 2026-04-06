import { CONFIG } from './Config.js';

let lastMouseX = 0;
let lastMouseY = 0;
let firstMove = true;

export function initInput(game) {
    const container = game.container;
    const instruction = document.getElementById('instruction');

    // KEY DOWN
    window.addEventListener('keydown', (e) => {

        if (document.activeElement.tagName === 'INPUT') return;

        if (e.code === 'KeyT') {
            game.playerState.controlMode =
                game.playerState.controlMode === 'pointerlock' ? 'trackpad' : 'pointerlock';

            if (game.playerState.controlMode === 'pointerlock') {
                if (document.pointerLockElement !== container) container.requestPointerLock();
            } else {
                document.exitPointerLock();
                game.isStarted = true;
                instruction.style.display = 'none';
                document.body.classList.remove('paused');
            }

            firstMove = true;
            return;
        }

        switch (e.code) {
            case 'KeyW': game.inputBuffer.forward = true; break;
            case 'KeyS': game.inputBuffer.backward = true; break;
            case 'KeyA': game.inputBuffer.left = true; break;
            case 'KeyD': game.inputBuffer.right = true; break;
            case 'Space': game.inputBuffer.jump = true; break;
            case 'ShiftLeft': game.inputBuffer.modifier = true; break;

            case 'KeyO': game.inputBuffer.shoot = true; break;
            case 'KeyQ': game.inputBuffer.ads = true; break;

            case 'Digit1': game.inputBuffer.switchIndex = 0; break;
            case 'Digit2': game.inputBuffer.switchIndex = 1; break;
            case 'Digit3': game.inputBuffer.switchIndex = 2; break;
            case 'Digit4': game.inputBuffer.switchIndex = 3; break;

            // GRENADE HOLD
            case 'KeyG':
                game.inputBuffer.grenade = true;
                break;

            // Reload (single trigger)
            case 'KeyR':
                if (!game.playerState.isReloading) {
                    game.inputBuffer.reload = true;
                }
                break;

            case 'Enter':
                if (game.playerState.isDead && (game.playerState.respawnTimer || 0) <= 0) {
                    game.respawnPlayer();
                }
                break;

            case 'KeyP':
                const debug = document.getElementById('debug-info');
                if (debug) debug.classList.toggle('hidden');
                break;
        }
    });

    // KEY UP
    window.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'KeyW': game.inputBuffer.forward = false; break;
            case 'KeyS': game.inputBuffer.backward = false; break;
            case 'KeyA': game.inputBuffer.left = false; break;
            case 'KeyD': game.inputBuffer.right = false; break;
            case 'Space': game.inputBuffer.jump = false; break;
            case 'ShiftLeft': game.inputBuffer.modifier = false; break;

            case 'KeyO': game.inputBuffer.shoot = false; break;
            case 'KeyQ': game.inputBuffer.ads = false; break;

            case 'KeyG':
                game.inputBuffer.grenade = false;
                break;

            case 'KeyR':
                game.inputBuffer.reload = false;
                break;
        }
    });

    // POINTER LOCK
    container.addEventListener('click', () => {
        const lobby = document.getElementById('lobby-screen');
        if (lobby && !lobby.classList.contains('hidden')) return;

        if (game.playerState.controlMode === 'pointerlock' &&
            document.pointerLockElement !== container) {
            container.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        if (game.playerState.controlMode === 'pointerlock') {
            if (document.pointerLockElement === container) {
                instruction.classList.add('hidden');
                document.body.classList.remove('paused');
                game.isStarted = true;
            } else {
                const isMatchEnd = game.missionTimer <= 0 && game.isStarted;
                if (isMatchEnd) return;

                instruction.classList.remove('hidden');
                document.body.classList.add('paused');
                game.isStarted = false;

                if (typeof game.updatePauseScreen === 'function') {
                    game.updatePauseScreen();
                }
            }
        }
    });

    // MOUSE MOVE
    window.addEventListener('mousemove', (e) => {
        if (!game.isStarted) return;

        let dx = 0, dy = 0;

        if (game.playerState.controlMode === 'pointerlock') {
            dx = e.movementX;
            dy = e.movementY;
        } else {
            if (firstMove) {
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                firstMove = false;
                return;
            }
            dx = e.clientX - lastMouseX;
            dy = e.clientY - lastMouseY;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        }

        if (Math.abs(dx) > CONFIG.DELTA_SPIKE_THRESHOLD ||
            Math.abs(dy) > CONFIG.DELTA_SPIKE_THRESHOLD) return;

        const sensitivity = game.playerState.controlMode === 'pointerlock'
            ? CONFIG.MOUSE_SENSITIVITY
            : CONFIG.TRACKPAD_SENSITIVITY;

        game.inputBuffer.mouseDelta.x -= dx * sensitivity;
        game.inputBuffer.mouseDelta.y -= dy * sensitivity;

        const limit = Math.PI / 2 - 0.1;
        game.inputBuffer.mouseDelta.y =
            Math.max(-limit, Math.min(limit, game.inputBuffer.mouseDelta.y));
    });

    // MOUSE BUTTONS
    window.addEventListener('mousedown', (e) => {
        if (!game.isStarted) return;
        if (e.button === 0) game.inputBuffer.shoot = true;
        if (e.button === 2) game.inputBuffer.ads = true;
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) game.inputBuffer.shoot = false;
        if (e.button === 2) game.inputBuffer.ads = false;
    });

    // SCROLL
    window.addEventListener('wheel', (e) => {
        if (!game.isStarted) return;
        if (e.deltaY > 0) game.inputBuffer.switchNext = true;
        else game.inputBuffer.switchPrev = true;
    });

    container.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseenter', () => { firstMove = true; });
}

export function updateInput(game, dt) {
    // Rotation
    game.playerState.rotation.yaw += game.inputBuffer.mouseDelta.x;
    game.playerState.rotation.pitch += game.inputBuffer.mouseDelta.y;

    game.inputBuffer.mouseDelta.x = 0;
    game.inputBuffer.mouseDelta.y = 0;

    const limit = Math.PI / 2 - 0.1;
    game.playerState.rotation.pitch =
        Math.max(-limit, Math.min(limit, game.playerState.rotation.pitch));

    // States
    game.playerState.isShooting = game.inputBuffer.shoot;
    game.playerState.isADS = game.inputBuffer.ads;

    // Reload
    game.playerState.isReloadingRequested = game.playerState.isReloadingRequested || game.inputBuffer.reload;
    game.inputBuffer.reload = false;

    // Grenade aiming
    game.playerState.isAimingGrenade = game.inputBuffer.grenade;

    // Weapon switch
    if (game.inputBuffer.switchIndex !== undefined) {
        game.playerState.currentWeaponIndex = game.inputBuffer.switchIndex;
        game.playerState.isReloading = false;
        game.inputBuffer.switchIndex = undefined;
    }
}