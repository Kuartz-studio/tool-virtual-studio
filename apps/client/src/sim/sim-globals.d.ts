// Le faux live est-il compilé dans ce client ? Vrai seulement avec VITE_SIM=1 (`pnpm dev:sim`). Vite remplace __SIM__ par true ou false
// à la compilation (vite.config.ts) : sans le faux live, `if (__SIM__)` devient `if (false)` et Rollup retire le panneau, le faux
// transport et le glisser-déposer du build.
declare const __SIM__: boolean;
