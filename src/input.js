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
                container.requestPointerLock();
            } else {
                document.exitPointerLock();
                game.isStarted = true; // Always active in trackpad mode
                instruction.style.display = 'none';
            }
            firstMove = true;
            return;
        }

        switch(e.code) {
            case 'KeyW': game.inputBuffer.forward = true; break;
            case 'KeyS': game.inputBuffer.backward = true; break;
            case 'KeyA': game.inputBuffer.left = true; break;
            case 'KeyD': game.inputBuffer.right = true; break;
            case 'Space': game.inputBuffer.jump = true; break;
            case 'ShiftLeft': game.inputBuffer.modifier = true; break;
            case 'KeyO': game.inputBuffer.shoot = true; break;
            case 'KeyQ': game.inputBuffer.ads = true; break;
            case 'KeyP': 
                const debug = document.getElementById('debug-info');
                debug.classList.toggle('hidden');
                break;
        }
    });

    window.addEventListener('keyup', (e) => {
        switch(e.code) {
            case 'KeyW': game.inputBuffer.forward = false; break;
            case 'KeyS': game.inputBuffer.backward = false; break;
            case 'KeyA': game.inputBuffer.left = false; break;
            case 'KeyD': game.inputBuffer.right = false; break;
            case 'Space': game.inputBuffer.jump = false; break;
            case 'ShiftLeft': game.inputBuffer.modifier = false; break;
            case 'KeyO': game.inputBuffer.shoot = false; break;
            case 'KeyQ': game.inputBuffer.ads = false; break;
        }
    });

    // Pointer Lock Events
    container.addEventListener('click', () => {
        if (game.playerState.controlMode === 'pointerlock') {
            container.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        if (game.playerState.controlMode === 'pointerlock') {
            if (document.pointerLockElement === container) {
                instruction.style.display = 'none';
                game.isStarted = true;
            } else {
                instruction.style.display = 'block';
                game.isStarted = false;
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
            // Trackpad fallback: use clientX/Y to calculate delta manually
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

        // Spike Rejection
        if (Math.abs(dx) > CONFIG.DELTA_SPIKE_THRESHOLD || Math.abs(dy) > CONFIG.DELTA_SPIKE_THRESHOLD) {
            return;
        }

        const sensitivity = game.playerState.controlMode === 'pointerlock' ? CONFIG.MOUSE_SENSITIVITY : CONFIG.TRACKPAD_SENSITIVITY;

        game.inputBuffer.mouseDelta.x -= dx * sensitivity;
        game.inputBuffer.mouseDelta.y -= dy * sensitivity;
        
        // Clamp pitch immediately to avoid buffer issues
        const limit = Math.PI / 2 - 0.1;
        game.inputBuffer.mouseDelta.y = Math.max(-limit, Math.min(limit, game.inputBuffer.mouseDelta.y));
    });

    // Mouse Buttons
    window.addEventListener('mousedown', (e) => {
        if (!game.isStarted) return;
        if (e.button === 0) game.inputBuffer.shoot = true;
        if (e.button === 2) game.inputBuffer.ads = true;
    });

    window.addEventListener('mouseup', (e) => {
        if (!game.isStarted) return;
        if (e.button === 0) game.inputBuffer.shoot = false;
        if (e.button === 2) game.inputBuffer.ads = false;
    });

    container.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Reset tracker on window focus/entry
    window.addEventListener('mouseenter', () => { firstMove = true; });
}

export function updateInput(game, dt) {
    const isTrackpad = game.playerState.controlMode === 'trackpad';
    const smoothing = isTrackpad ? CONFIG.TRACKPAD_SMOOTHING : 1.0; // Instant in pointerlock, smoothed in trackpad

    // Apply smoothing (lerp) to the target rotation
    game.playerState.rotation.yaw += (game.inputBuffer.mouseDelta.x - game.playerState.rotation.yaw) * smoothing;
    game.playerState.rotation.pitch += (game.inputBuffer.mouseDelta.y - game.playerState.rotation.pitch) * smoothing;

    // Actions
    game.playerState.isShooting = game.inputBuffer.shoot;
    game.playerState.isADS = game.inputBuffer.ads;
}

