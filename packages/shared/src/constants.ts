// Valeurs de la spec : une seule source pour le client et le serveur.
export const TILE_SIZE = 32;
export const MAX_SPEED_PX_PER_S = 160;
export const MOVE_TOLERANCE = 1.5;
export const MOVE_JITTER_MS = 250;
export const MOVE_SEGMENT_STEP_PX = 8;
export const CLIENT_MOVE_MAX_HZ = 10;
export const WORLD_TICK_MS = 100;
export const REMOTE_RENDER_DELAY_MS = 100;
export const TELEPORT_SNAP_PX = 3 * TILE_SIZE;
export const GROUPS_TICK_MS = 250;
export const JOIN_DISTANCE_PX = 3 * TILE_SIZE;   // « à moins de 3 cases » : d < JOIN
export const LEAVE_DISTANCE_PX = 4 * TILE_SIZE;  // « au-delà de 4 cases » : on reste tant que d <= LEAVE
export const GROUP_DEBOUNCE_MS = 500;
export const DISCONNECT_GRACE_MS = 10_000;
export const POSITION_SAVE_INTERVAL_MS = 60_000;
export const CHAT_MAX_LENGTH = 500;
export const CHAT_HISTORY_LIMIT = 200;
export const CHAT_RATE = { max: 5, windowMs: 5_000 };
export const SOCKET_CONNECT_RATE = { max: 10, windowMs: 60_000 };
export const MOVE_RATE = { max: 20, windowMs: 1_000 };          // au-delà, les `move` d'une socket sont ignorés
export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const SESSION_TTL_S = 30 * 24 * 3600;
export const LIVEKIT_TOKEN_TTL_S = 600;
export const OFFICE_ROOM = 'office';
