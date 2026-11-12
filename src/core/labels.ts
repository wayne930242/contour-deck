import type { Labels } from "./types.js";

export const defaultLabels: Labels = {
  overview: "輪廓",
  notes: "講稿",
  script: "提詞",
  threeD: "3D",
  prev: "上一步",
  next: "下一步",
  exit: "離開簡報",
  remote: "遙控",
  here: "目前位置",
  appendix: "書面",
  rail: "整份簡報的位置",
  noNotes: "（這一頁沒有講稿）",
  slides: count => `${count} 張`,
  pages: count => `${count} 頁`,
  minutes: count => `約 ${count} 分`,
  page: (index, count) => `頁 ${index}/${count}`,
  steps: (shown, count) => `要點 ${shown}/${count}`,
  thumb: (block, slide, title, pages) => `${block}，第 ${slide} 張：${title}${pages > 1 ? `，${pages} 頁` : ""}`,
};
