// Recharge la page, depuis le serveur : après un déploiement, index.html (revalidé à chaque visite) pointe vers les nouveaux fichiers.
// À part, pour que les tests le remplacent (happy-dom ne recharge rien).
export function reloadPage(): void {
  window.location.reload();
}
