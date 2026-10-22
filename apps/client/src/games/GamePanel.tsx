import { useEffect, useState } from 'react';
import { fr } from '../i18n/fr';
import { sendGameCommand } from '../net/game-commands';
import type { OfficeSocket } from '../net/socket';
import { RulesIcon } from '../office/icons';
import { Drawer } from '../office/ui/Drawer';
import { IconButton } from '../office/ui/IconButton';
import { useOfficeStore } from '../state/office-store';
import { GameFrame } from './GameFrame';
import { useGameModule } from './use-game-module';

// Le panneau d'une table de jeu (le jeu que dit le magasin : `gameOpen`) : le nom du jeu, le bouton « Règles », « Fermer », et le cadre commun (GameFrame). Il s'ouvre par la
// touche E devant la table, un clic sur elle, ou en acceptant une invitation. Tant qu'il est ouvert, la personne regarde la table (`watch`) si elle n'y est pas assise, et le dit
// au serveur ; fermé, elle ne la regarde plus (`unwatch`).
export function GamePanel({ id, socket, onClose }: { id?: string; socket: OfficeSocket | null; onClose(): void }) {
  const game = useOfficeStore((state) => state.gameOpen);
  const ready = useOfficeStore((state) => state.ready);
  const [rulesOpen, setRulesOpen] = useState(false);
  const module = useGameModule(game);

  useEffect(() => {
    if (game === null || !ready) return;
    void sendGameCommand(socket, { type: 'watch', game });
    return () => {
      void sendGameCommand(socket, { type: 'unwatch', game });
    };
  }, [game, ready, socket]);

  // Une autre table : l'aide se referme.
  useEffect(() => setRulesOpen(false), [game]);

  if (game === null) return null;
  return (
    <Drawer
      title={fr.games.names[game]}
      onClose={onClose}
      id={id}
      className="game-drawer"
      actions={
        module.status === 'ready' ? (
          <IconButton label={fr.games.rules} small tip="bottom" pressed={rulesOpen} onClick={() => setRulesOpen(!rulesOpen)}>
            <RulesIcon />
          </IconButton>
        ) : undefined
      }
    >
      <GameFrame game={game} socket={socket} module={module} rulesOpen={rulesOpen} />
    </Drawer>
  );
}
