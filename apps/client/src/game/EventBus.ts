// D'après le modèle officiel phaserjs/template-react-ts (© 2025 Phaser Studio Inc, licence MIT : LICENSE-phaser-template.txt).
import { EventEmitter } from 'eventemitter3';

// Le bus d'événements entre React, la connexion au serveur (net/office-connection.ts) et les scènes Phaser.
//
// Le modèle prend l'EventEmitter de Phaser, qui n'est autre qu'eventemitter3 (la dépendance de Phaser) : on le prend directement.
// Même comportement, sans charger Phaser : la page du bureau ouvre la connexion et remplit le bus avant que le jeu, chargé à part,
// n'existe (et les tests, qui n'ont pas de canevas pour Phaser, peuvent s'en servir).
export const EventBus = new EventEmitter();
