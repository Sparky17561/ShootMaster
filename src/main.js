import { showMainMenu } from './menu.js';
import Game from './Game.js';

window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    window.game = game;

    showMainMenu((profile) => {
        game.startGame(profile);
    });
});
