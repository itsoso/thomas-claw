/** 关注的主播 */
export interface Streamer {
  /** 抖音直播间 ID（URL 中的数字） */
  roomId: string;
  /** 主播昵称 */
  nickname: string;
  /** 主播头像 URL */
  avatar?: string;
  /** 是否正在直播 */
  isLive: boolean;
  /** 最近一次检测到开播的时间 */
  lastLiveAt?: number;
  /** 添加时间 */
  addedAt: number;
}

/** 一条弹幕 */
export interface DanmakuMessage {
  /** 发送者昵称 */
  sender: string;
  /** 弹幕内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
  /** 是否是主播发的 */
  isStreamer: boolean;
}

/** 直播间上下文 */
export interface LiveRoomContext {
  /** 房间 ID */
  roomId: string;
  /** 主播昵称 */
  streamerName: string;
  /** 直播标题 */
  title: string;
  /** 在线人数 */
  viewerCount: number;
  /** 最近弹幕 */
  recentDanmaku: DanmakuMessage[];
}

/** LLM 生成的弹幕建议 */
export interface ChatSuggestionItem {
  /** 建议内容 */
  text: string;
  /** 简短说明（为什么推荐这条） */
  reason?: string;
}

/** 互动记录 */
export interface InteractionRecord {
  id: string;
  /** 主播房间 ID */
  roomId: string;
  /** 主播昵称 */
  streamerName: string;
  /** 发送的弹幕内容 */
  content: string;
  /** 发送时间 */
  timestamp: number;
}

/** 用户设置 */
export interface UserSettings {
  /** API Key */
  claudeApiKey: string;
  /** API Base URL */
  claudeBaseUrl: string;
  /** 轮询间隔（秒） */
  pollInterval: number;
  /** 开播通知开关 */
  notifyOnLive: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  claudeApiKey: process.env.OPENAI_API_KEY as string,
  claudeBaseUrl: 'https://api.openai.com',
  pollInterval: 60,
  notifyOnLive: true,
};
