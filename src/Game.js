import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { updateInput, initInput } from './input.js';
import { updatePhysics } from './physics.js';
import { handleShooting, updateWeapon } from './weapon.js';
import { initWorld, updateWorld, updateBots, bots, obstacles } from './world.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initWeapon } from './weapon.js';
class Game {
    constructor() {
        this.container = document.getElementById('game-container');
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.clock = new THREE.Clock();
        this.accumulator = 0;
        this.isStarted = false;

        this.playerState = {
            position: { x: 0, y: CONFIG.PLAYER_HEIGHT, z: 80 },
            velocity: { x: 0, y: 0, z: 0 },
            rotation: { pitch: 0, yaw: 0 },
            health: 100,
            score: 0,
            isGrounded: false,
            isJumping: false,
            isShooting: false,
            isADS: false,
            isSliding: false,
            isCrouching: false,
            controlMode: 'pointerlock', // 'pointerlock' or 'trackpad'
            slideDirection: { x: 0, z: 0 },
            slideTimer: 0,
            slideCooldown: 0,
            lastHitTime: 0,
            recoilOffset: { x: 0, y: 0 },
            currentFOV: CONFIG.FOV_BASE,
            cameraTilt: 0,
            cameraShake: { x: 0, y: 0, z: 0 },
            isDead: false,
            respawnTimer: 0,
            eventFeed: [],
            
            // Inventory
            inventory: [
                { ...CONFIG.WEAPONS.PISTOL },
                { ...CONFIG.WEAPONS.RIFLE },
                { ...CONFIG.WEAPONS.SHOTGUN }
            ],
            currentWeaponIndex: 0,
            isReloading: false,
            reloadTimer: 0,
            grenades: 3
        };
        this.worldGrenades = [];

        this.inputBuffer = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            modifier: false,
            shoot: false,
            ads: false,
            mouseDelta: { x: 0, y: 0 }
        };

        this.weapon = {
            cooldown: 0
        };

        this.playerHitbox = null;
        this.pickups = [];

