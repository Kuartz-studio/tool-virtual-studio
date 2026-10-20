# Image de production du Bureau virtuel : un seul processus Node qui sert l'API, le temps réel et le client compilé.
# Railway la construit en ligne (railway.json) : aucun outil du dépôt n'exige Docker en local.

# ---- 1. Compilation -----------------------------------------------------------------------------------------------------
FROM node:24-slim AS build

# pnpm vient de Corepack, à la version du champ « packageManager » de package.json.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Les manifestes d'abord : l'installation, la couche la plus longue, n'est refaite que si les dépendances changent.
# Un nouveau paquet du monorepo s'ajoute ici.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# tsup laisse les dépendances du serveur hors de dist/ (seul @bureau/shared y est compilé) : elles doivent être là à
# l'exécution. `pnpm deploy` réunit les seules dépendances de production du serveur, sans le reste du monorepo.
# --legacy : pnpm 10 refuse `deploy` tant que le monorepo n'active pas inject-workspace-packages, réglage qui changerait aussi
# les installations de développement (@bureau/shared y est lié, pas copié).
RUN pnpm deploy --legacy --filter @bureau/server --prod /prod/server

# ---- 2. Image finale ----------------------------------------------------------------------------------------------------
FROM node:24-slim

# NODE_ENV=production rend les refus de la configuration de production effectifs (base PGlite, E2E, MAILER=memory).
# Le client compilé et les cartes sont servis depuis l'image. Railway fournit PORT ; les variables du service passent avant
# ces valeurs par défaut.
ENV NODE_ENV=production \
    CLIENT_DIST_DIR=/app/apps/client/dist \
    MAPS_DIR=/app/apps/client/dist/assets/maps

WORKDIR /app

# La disposition du dépôt : dist/migrate.js cherche les migrations dans ../drizzle, soit apps/server/drizzle. Le package.json
# du serveur porte "type": "module", sans quoi Node ne lirait pas dist/*.js comme des modules ES.
COPY --from=build /prod/server/package.json apps/server/package.json
COPY --from=build /prod/server/node_modules apps/server/node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/client/dist apps/client/dist

USER node

# Les migrations, puis le serveur. `exec` fait de Node le processus principal du conteneur : c'est lui qui reçoit SIGTERM de
# Railway, et comme processus 1 il ne s'arrête sur ce signal que parce qu'index.ts l'écoute (positions enregistrées, serveur et
# base fermés, puis sortie avec le code 0). railway.json donne la même commande, que Railway préfère à celle-ci.
CMD ["sh", "-c", "node apps/server/dist/migrate.js && exec node apps/server/dist/index.js"]
