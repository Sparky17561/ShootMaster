export const CONFIG = {
    // Movement
    WALK_SPEED: 18.0,
    ACCELERATION: 8.0,
    FRICTION: 6.0,
    AIR_RESISTANCE: 1.5,
    JUMP_FORCE: 28.0,
    GRAVITY: 100.0,
    MAP_BOUNDARY: 149.0, // Ground is 300x300 (-150 to 150)

    // Crouch Mechanic
    CROUCH_HEIGHT: 1.0,
    CROUCH_SPEED_MOD: 0.5,

    // Slide Mechanic
    SLIDE_IMPULSE: 15.0,
    SLIDE_MAX_DURATION: 0.8,
    SLIDE_COOLDOWN: 1.5,
    SLIDE_FRICTION: 2.0,
    SLIDE_THRESHOLD: 15.0, 
    SLIDE_FOV_MOD: 10,       
    SLIDE_TILT: 0.05,       

    // Step-Up (Stair Climbability)
    STEP_HEIGHT: 0.25,

    // Mouse
    MOUSE_SENSITIVITY: 0.002,
    MOUSE_SMOOTHING: 0.1,

    // Trackpad Mode
    TRACKPAD_SENSITIVITY: 0.0012,
    TRACKPAD_SMOOTHING: 0.1,
    DELTA_SPIKE_THRESHOLD: 100, 

    // Gameplay Loop
    RESPAWN_DELAY: 2.0,
    MIN_SPAWN_DISTANCE: 15.0,
    DEATH_ANIMATION_SPEED: 10.0,
    // Weapons
    WEAPONS: {
        PISTOL: {
            name: 'Pistol',
            damage: 34,
            fireRate: 0.3,
            magSize: 12,
            ammo: 12,
            reserve: Infinity,
            isAutomatic: false,
            spread: 0.005,
            recoil: 0.05,
            reloadTime: 1.5
        },
        RIFLE: {
            name: 'Auto Rifle',
            damage: 22,
            fireRate: 0.1,
            magSize: 30,
            ammo: 30,
            reserve: 90,
            isAutomatic: true,
            spread: 0.015,
            recoil: 0.04, // Reduced from 0.08
            reloadTime: 2.0
        },
        SHOTGUN: {
            name: 'Shotgun',
            damage: 15,
            pellets: 8,
            fireRate: 0.8,
            magSize: 6,
            ammo: 6,
            reserve: 18,
            isAutomatic: false,
            spread: 0.12,
            recoil: 0.25,
            reloadTime: 3.0
        },
        GRENADE: {
            name: 'Grenade',
            damage: 200,
            radius: 15,
            fuse: 2.0,
            tossForce: 25.0,
            count: 3
        }
    },
    // Visual Effects
    TRAJECTORY_POINTS: 30,
    GRENADE_GRAVITY: -22,
    SCREEN_SHAKE_DECAY: 0.9,
    HIT_FLASH_DURATION: 0.15,

    // Pickups
    PICKUP_HEALTH_VALUE: 25,
    PICKUP_SPAWN_COUNT: 4,
    PICKUP_RESPAWN_TIME: 15.0,

    FOV_BASE: 75,
    FOV_ADS: 45,
    ADS_LERP_SPEED: 10,
    
    // Hit Marker
    HIT_COOLDOWN: 0.1, 

    // Bots
    BOT_COUNT: 15,
    BOT_HEALTH: 100,
    BOT_SPEED: 5.5,
    BOT_STRAFE_SPEED: 3.5,
    BOT_DETECTION_RANGE: 50.0,
    BOT_STOP_DISTANCE: 12.0,
    BOT_SHOOT_INTERVAL: 2.5,
    BOT_REACTION_MIN: 0.4,
    BOT_REACTION_MAX: 1.2,
    BOT_DAMAGE: 15,
    BOT_AIM_SPREAD: 0.1, // Radians of spread
    BOT_ROTATION_SPEED: 8.0,
    BOT_HEIGHT: 2.2,
    BOT_RADIUS: 0.7,
    BOT_AIM_TIME: 0.8,
    LASER_COLOR: 0xff0000,
    TRACER_DURATION: 0.15,
    TRACER_COLOR: 0xffff00,

    // Mechanics
    PLAYER_HEIGHT: 1.8,
    PLAYER_WIDTH: 0.8,
    PLAYER_RESPAWN_TIME: 3.0,
    RESPAWN_DELAY: 5.0,
    FIXED_UPDATE_RATE: 1 / 60, // 60Hz
};

