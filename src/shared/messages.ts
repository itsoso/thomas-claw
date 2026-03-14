import { ChatSuggestionItem, DanmakuMessage, LiveRoomContext, Streamer } from './types';

// ─── Message types ───

export type MessageType =
  | 'GET_STREAMERS'
  | 'ADD_STREAMER'
  | 'REMOVE_STREAMER'
  | 'STREAMER_STATUS_UPDATE'
  | 'GET_ROOM_CONTEXT'
  | 'ROOM_CONTEXT_UPDATE'
  | 'DANMAKU_UPDATE'
  | 'GENERATE_SUGGESTIONS'
  | 'FILL_DANMAKU'
  | 'LOG_INTERACTION'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS';

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

// ─── Payload types ───

export interface AddStreamerPayload {
  roomId: string;
  nickname: string;
}

export interface RemoveStreamerPayload {
  roomId: string;
}

export interface StreamerStatusPayload {
  streamers: Streamer[];
}

export interface RoomContextPayload {
  context: LiveRoomContext;
}

export interface DanmakuUpdatePayload {
  messages: DanmakuMessage[];
}

export interface GenerateSuggestionsPayload {
  context: LiveRoomContext;
}

export interface SuggestionsResultPayload {
  suggestions: ChatSuggestionItem[];
}

export interface FillDanmakuPayload {
  text: string;
}

export interface LogInteractionPayload {
  roomId: string;
  streamerName: string;
  content: string;
}

// ─── Helpers ───

export function sendMessage<T = unknown>(
  message: Message<T>,
): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

export function sendTabMessage<T = unknown>(
  tabId: number,
  message: Message<T>,
): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

export function onMessage(
  handler: (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => boolean | void,
): void {
  chrome.runtime.onMessage.addListener(handler);
}
