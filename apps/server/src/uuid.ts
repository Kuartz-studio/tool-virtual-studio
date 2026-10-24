// Un identifiant uuid bien formé. Les colonnes `uuid` de Postgres refusent tout le reste avec une erreur (22P02) : un identifiant venu d'une URL se
// vérifie avant d'aller en base, pour répondre « introuvable » et non une erreur du serveur.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);
