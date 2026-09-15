import type { DemoCatalog } from './catalog-en.js';

/**
 * 简体中文 (Simplified Chinese).
 *
 * Chinese has a single CLDR plural category, so every plural message declares
 * only `other` — and the same `{count}` placeholder still goes through the
 * locale's number formatter.
 */
export const zhCN: DemoCatalog = {
  'app.title': 'CoSlate — 演示白板',
  'app.description': 'CoSlate 演示：一个可嵌入的开放交互场景运行时——提供白板内核，而不是完整产品。',

  'group.tools': '工具',
  'group.history': '历史',
  'group.zoom': '缩放',
  'group.selection': '选中对象',
  'group.file': '文件',
  'group.style': '样式',
  'group.language': '语言',

  'tool.select.label': '选择',
  'tool.pen.label': '画笔',
  'tool.eraser.label': '橡皮擦',
  'tool.rect.label': '矩形',
  'tool.ellipse.label': '椭圆',
  'tool.line.label': '直线',
  'tool.arrow.label': '箭头',
  'tool.text.label': '文本',
  'text.placeholder': '输入文字…',
  'text.ariaLabel': '编辑文字',

  'action.undo': '撤销',
  'action.redo': '重做',
  'action.delete': '删除选中对象',
  'action.duplicate': '复制选中对象',
  'action.front': '移到最前',
  'action.back': '移到最后',

  'zoom.out': '缩小',
  'zoom.in': '放大',
  'zoom.fit': '适应画布',
  'zoom.reset': '重置为 100%',

  'file.exportPng': '导出 PNG',
  'file.saveJson': '保存为 JSON',
  'file.loadJson': '从 JSON 载入',
  'file.saveBaseline': '保存基线',
  'file.loadBaseline': '载入基线',
  'file.clear': '清空画布',

  'style.stroke': '描边 {color}',
  'style.strokeCustom': '自定义描边颜色',
  'style.width': '线宽 {width} 像素',
  'style.fill.none': '无填充',
  'style.fill.white': '白色填充',
  'style.fill.panel': '面板色填充',
  'style.fillCustom': '自定义填充颜色',

  'status.tool': '工具',
  'status.selection': '已选',
  'status.objects': '对象',
  'status.zoom': '缩放',

  'status.saved': '已保存',
  'status.newScene': '新建场景',
  'status.restored': { other: '已恢复 {count} 个对象' },
  'status.cleared': '已清空',
  'status.downloaded': '已下载 {file}',
  'status.loaded': '已载入 {file}',
  'status.loadFailed': '载入失败：{error}',
  'status.baselineLoaded': '已载入基线（{file}）',
  'status.baselineEmpty': '未应用基线：{reason}',
  'status.restoreFailed': '恢复失败：{error}',
  'status.autosaveFailed': '自动保存失败：{error}',

  'status.undo': '撤销',
  'status.redo': '重做',
  'status.copied': { other: '已复制 {count} 个对象' },
  'status.pasted': { other: '已粘贴 {count} 个对象' },
  'status.duplicated': { other: '已生成 {count} 个副本' },

  'language.label': '语言',
};
