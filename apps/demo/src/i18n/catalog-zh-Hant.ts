import type { DemoCatalog } from './catalog-en.js';

/**
 * 繁體中文 (Traditional Chinese).
 *
 * This catalog exists because "Chinese" is not one locale. A reader in Taipei or
 * Hong Kong asked for `zh-TW` / `zh-HK` / `zh-Hant`, and serving them Simplified
 * text is a worse answer than English would have been — they cannot read it
 * comfortably, and nothing in the UI says the app simply had no Traditional
 * catalog.
 *
 * What makes it resolve correctly is CLDR likely subtags, not a hand-written
 * alias table: `Intl.Locale('zh-TW').maximize()` is `zh-Hant-TW`, which matches
 * this catalog's tag exactly. A bare `zh` maximizes to `zh-Hans-CN` and therefore
 * still lands on `zh-CN`.
 */
export const zhHant: DemoCatalog = {
  'app.title': 'CoSlate — 示範白板',
  'app.description': 'CoSlate 示範：一個可嵌入的開放互動場景執行環境——提供白板核心，而不是完整產品。',

  'group.tools': '工具',
  'group.history': '歷史',
  'group.zoom': '縮放',
  'group.selection': '選取物件',
  'group.file': '檔案',
  'group.style': '樣式',
  'group.language': '語言',

  'tool.select.label': '選取',
  'tool.pen.label': '畫筆',
  'tool.eraser.label': '橡皮擦',
  'tool.rect.label': '矩形',
  'tool.ellipse.label': '橢圓',
  'tool.line.label': '直線',
  'tool.arrow.label': '箭頭',
  'tool.text.label': '文字',
  'text.placeholder': '輸入文字…',
  'text.ariaLabel': '編輯文字',

  'action.undo': '復原',
  'action.redo': '重做',
  'action.delete': '刪除選取物件',
  'action.duplicate': '複製選取物件',
  'action.front': '移到最前',
  'action.back': '移到最後',

  'zoom.out': '縮小',
  'zoom.in': '放大',
  'zoom.fit': '符合畫布',
  'zoom.reset': '重設為 100%',

  'file.exportPng': '匯出 PNG',
  'file.saveJson': '儲存為 JSON',
  'file.loadJson': '從 JSON 載入',
  'file.clear': '清空畫布',

  'style.stroke': '描邊 {color}',
  'style.strokeCustom': '自訂描邊顏色',
  'style.width': '線寬 {width} 像素',
  'style.fill.none': '無填色',
  'style.fill.white': '白色填色',
  'style.fill.panel': '面板色填色',
  'style.fillCustom': '自訂填色',

  'status.tool': '工具',
  'status.selection': '已選',
  'status.objects': '物件',
  'status.zoom': '縮放',

  'status.saved': '已儲存',
  'status.newScene': '新增場景',
  'status.restored': { other: '已還原 {count} 個物件' },
  'status.cleared': '已清空',
  'status.downloaded': '已下載 {file}',
  'status.loaded': '已載入 {file}',
  'status.loadFailed': '載入失敗：{error}',
  'status.restoreFailed': '還原失敗：{error}',
  'status.autosaveFailed': '自動儲存失敗：{error}',

  'status.undo': '復原',
  'status.redo': '重做',
  'status.copied': { other: '已複製 {count} 個物件' },
  'status.pasted': { other: '已貼上 {count} 個物件' },
  'status.duplicated': { other: '已建立 {count} 個副本' },

  'language.label': '語言',
};
