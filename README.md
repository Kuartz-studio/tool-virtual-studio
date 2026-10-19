# Bureau virtuel

Un bureau virtuel en vue de dessus, dans l'esprit de Gather : chaque personne a un avatar qui se promène dans les locaux, voit les autres bouger, et parle en audio et en vidéo avec celles qui sont à proximité. Statuts, chat et salles privées complètent l'ensemble. L'inscription se fait uniquement sur invitation, et l'interface est en français.

C'est un monorepo pnpm. Le paquet `@bureau/shared` (`packages/shared`) regroupe les constantes et le protocole utilisés par le client et le serveur. La conception est décrite dans `docs/conception.md`.

## Commandes

Prérequis : Node 22.12 ou plus récent, et pnpm 10.

```sh
pnpm install     # installer les dépendances
pnpm test        # lancer les tests (Vitest)
pnpm typecheck   # vérifier les types (TypeScript)
```

Les tests du serveur tournent sur 2 processus Vitest au plus (`apps/server/vitest.config.ts`) : chaque base PGlite en mémoire occupe environ 1 Go de RAM, et sans cette limite une machine à beaucoup de cœurs sature la mémoire.

## Premier admin

L'inscription se fait sur invitation, et les invitations se créent depuis le panneau d'administration : le premier admin naît donc d'une commande, qui crée une invitation admin et en affiche le lien.

```sh
pnpm --filter @bureau/server admin:invite <adresse e-mail>
```

Elle lit la même configuration que le serveur : les variables d'environnement, et le `.env` de la racine quand elle est lancée par `pnpm`. Avec `MAILER=resend`, l'e-mail part ; avec `MAILER=memory`, rien ne part, et le lien affiché est la seule porte d'entrée. Avec une base `pglite://`, arrêter d'abord `pnpm dev` : deux processus sur le même dossier perdent des écritures. Compilée (`pnpm build`), elle se lance avec `node apps/server/dist/cli/admin-invite.js <adresse e-mail>`, sans lire de `.env`.

## Base de données

Le schéma est dans `apps/server/src/db/schema.ts`. Les tables de Better Auth (`src/db/auth-schema.ts`) sont générées par sa CLI à partir de `src/auth/auth.cli.ts` : ce fichier ne se modifie pas à la main. Après un changement de schéma, depuis `apps/server` :

```sh
npx auth@1.7.11 generate --config src/auth/auth.cli.ts --output src/db/auth-schema.ts --yes   # si la configuration de Better Auth a changé (même version que better-auth)
pnpm db:generate                                                                              # nouvelle migration dans drizzle/
```

Avec PGlite (`memory://`, `pglite://`), le serveur applique les migrations au démarrage. Avec PostgreSQL, `node dist/migrate.js` les applique avant le lancement du serveur, et échoue si le dossier `drizzle/` manque.
