import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { updateInput, initInput } from './input.js';
import { updatePhysics } from './physics.js';
import { handleShooting, updateWeapon } from './weapon.js';
import { initWorld, updateWorld, updateBots } from './world.js';
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
            position: { x: 0, y: CONFIG.PLAYER_HEIGHT, z: 10 },
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
            isDead: false,
            respawnTimer: 0
        };

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
        initWorld(this.scene);

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

        // 4. World Logic (Hit feedback cleanup)
        updateWorld(this, dt);

        // 5. Bot AI Logic
        this.playerHitbox.position.set(
            this.playerState.position.x,
            this.playerState.position.y - CONFIG.PLAYER_HEIGHT / 2, // Center of box
            this.playerState.position.z
        );
        updateBots(this, dt, this.playerHitbox);

        // 6. Player Respawn Timer
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
        // Sync camera with player state
        this.camera.position.set(
            this.playerState.position.x,
            this.playerState.position.y,
            this.playerState.position.z
        );

        // Combine base rotation and recoil
        const pitch = this.playerState.rotation.pitch + this.playerState.recoilOffset.y;
        const yaw = this.playerState.rotation.yaw + this.playerState.recoilOffset.x;

        this.camera.rotation.set(pitch, yaw, this.playerState.cameraTilt, 'YXZ');
        this.camera.fov = this.playerState.currentFOV;
        this.camera.updateProjectionMatrix();

        this.renderer.render(this.scene, this.camera);
    }

    takeDamage(amount) {
        if (this.playerState.isDead) return;
        this.playerState.health = Math.max(0, this.playerState.health - amount);
        if (this.playerState.health <= 0) {
            this.die();
        }
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
        const speed = Math.sqrt(this.playerState.velocity.x ** 2 + this.playerState.velocity.z ** 2);

        document.getElementById('fps-counter').innerText = `FPS: ${Math.round(1 / dt)}`;
        document.getElementById('player-hp').innerText = `HP: ${Math.round(this.playerState.health)}`;
        document.getElementById('score-display').innerText = `SCORE: ${this.playerState.score}`;
        document.getElementById('speed-meter').innerText = `SPD: ${speed.toFixed(1)}`;

        const slideStatus = document.getElementById('slide-status');
        if (this.playerState.isSliding) {
            slideStatus.innerText = 'SLD: ACTIVE';
            slideStatus.style.color = '#ffff00';
        } else if (this.playerState.isCrouching) {
            slideStatus.innerText = 'SLD: CROUCH';
            slideStatus.style.color = '#00aaff';
        } else if (this.playerState.slideCooldown > 0) {
            slideStatus.innerText = `SLD: CD (${this.playerState.slideCooldown.toFixed(1)}s)`;
            slideStatus.style.color = '#ff0000';
        } else {
            slideStatus.style.color = '#00ff00';
        }

        const modeDisplay = document.getElementById('control-mode');
        const modeHint = document.getElementById('mode-hint');
        if (this.playerState.controlMode === 'trackpad') {
            modeDisplay.innerText = 'MODE: TRACKPAD';
            modeDisplay.style.color = '#00aaff';
            modeHint.innerText = 'PRESS [T] FOR POINTER LOCK';
        } else {
            modeDisplay.innerText = 'MODE: POINTER LOCK';
            modeDisplay.style.color = '#00ff00';
            modeHint.innerText = 'PRESS [T] FOR TRACKPAD';
        }

        document.getElementById('pos-display').innerText = `${this.playerState.position.x.toFixed(2)}, ${this.playerState.position.y.toFixed(2)}, ${this.playerState.position.z.toFixed(2)}`;
        document.getElementById('vel-display').innerText = `${this.playerState.velocity.x.toFixed(2)}, ${this.playerState.velocity.y.toFixed(2)}, ${this.playerState.velocity.z.toFixed(2)}`;
    }
}

export default Game;
