import type { Env } from '../env';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

// Les autres écritures de l'adresse de la machine, pour le faux live (SIM=1) : APP_URL est `http://localhost:3057`, mais Vite affiche
// `http://127.0.0.1:3057` dans son journal, et une page ouverte à cette adresse a une autre origine pour le navigateur : la connexion
// et le temps réel la refuseraient (INVALID_ORIGIN, forbidden_origin) alors que c'est la même appli. Rend les origines de ces alias
// (même schéma, même port), sans celle de APP_URL ; [] sans SIM=1, ou si APP_URL n'est pas une adresse de la machine.
export function simOrigins(env: Pick<Env, 'APP_URL' | 'SIM'>): string[] {
  if (env.SIM !== '1') return [];
  const url = new URL(env.APP_URL);
  if (!(LOOPBACK_HOSTS as readonly string[]).includes(url.hostname)) return [];
  return LOOPBACK_HOSTS.filter((host) => host !== url.hostname).map((host) => `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`);
}
