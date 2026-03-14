import {
  Streamer,
  InteractionRecord,
  UserSettings,
  DEFAULT_SETTINGS,
} from './types';

const KEYS = {
  STREAMERS: 'streamers',
  INTERACTIONS: 'interactions',
  SETTINGS: 'settings',
} as const;

// ─── Streamers ───

export async function getStreamers(): Promise<Streamer[]> {
  const result = await chrome.storage.local.get(KEYS.STREAMERS);
  return result[KEYS.STREAMERS] ?? [];
}

export async function saveStreamers(streamers: Streamer[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.STREAMERS]: streamers });
}

export async function addStreamer(
  streamer: Omit<Streamer, 'isLive' | 'addedAt'>,
): Promise<Streamer[]> {
  const list = await getStreamers();
  if (list.some((s) => s.roomId === streamer.roomId)) return list;
  const newStreamer: Streamer = {
    ...streamer,
    isLive: false,
    addedAt: Date.now(),
  };
  const updated = [...list, newStreamer];
  await saveStreamers(updated);
  return updated;
}

export async function removeStreamer(roomId: string): Promise<Streamer[]> {
  const list = await getStreamers();
  const updated = list.filter((s) => s.roomId !== roomId);
  await saveStreamers(updated);
  return updated;
}

export async function updateStreamerStatus(
  roomId: string,
  isLive: boolean,
): Promise<void> {
  const list = await getStreamers();
  const idx = list.findIndex((s) => s.roomId === roomId);
  if (idx === -1) return;
  list[idx].isLive = isLive;
  if (isLive) list[idx].lastLiveAt = Date.now();
  await saveStreamers(list);
}

// ─── Interactions ───

export async function getInteractions(): Promise<InteractionRecord[]> {
  const result = await chrome.storage.local.get(KEYS.INTERACTIONS);
  return result[KEYS.INTERACTIONS] ?? [];
}

export async function addInteraction(
  record: Omit<InteractionRecord, 'id'>,
): Promise<void> {
  const list = await getInteractions();
  const newRecord: InteractionRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  list.push(newRecord);
  // 只保留最近 1000 条
  if (list.length > 1000) list.splice(0, list.length - 1000);
  await chrome.storage.local.set({ [KEYS.INTERACTIONS]: list });
}

// ─── Settings ───

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[KEYS.SETTINGS] ?? {}) };
}

export async function saveSettings(
  settings: Partial<UserSettings>,
): Promise<UserSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [KEYS.SETTINGS]: updated });
  return updated;
}
