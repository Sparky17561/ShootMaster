/**
 * menu.js — Pre-game menu and player setup system
 */

const SKIN_COLORS = [
    { label: 'Cyan', value: '#00e5ff' },
    { label: 'Orange', value: '#ff6a00' },
    { label: 'Lime', value: '#a8ff00' },
    { label: 'Pink', value: '#ff00cc' },
    { label: 'Gold', value: '#ffd700' },
    { label: 'Red', value: '#ff2244' },
    { label: 'Purple', value: '#cc00ff' },
    { label: 'White', value: '#ffffff' },
];

let selectedMode = 'solo';
let selectedColor = SKIN_COLORS[0].value;

/**
 * Initialize and show the main menu
 * @param {function} onStart - called with playerProfile when game starts
 */
export function showMainMenu(onStart) {
    const overlay = document.getElementById('main-menu');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    // Mode buttons
    // Initial selection UI update
    overlay.querySelectorAll('.mode-card').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === selectedMode);
        
        btn.addEventListener('click', () => {
            selectedMode = btn.dataset.mode;
            overlay.querySelectorAll('.mode-card').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Play button → show setup screen
    const playBtn = document.getElementById('menu-play-btn');
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            overlay.classList.add('hidden');
            showSetupScreen(selectedMode, onStart);
        });
    }
}

function showSetupScreen(mode, onStart) {
    const screen = document.getElementById('setup-screen');
    if (!screen) return;
    screen.classList.remove('hidden');

    // Mode label
    const modeLabels = { solo: 'Single Player', pvp: 'PvP Multiplayer' };
    const modeEl = document.getElementById('setup-mode-label');
    if (modeEl) modeEl.textContent = modeLabels[mode] || mode;

    // Room Type Toggle
    const btnCreate = document.getElementById('btn-create-room');
    const btnJoin = document.getElementById('btn-join-room');
    const joinContainer = document.getElementById('join-room-input-container');
    const roomInput = document.getElementById('room-id-input');

    let roomMode = 'create'; // defined locally for each setup screen open
    
    function setRoomMode(m) {
        roomMode = m;
        if (btnCreate && btnJoin && joinContainer) {
            if (m === 'create') {
                btnCreate.classList.add('active');
                btnJoin.classList.remove('active');
                joinContainer.style.display = 'none';
                if (roomInput) roomInput.value = '';
            } else {
                btnJoin.classList.add('active');
                btnCreate.classList.remove('active');
                joinContainer.style.display = 'block';
            }
        }
    }

    if (btnCreate) btnCreate.onclick = () => setRoomMode('create');
    if (btnJoin) btnJoin.onclick = () => setRoomMode('join');
    setRoomMode('create');

    // Color swatches
    const swatchContainer = document.getElementById('color-swatches');
    if (swatchContainer) {
        swatchContainer.innerHTML = '';
        SKIN_COLORS.forEach(c => {
            const swatch = document.createElement('button');
            swatch.className = 'color-swatch';
            swatch.style.background = c.value;
            swatch.title = c.label;
            swatch.dataset.color = c.value;
            if (c.value === selectedColor) swatch.classList.add('selected');
            swatch.addEventListener('click', () => {
                selectedColor = c.value;
                swatchContainer.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
            });
            swatchContainer.appendChild(swatch);
        });
    }

    // Room ID (only for pvp)
    const roomSection = document.getElementById('room-id-section');
    if (roomSection) {
        roomSection.style.display = (mode === 'pvp') ? 'flex' : 'none';
    }

    // Confirm button
    const confirmBtn = document.getElementById('setup-confirm-btn');
    if (confirmBtn) {
        confirmBtn.onclick = () => {
            const nameInput = document.getElementById('player-name-input');
            const playerName = (nameInput?.value || '').trim();

            if (!playerName) {
                alert('Please enter a call sign.');
                return;
            }

            let roomId = null; // Default to null for 'CREATE' flow
            if (mode !== 'solo') {
                if (roomMode === 'join') {
                    roomId = (roomInput?.value || '').trim().toUpperCase();
                    if (!roomId || roomId.length < 4) {
                        alert('Please enter a valid 4-character room code to join.');
                        return;
                    }
                }
            }

            const profile = {
                name: playerName.slice(0, 20),
                skinColor: selectedColor,
                mode,
                roomId
            };

            screen.classList.add('hidden');
            onStart(profile);
        };
    }

    // Back button
    const backBtn = document.getElementById('setup-back-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            screen.classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
        };
    }
}

function generateRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function hideAllMenus() {
    ['main-menu', 'setup-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}
