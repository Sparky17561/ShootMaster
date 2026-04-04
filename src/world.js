import * as THREE from 'three';

let targets = [];
let obstacles = [];

export function initWorld(scene) {
    // 1. Lighting
    const ambient = new THREE.AmbientLight(0x404040); // Soft white light
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(10, 20, 10);
    directional.castShadow = true;
    scene.add(directional);

    // 2. Ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 3. Boundary Walls
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const wallHeight = 10;
    
    const wallGeoms = [
        { size: [100, wallHeight, 1], pos: [0, wallHeight/2, -50] }, // Back
        { size: [100, wallHeight, 1], pos: [0, wallHeight/2, 50] },  // Front
        { size: [1, wallHeight, 100], pos: [-50, wallHeight/2, 0] }, // Left
        { size: [1, wallHeight, 100], pos: [50, wallHeight/2, 0] }   // Right
    ];

    wallGeoms.forEach(cfg => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(...cfg.size), wallMaterial);
        wall.position.set(...cfg.pos);
        scene.add(wall);
        obstacles.push(wall);
    });

    // 4. Platforms & Covers
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const platformConfigs = [
        { size: [10, 2, 10], pos: [15, 1, 15] },
        { size: [8, 4, 8], pos: [-20, 2, -20] },
        { size: [12, 1, 6], pos: [0, 0.5, -30] },
        { size: [5, 3, 5], pos: [30, 1.5, -10] }
    ];

    platformConfigs.forEach(cfg => {
        const platform = new THREE.Mesh(new THREE.BoxGeometry(...cfg.size), platformMaterial);
        platform.position.set(...cfg.pos);
        scene.add(platform);
        obstacles.push(platform);
    });

    // 5. Moving Targets
    for (let i = 0; i < 15; i++) {
        const size = 1.5;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
        const target = new THREE.Mesh(geometry, material);

        const spawnRange = 40;
        target.position.set(
            (Math.random() - 0.5) * spawnRange,
            Math.random() * 5 + 1,
            (Math.random() - 0.5) * spawnRange
        );

        target.userData = {
            originalColor: 0x00ff00,
            isTarget: true,
            baseScale: 1,
            hitTimer: 0,
            isMoving: i < 10, // 10 moving targets
            moveAxis: Math.random() > 0.5 ? 'x' : 'z',
            moveDir: 1,
            moveSpeed: Math.random() * 5 + 2,
            moveRange: Math.random() * 10 + 5,
            startPos: target.position[Math.random() > 0.5 ? 'x' : 'z'] // roughly
        };
        
        target.userData.startPos = (target.userData.moveAxis === 'x') ? target.position.x : target.position.z;

        scene.add(target);
        targets.push(target);
    }
}

export function updateWorld(game, dt) {
    targets.forEach(target => {
        // 1. Feedback Recovery (Color & Scale)
        if (target.userData.hitTimer > 0) {
            target.userData.hitTimer -= dt;
            if (target.userData.hitTimer <= 0) {
                target.material.color.set(target.userData.originalColor);
            }
        }
        
        // Recover scale
        const targetScale = target.userData.baseScale;
        if (target.scale.x > targetScale) {
            const newScale = Math.max(targetScale, target.scale.x - 2 * dt);
            target.scale.setScalar(newScale);
        }

        // 2. Linear Movement
        if (target.userData.isMoving) {
            const axis = target.userData.moveAxis;
            const currentPos = target.position[axis];
            const startPos = target.userData.startPos;
            const range = target.userData.moveRange;
            
            target.position[axis] += target.userData.moveSpeed * target.userData.moveDir * dt;
            
            if (Math.abs(target.position[axis] - startPos) > range) {
                target.userData.moveDir *= -1;
            }
        }
    });
}

