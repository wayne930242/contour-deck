/** Interface text of the remote: the panel on the deck, the phone, and the presenter window. Traditional Chinese by default. */
import type { CalibrationTarget } from "./tilt.js";

export interface RemoteLabels {
  title: string;
  close: string;
  /* panel on the deck */
  remoteQr: string;
  remoteHint: string;
  notesQr: string;
  /** Names the switch between the two QR codes. */
  qrMode: string;
  notesHint: string;
  noRelay: string;
  relayConnecting: string;
  relayOpen: string;
  relayClosed: string;
  roomTaken: string;
  /** Name of the bar button while another tab holds the room. */
  roomTakenBar: string;
  /** Takes the room back for this tab. */
  useThisWindow: string;
  request: string;
  /** Name of the bar button while phones wait for an answer. */
  waiting(count: number): string;
  code: string;
  allow: string;
  deny: string;
  paired: string;
  pairedOffline: string;
  revoke: string;
  presenter: string;
  timer: string;
  resetTimer: string;
  end: string;
  /* phone */
  connecting: string;
  connected: string;
  offline: string;
  pairHint: string;
  denied: string;
  revoked: string;
  retry: string;
  noHost: string;
  full: string;
  badLink: string;
  notesOnly: string;
  leave: string;
  slidePrev: string;
  slideNext: string;
  tabNotes: string;
  tabPointer: string;
  tabInk: string;
  tabTilt: string;
  upNext: string;
  nextStep: string;
  nextPage: string;
  nextSlide: string;
  theEnd: string;
  inOverview: string;
  block: string;
  pointerHint: string;
  inkHint: string;
  clearInk: string;
  tiltEnable: string;
  tiltDenied: string;
  tiltUnsupported: string;
  tiltHold: string;
  tiltRecentre: string;
  tiltCalibrate: string;
  tiltUncalibrated: string;
  tiltCalibrated: string;
  tiltAim(target: string, index: number, count: number): string;
  tiltAimed: string;
  tiltCancel: string;
  tiltBad: string;
  tiltTargets: Record<CalibrationTarget, string>;
  /* presenter window */
  now: string;
  noDeck: string;
}

export const defaultRemoteLabels: RemoteLabels = {
  title: "遙控",
  close: "關閉",
  remoteQr: "手機遙控",
  remoteHint: "掃描後手機會顯示確認碼，在這裡按允許才能控制。",
  notesQr: "講稿",
  qrMode: "QR 碼用途",
  notesHint: "手機自己翻頁的講稿，不需要連線。",
  noRelay: "這個頁面沒有設定中繼服務，手機無法遙控；講稿與講者視窗仍可使用。",
  relayConnecting: "中繼連線中",
  relayOpen: "中繼已連線",
  relayClosed: "中繼離線，重試中",
  roomTaken: "房間已被另一個視窗使用",
  roomTakenBar: "遙控：房間已被另一個視窗使用",
  useThisWindow: "改用這個視窗",
  request: "有手機要求控制",
  waiting: count => `遙控：${count} 支手機等待允許`,
  code: "確認碼",
  allow: "允許",
  deny: "拒絕",
  paired: "手機已配對",
  pairedOffline: "手機已配對，目前離線",
  revoke: "收回控制",
  presenter: "開啟講者視窗",
  timer: "計時",
  resetTimer: "重設",
  end: "結束遙控",
  connecting: "連線中…",
  connected: "已連線",
  offline: "離線，重試中",
  pairHint: "請在電腦上核對這組數字，再按「允許」。",
  denied: "電腦沒有允許這支手機。",
  revoked: "電腦收回了控制權。",
  retry: "重新要求控制",
  noHost: "找不到簡報：電腦還沒開啟遙控，或已經關閉。重試中…",
  full: "已有太多裝置連上這場簡報。等有人離開後再試一次。",
  badLink: "這個連結無法遙控，請重新掃描電腦上的 QR。",
  notesOnly: "只看講稿",
  leave: "離開",
  slidePrev: "上一張",
  slideNext: "下一張",
  tabNotes: "講稿",
  tabPointer: "紅點",
  tabInk: "畫筆",
  tabTilt: "傾斜",
  upNext: "接下來",
  nextStep: "要點",
  nextPage: "往下",
  nextSlide: "下一張",
  theEnd: "結尾",
  inOverview: "輪廓",
  block: "區塊",
  pointerHint: "在縮圖上拖曳，螢幕上會出現紅點。",
  inkHint: "在縮圖上畫線；換頁時會清除。",
  clearInk: "清除筆跡",
  tiltEnable: "啟用傾斜感測",
  tiltDenied: "沒有取得動作感測的權限，請到瀏覽器設定允許後再試。",
  tiltUnsupported: "這個裝置或瀏覽器沒有提供方向感測。",
  tiltHold: "按住指向",
  tiltRecentre: "重新置中",
  tiltCalibrate: "校正",
  tiltUncalibrated: "尚未校正：按住時手機的方向當作螢幕中央。",
  tiltCalibrated: "已校正。指標偏掉時，對準螢幕中央按「重新置中」。",
  tiltAim: (target, index, count) => `${index}/${count}　把手機頂端對準螢幕的${target}`,
  tiltAimed: "對準了",
  tiltCancel: "取消",
  tiltBad: "範圍太小或方向不一致，請重新校正。",
  tiltTargets: { centre: "中央", topLeft: "左上角", topRight: "右上角", bottomRight: "右下角", bottomLeft: "左下角" },
  now: "目前",
  noDeck: "等待簡報視窗…",
};
