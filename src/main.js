import Game from './Game.js';

// Entry point
window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    
    // Debug helper
    window.game = game;
});
