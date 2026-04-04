export const CONFIG = {
    // Movement
    WALK_SPEED: 96.0,
    ACCELERATION: 15.0,
    FRICTION: 6.0,
    AIR_RESISTANCE: 1.5,
    JUMP_FORCE: 35.0,
    GRAVITY: 100.0,

    // Crouch Mechanic
    CROUCH_HEIGHT: 1.0,
    CROUCH_SPEED_MOD: 0.5,

    // Slide Mechanic
    SLIDE_IMPULSE: 15.0,
    SLIDE_MAX_DURATION: 0.8,
    SLIDE_COOLDOWN: 1.5,
    SLIDE_FRICTION: 2.0,
    SLIDE_THRESHOLD: 60.0, // Lowered to make sliding easier to trigger
    SLIDE_FOV_MOD: 10,       // Gain 10 FOV during slide
    SLIDE_TILT: 0.05,       // Camera tilt in radians

    // Step-Up
    STEP_HEIGHT: 0.5,

    // Mouse
    MOUSE_SENSITIVITY: 0.002,
    MOUSE_SMOOTHING: 0.1,

    // Trackpad Mode
    TRACKPAD_SENSITIVITY: 0.0012,
    TRACKPAD_SMOOTHING: 0.1,
    DELTA_SPIKE_THRESHOLD: 100, // Ignore movement deltas larger than 100px

    // Gameplay Loop
    DAMAGE_PER_SHOT: 100,
    RESPAWN_DELAY: 2.0,
    MIN_SPAWN_DISTANCE: 15.0,
    DEATH_ANIMATION_SPEED: 10.0,

    // Weapon
    FOV_BASE: 75,
    FOV_ADS: 45,
    ADS_LERP_SPEED: 10,
    RECOIL_KICK: 0.05,
    RECOIL_RANDOM_HORIZONTAL: 0.02,
    RECOIL_RECOVERY_SPEED: 5,
    
    // Hit Marker
    HIT_COOLDOWN: 0.1, // 100ms

    // Mechanics
    PLAYER_HEIGHT: 1.8,
    PLAYER_WIDTH: 0.6,
    FIXED_UPDATE_RATE: 1 / 60, // 60Hz
};

