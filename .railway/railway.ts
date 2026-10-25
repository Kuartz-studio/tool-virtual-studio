// Les réglages du service Railway (« Infrastructure as Code »), qui remplacent railway.json. Ce fichier n'est pas lu au
// déploiement : `railway config plan` montre ce qu'il changerait sur Railway, `railway config apply` l'applique (README,
// « Déployer »). Ce qu'il ne cite pas reste réglé dans le tableau de bord de Railway (« Wait for CI », réplicas, domaine).
import { defineRailway, github, project, service } from "railway/iac";

// Ce dépôt ne gère que son propre service : la base PostgreSQL et son volume restent hors de ce fichier, et Railway n'y touche
// pas. Sans cette ligne, le fichier décrirait tout le projet, et la base, absente, serait supprimée.
export const partial = "tool-virtual-studio";

export default defineRailway(() => {
  const toolVirtualStudio = service("tool-virtual-studio", {
    // Sans source, Railway détacherait le service du dépôt.
    source: github("Kuartz-studio/tool-virtual-studio", { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    // Les migrations, puis le serveur. /bin/sh -c parce que Railway lance la commande d'une image Docker sans shell.
    start: "/bin/sh -c \"node apps/server/dist/migrate.js && exec node apps/server/dist/index.js\"",
    healthcheck: "/api/health",
    // 30 s entre SIGTERM et SIGKILL (0 s sans réglage) : le temps d'enregistrer les positions et de tout fermer. Le redémarrage
    // n'y est pas : ON_FAILURE avec 10 essais, celui de railway.json, est le réglage par défaut, que Railway n'enregistre pas
    // (écrit ici, le plan le montrerait toujours à changer).
    deploy: { drainingSeconds: 30 },
  });

  // Les variables restent celles du tableau de bord de Railway : ce fichier ne les lit ni ne les change.
  return project("unique-courtesy", {
    variables: { managed: false },
    resources: [toolVirtualStudio],
  });
});
