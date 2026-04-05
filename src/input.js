import { CONFIG } from './Config.js';

let lastMouseX = 0;
let lastMouseY = 0;
let firstMove = true;

export function initInput(game) {
    const container = game.container;
    const instruction = document.getElementById('instruction');

    // Mode Toggle & Keys
    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyT') {
            game.playerState.controlMode = game.playerState.controlMode === 'pointerlock' ? 'trackpad' : 'pointerlock';

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
            case 'KeyG': game.inputBuffer.grenade = true; break;
            case 'KeyR': game.inputBuffer.reload = true; break;
            case 'KeyP':
                const debug = document.getElementById('debug-info');
                debug.classList.toggle('hidden');
                break;
        }
    });

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
            case 'KeyR': game.inputBuffer.reload = false; break;
            case 'KeyG': game.inputBuffer.grenade = false; break;
        }
    });

    // Pointer Lock Events
    container.addEventListener('click', () => {
        // Prevent clicking background from bypassing lobby
        const lobby = document.getElementById('lobby-screen');
        if (lobby && !lobby.classList.contains('hidden')) return;

        // FIX 3: All players (host and joinee alike) can re-acquire pointer lock.
        // The old code had no host gate here, but the pointerlockchange handler
        // below was the real asymmetry — it is now fully symmetric for all roles.
        if (game.playerState.controlMode === 'pointerlock' && document.pointerLockElement !== container) {
            container.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        // FIX 3: This handler now runs identically for every player role.
        // There is no isHost check — Joinees get the same pause/resume behaviour.
        if (game.playerState.controlMode === 'pointerlock') {
            if (document.pointerLockElement === container) {
                // Pointer locked → game is running
                instruction.classList.add('hidden');
                document.body.classList.remove('paused');
                game.isStarted = true;
            } else {
                // Pointer unlocked → paused (unless match is over)
                const isMatchEnd = game.missionTimer <= 0 && game.isStarted;
                if (isMatchEnd) return;

                instruction.classList.remove('hidden');
                document.body.classList.add('paused');
                game.isStarted = false;
                if (typeof game.updatePauseScreen === 'function') game.updatePauseScreen();
            }
        }
    });

    // Mouse Movement
    window.addEventListener('mousemove', (e) => {
        if (!game.isStarted) return;

        let dx = 0;
        let dy = 0;

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

        if (Math.abs(dx) > CONFIG.DELTA_SPIKE_THRESHOLD || Math.abs(dy) > CONFIG.DELTA_SPIKE_THRESHOLD) return;

        const sensitivity = game.playerState.controlMode === 'pointerlock' ? CONFIG.MOUSE_SENSITIVITY : CONFIG.TRACKPAD_SENSITIVITY;

        game.inputBuffer.mouseDelta.x -= dx * sensitivity;
        game.inputBuffer.mouseDelta.y -= dy * sensitivity;

        const limit = Math.PI / 2 - 0.1;
        game.inputBuffer.mouseDelta.y = Math.max(-limit, Math.min(limit, game.inputBuffer.mouseDelta.y));
    });

    // Mouse Buttons - Shoot and ADS
    window.addEventListener('mousedown', (e) => {
        if (!game.isStarted) return;
        if (e.button === 0) game.inputBuffer.shoot = true;
        if (e.button === 2) game.inputBuffer.ads = true;
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) game.inputBuffer.shoot = false;
        if (e.button === 2) game.inputBuffer.ads = false;
    });

    window.addEventListener('wheel', (e) => {
        if (!game.isStarted) return;
        if (e.deltaY > 0) game.inputBuffer.switchNext = true;
        else if (e.deltaY < 0) game.inputBuffer.switchPrev = true;
    });

    container.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseenter', () => { firstMove = true; });
}

export function updateInput(game, dt) {
    const isTrackpad = game.playerState.controlMode === 'trackpad';
    const smoothing = isTrackpad ? CONFIG.TRACKPAD_SMOOTHING : 1.0;

    game.playerState.rotation.yaw += (game.inputBuffer.mouseDelta.x - game.playerState.rotation.yaw) * smoothing;
    game.playerState.rotation.pitch += (game.inputBuffer.mouseDelta.y - game.playerState.rotation.pitch) * smoothing;

    game.playerState.isShooting = game.inputBuffer.shoot;
    game.playerState.isADS = game.inputBuffer.ads;
    game.playerState.isReloadingRequested = game.inputBuffer.reload;
    game.playerState.isAimingGrenade = game.inputBuffer.grenade;

    if (game.inputBuffer.switchIndex !== undefined) {
        if (game.inputBuffer.switchIndex < game.playerState.inventory.length) {
            game.playerState.currentWeaponIndex = game.inputBuffer.switchIndex;
            game.playerState.isReloading = false;
        }
        game.inputBuffer.switchIndex = undefined;
    }
}