        this.init();
    }

    init() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(CONFIG.FOV_BASE, window.innerWidth / window.innerHeight, 0.1, 1000);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // Assets
        this.gltfLoader = new GLTFLoader();



        // Lights & Environment
        initWorld(this.scene, this);

        // Input
        initInput(this);

        initWeapon(this.scene, this.camera);

        // Player Hitbox (Invisible, for bot raycasting)
        const hitboxGeom = new THREE.BoxGeometry(CONFIG.PLAYER_WIDTH, CONFIG.PLAYER_HEIGHT, CONFIG.PLAYER_WIDTH);
        const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
        this.playerHitbox = new THREE.Mesh(hitboxGeom, hitboxMat);
        this.scene.add(this.playerHitbox);

        // Window resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Start loop
        this.animate();
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // Fixed Update Loop (60Hz)
    fixedUpdate(dt) {
        if (!this.isStarted) return;

        // 1. Process Input
        updateInput(this, dt);

        // 2. Physics & Movement
        updatePhysics(this, dt);

        // 3. Weapon Logic & Recoil
        updateWeapon(this, dt);

        // 4. Weapon Switching
        if (this.inputBuffer.switchNext) {
            this.playerState.currentWeaponIndex = (this.playerState.currentWeaponIndex + 1) % this.playerState.inventory.length;
            this.playerState.isReloading = false; // Cancel reload on switch
            this.inputBuffer.switchNext = false;
        }
        if (this.inputBuffer.switchPrev) {
            this.playerState.currentWeaponIndex = (this.playerState.currentWeaponIndex - 1 + this.playerState.inventory.length) % this.playerState.inventory.length;
            this.playerState.isReloading = false;
            this.inputBuffer.switchPrev = false;
        }

        // 5. World Logic (Hit feedback cleanup)
        updateWorld(this, dt);

        // 6. Pickup Collision
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const p = this.pickups[i];
            if (p.visible) {
                const dist = p.position.distanceTo(this.playerHitbox.position);
                if (dist < 2.0 && this.playerState.health < 100) {
                    this.playerState.health = Math.min(100, this.playerState.health + CONFIG.PICKUP_HEALTH_VALUE);
                    p.visible = false;
                    p.userData.respawnTimer = CONFIG.PICKUP_RESPAWN_TIME;
                }
            } else {
                p.userData.respawnTimer -= dt;
                if (p.userData.respawnTimer <= 0) p.visible = true;
            }
            // Bobbing animation
            p.rotation.y += dt;
            p.position.y = 1.0 + Math.sin(Date.now() * 0.003) * 0.2;
        }

        // 7. Bot AI Logic
        this.playerHitbox.position.set(
            this.playerState.position.x,
            this.playerState.position.y - CONFIG.PLAYER_HEIGHT / 2, // Center of box
            this.playerState.position.z
        );
        updateBots(this, dt, this.playerHitbox);

        // 8. Player Respawn Timer
        if (this.playerState.isDead) {
            this.playerState.respawnTimer -= dt;
            if (this.playerState.respawnTimer <= 0) {
                this.respawnPlayer();
            }
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock.getDelta();
        this.accumulator += deltaTime;

        // Run fixed updates
        while (this.accumulator >= CONFIG.FIXED_UPDATE_RATE) {
            this.fixedUpdate(CONFIG.FIXED_UPDATE_RATE);
            this.accumulator -= CONFIG.FIXED_UPDATE_RATE;
        }

        // Render at max possible FPS
        this.render();

        // Update HUD
        this.updateHUD(deltaTime);
    }

    render() {
        // Apply camera shake decay
        this.playerState.cameraShake.x *= CONFIG.SCREEN_SHAKE_DECAY;
        this.playerState.cameraShake.y *= CONFIG.SCREEN_SHAKE_DECAY;
        this.playerState.cameraShake.z *= CONFIG.SCREEN_SHAKE_DECAY;

        // Sync camera with player state + shake
        this.camera.position.set(
            this.playerState.position.x + this.playerState.cameraShake.x,
            this.playerState.position.y + this.playerState.cameraShake.y,
            this.playerState.position.z + this.playerState.cameraShake.z
        );

        // Combine base rotation, recoil, and jitter from shake
        const pitch = this.playerState.rotation.pitch + this.playerState.recoilOffset.y + (Math.random() - 0.5) * this.playerState.cameraShake.y * 0.1;
        const yaw = this.playerState.rotation.yaw + this.playerState.recoilOffset.x + (Math.random() - 0.5) * this.playerState.cameraShake.x * 0.1;

        this.camera.rotation.set(pitch, yaw, this.playerState.cameraTilt + this.playerState.cameraShake.z * 0.05, 'YXZ');
        this.camera.fov = this.playerState.currentFOV;
        this.camera.updateProjectionMatrix();

        this.renderer.render(this.scene, this.camera);
    }

    takeDamage(amount) {
        if (this.playerState.isDead) return;
        this.playerState.health = Math.max(0, this.playerState.health - amount);
        
        // Damage Feedback
        const flash = document.getElementById('damage-flash');
        flash.classList.add('active');
        setTimeout(() => flash.classList.remove('active'), 200);

        this.playerState.cameraShake.x += (Math.random() - 0.5) * 1.5;
        this.playerState.cameraShake.y += (Math.random() - 0.5) * 1.5;
        this.playerState.cameraShake.z += (Math.random() - 0.5) * 0.5;

        if (this.playerState.health <= 0) {
            this.die();
        }
    }

    addEvent(text, color = '#fff') {
        const feed = document.getElementById('event-feed');
        const item = document.createElement('div');
        item.className = 'event-item';
        item.style.color = color;
        item.innerText = text;
        feed.prepend(item);
        setTimeout(() => item.remove(), 3000);
    }

    die() {
        this.playerState.isDead = true;
        this.playerState.respawnTimer = CONFIG.PLAYER_RESPAWN_TIME;
        document.body.classList.add('dead');
        // Disable input effects
        this.playerState.velocity.x = 0;
        this.playerState.velocity.z = 0;
    }

    respawnPlayer() {
        this.playerState.isDead = false;
        this.playerState.health = 100;
        this.playerState.position = { x: 0, y: CONFIG.PLAYER_HEIGHT, z: 10 };
        this.playerState.velocity = { x: 0, y: 0, z: 0 };
        document.body.classList.remove('dead');
    }

    updateHUD(dt) {
        if (!this.playerHitbox) return;

        const speed = Math.sqrt(this.playerState.velocity.x ** 2 + this.playerState.velocity.z ** 2);
        const currentWep = this.playerState.inventory[this.playerState.currentWeaponIndex];
        const ammoTextReserve = (currentWep.reserve === Infinity || currentWep.reserve === null) ? '∞' : currentWep.reserve;
        
        // 1. Text Stats
        document.getElementById('kill-counter').innerText = `KILLS: ${this.playerState.score}`;
        document.getElementById('fps-counter').innerText = `FPS: ${Math.round(1 / dt)}`;
        document.getElementById('speed-meter').innerText = `SPD: ${speed.toFixed(1)}`;
        document.getElementById('player-hp-val').innerText = Math.round(this.playerState.health);
        document.getElementById('weapon-name').innerText = currentWep.name.toUpperCase();
        document.getElementById('ammo-mag').innerText = currentWep.ammo;
        document.getElementById('ammo-reserve').innerText = ammoTextReserve;

        // 2. Bars
        const hpBar = document.getElementById('health-bar-fill');
        hpBar.style.width = `${this.playerState.health}%`;
        hpBar.className = 'bar-fill ' + (this.playerState.health > 60 ? 'health-high' : this.playerState.health > 30 ? 'health-med' : 'health-low');
        
        const ammoBar = document.getElementById('ammo-bar-fill');
        const ammoPct = (currentWep.ammo / currentWep.magSize) * 100;
        ammoBar.style.width = `${ammoPct}%`;
        ammoBar.className = 'bar-fill ' + (currentWep.ammo === 0 ? 'ammo-empty' : 'ammo-active');

        // 3. Inventory Slots
        for (let i = 0; i < 3; i++) {
            const slot = document.getElementById(`slot-${i}`);
            if (slot) {
                if (i === this.playerState.currentWeaponIndex) slot.classList.add('active');
                else slot.classList.remove('active');
            }
        }

        // 4. Action Banner
        const banner = document.getElementById('action-banner');
        if (this.playerState.isReloading) {
            banner.innerText = 'RELOADING...';
            banner.classList.remove('hidden');
        } else if (currentWep.ammo === 0) {
            banner.innerText = 'OUT OF AMMO';
            banner.classList.remove('hidden');
        } else if (currentWep.ammo < currentWep.magSize * 0.3) {
            banner.innerText = 'LOW AMMO';
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }

        // 5. Minimap Logic (Relative Radar)
        const minimap = document.getElementById('minimap-container');
        const pDot = document.getElementById('minimap-player');
        const radarRadius = 60; // 60m visible on minimap
        
        // Player is always center in relative mode
        pDot.style.left = '50%';
        pDot.style.top = '50%';

        const oldDots = minimap.querySelectorAll('.bot-dot, .obstacle-dot');
        oldDots.forEach(d => d.remove());

        const px = this.playerState.position.x;
        const pz = this.playerState.position.z;

        // Draw Obstacles (Local only)
        obstacles.forEach(obs => {
            const dx = obs.position.x - px;
            const dz = obs.position.z - pz;
            if (Math.abs(dx) < radarRadius && Math.abs(dz) < radarRadius) {
                const dot = document.createElement('div');
                dot.className = 'obstacle-dot';
                dot.style.left = `${(dx / (radarRadius * 2) + 0.5) * 100}%`;
                dot.style.top = `${(dz / (radarRadius * 2) + 0.5) * 100}%`;
                const size = Math.max(2, (obs.geometry.parameters.width || 2) * (140 / (radarRadius * 2)));
                dot.style.width = `${size}px`;
                dot.style.height = `${size}px`;
                minimap.appendChild(dot);
            }
        });

        bots.forEach(bot => {
            if (bot.userData.isDead) return;
            const dx = bot.position.x - px;
            const dz = bot.position.z - pz;
            if (Math.abs(dx) < radarRadius && Math.abs(dz) < radarRadius) {
                const dot = document.createElement('div');
                dot.className = 'bot-dot';
                dot.style.left = `${(dx / (radarRadius * 2) + 0.5) * 100}%`;
                dot.style.top = `${(dz / (radarRadius * 2) + 0.5) * 100}%`;
                minimap.appendChild(dot);
            }
        });

        // 5. Dynamic Crosshair Spread
        const crosshair = document.getElementById('crosshair');
        let spreadBase = 10;
        if (speed > 5) spreadBase += speed * 0.5;
        if (!this.playerState.onGround) spreadBase += 20;
        if (this.playerState.isShooting) spreadBase += 15;
        if (this.playerState.isADS) spreadBase = 2;

        crosshair.style.setProperty('--spread', `${spreadBase}px`);

        // Debug
        const pos = this.playerState.position;
        document.getElementById('pos-display').innerText = `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
        const vel = this.playerState.velocity;
        document.getElementById('vel-display').innerText = `${vel.x.toFixed(1)}, ${vel.y.toFixed(1)}, ${vel.z.toFixed(1)}`;
    }
}

export default Game;
