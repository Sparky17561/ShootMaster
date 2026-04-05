import * as THREE from 'three';
import { playerHitboxes } from './world.js';

/**
 * RemotePlayer — Renders another player as a colored cube with name label
 * Uses interpolation for smooth movement
 */
export class RemotePlayer {
    constructor(scene, playerData) {
        this.scene = scene;
        this.id = playerData.id;
        this.name = playerData.name || 'Unknown';
        this.skinColor = playerData.skinColor || '#00aaff';
        this.score = playerData.score || 0;
        this.health = playerData.health || 100;
        this.isAiming = false;

        // Interpolation state
        this._currentPos = new THREE.Vector3(
            playerData.position?.x || 0,
            playerData.position?.y || 2,
            playerData.position?.z || 0
        );
        this._targetPos = this._currentPos.clone();
        this._currentYaw = playerData.rotation?.yaw || 0;
        this._targetYaw = this._currentYaw;

        this._build();
    }

    _build() {
        // Body cube
        const bodyGeom = new THREE.BoxGeometry(0.8, 1.6, 0.8);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(this.skinColor),
            emissive: new THREE.Color(this.skinColor),
            emissiveIntensity: 0.2
        });
        this.mesh = new THREE.Mesh(bodyGeom, bodyMat);
        this.mesh.castShadow = true;
        this.mesh.userData.playerId = this.id;
        this.mesh.userData.isRemotePlayer = true;

        // Head
        const headGeom = new THREE.BoxGeometry(0.7, 0.7, 0.7);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xffcc88 });
        this.headMesh = new THREE.Mesh(headGeom, headMat);
        this.headMesh.position.set(0, 1.15, 0);
        this.headMesh.userData.isRemoteHead = true;
        this.headMesh.userData.isRemotePlayer = true;
        this.headMesh.userData.playerId = this.id;
        this.mesh.add(this.headMesh);

        // Name label (canvas texture)
        this._nameLabel = this._createNameLabel(this.name, this.skinColor);
        this._nameLabel.position.set(0, 2.2, 0);
        this.mesh.add(this._nameLabel);

        this.mesh.position.copy(this._currentPos);
        this.scene.add(this.mesh);

        // Register for Host AI detection
        playerHitboxes.push(this.mesh);
    }

    _createNameLabel(name, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.roundRect(4, 4, 248, 56, 8);
        ctx.fill();

        // Text
        ctx.font = 'bold 28px Rajdhani, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(name.slice(0, 16), 128, 42);

        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.5, 0.65, 1);
        return sprite;
    }

    setTarget(position, rotation, health, isAiming, isInvulnerable) {
        this._targetPos.set(position.x, position.y, position.z);
        this._targetYaw = rotation.yaw;
        this.health = health !== undefined ? health : this.health;
        this.isAiming = !!isAiming;
        this.isInvulnerable = !!isInvulnerable;
    }

    update(dt) {
        // Smooth interpolation
        const alpha = Math.min(1, 15 * dt);
        this._currentPos.lerp(this._targetPos, alpha);
        this.mesh.position.copy(this._currentPos);

        // Smooth yaw rotation
        const dy = this._targetYaw - this._currentYaw;
        this._currentYaw += dy * alpha;
        this.mesh.rotation.y = this._currentYaw;

        // --- Tactical Laser Sight ---
        if (this.isAiming && this.health > 0) {
            if (!this._laserLine) {
                const geom = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 1.15, 0), // from head height
                    new THREE.Vector3(0, 1.15, -50) // forward (Z-) 50m
                ]);
                const mat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
                this._laserLine = new THREE.Line(geom, mat);
                this.scene.add(this._laserLine);
            }
            this._laserLine.position.copy(this._currentPos);
            this._laserLine.rotation.y = this._currentYaw;
            this._laserLine.visible = true;
        } else if (this._laserLine) {
            this._laserLine.visible = false;
        }

        // --- Invulnerability Shield Visual ---
        if (this.mesh && this.mesh.material) {
            if (this.isInvulnerable) {
                // Flash white
                this.mesh.material.emissive.set(0xffffff);
                this.mesh.material.emissiveIntensity = 1.0;
            } else {
                // Restore original color
                this.mesh.material.emissive.set(this.skinColor);
                this.mesh.material.emissiveIntensity = 0.2;
            }
        }
    }

    dispose() {
        this.scene.remove(this.mesh);
        
        // Remove from global registry
        const idx = playerHitboxes.indexOf(this.mesh);
        if (idx > -1) playerHitboxes.splice(idx, 1);

        this.mesh.traverse(c => {
            if (c.geometry) c.geometry.dispose();
            if (c.material) {
                if (c.material.map) c.material.map.dispose();
                c.material.dispose();
            }
        });
    }
}
