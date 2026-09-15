import type { DemoCatalog } from './catalog-en.js';

/**
 * العربية (Arabic) — and the demo's right-to-left proof.
 *
 * Arabic is the reason direction is a first-class property of the translator
 * rather than a CSS afterthought: this catalog flips the whole chrome, so the
 * tool cluster, the style pill and the status line all mirror. It is also the
 * reason plurals are keyed by CLDR category — Arabic uses six, and collapsing
 * them into "singular/plural" would be visibly wrong for 0, 2 and 11.
 *
 * Translations here are a working demonstration, not professionally reviewed
 * copy; corrections are exactly the kind of patch this repo wants.
 */
export const ar: DemoCatalog = {
  'app.title': 'CoSlate — لوحة تجريبية',
  'app.description': 'عرض CoSlate: بيئة تشغيل مشهد تفاعلي مفتوحة — نواة لوح أبيض، لا المنتج بأكمله.',

  'group.tools': 'الأدوات',
  'group.history': 'السجل',
  'group.zoom': 'التكبير',
  'group.selection': 'التحديد',
  'group.file': 'الملف',
  'group.style': 'النمط',
  'group.language': 'اللغة',
  'group.board': 'سطح اللوح',
  'board.white': 'سبورة بيضاء',
  'board.black': 'سبورة سوداء',

  'tool.select.label': 'تحديد',
  'tool.pen.label': 'قلم',
  'tool.eraser.label': 'ممحاة',
  'tool.rect.label': 'مستطيل',
  'tool.ellipse.label': 'بيضاوي',
  'tool.line.label': 'خط',
  'tool.arrow.label': 'سهم',
  'tool.text.label': 'نص',
  'text.placeholder': 'اكتب…',
  'text.ariaLabel': 'تحرير النص',

  'action.undo': 'تراجع',
  'action.redo': 'إعادة',
  'action.delete': 'حذف التحديد',
  'action.duplicate': 'تكرار التحديد',
  'action.front': 'إحضار إلى الأمام',
  'action.back': 'إرسال إلى الخلف',

  'zoom.out': 'تصغير',
  'zoom.in': 'تكبير',
  'zoom.fit': 'ملاءمة المحتوى',
  'zoom.reset': 'إعادة التكبير إلى 100%',

  'file.exportPng': 'تصدير PNG',
  'file.saveJson': 'حفظ بصيغة JSON',
  'file.loadJson': 'تحميل من ملف JSON',
  'file.saveBaseline': 'حفظ الأساس',
  'file.loadBaseline': 'تحميل الأساس',
  'file.clear': 'مسح اللوحة',

  'style.stroke': 'الحد {color}',
  'style.strokeCustom': 'لون حد مخصص',
  'style.width': 'سماكة {width} بكسل',
  'style.lineSolid': 'خط متصل',
  'style.lineDashed': 'خط متقطع',
  'style.lineDashDot': 'خط متقطع منقّط',
  'style.fill.none': 'بلا تعبئة',
  'style.fill.white': 'تعبئة بيضاء',
  'style.fill.panel': 'تعبئة بلون اللوحة',
  'style.fillCustom': 'تعبئة مخصصة',

  'status.tool': 'الأداة',
  'status.selection': 'التحديد',
  'status.objects': 'عناصر',
  'status.zoom': 'التكبير',

  'status.saved': 'تم الحفظ',
  'status.newScene': 'لوحة جديدة',
  'status.restored': {
    zero: 'لم تُستعد عناصر',
    one: 'استُعيد عنصر واحد',
    two: 'استُعيد عنصران',
    few: 'استُعيدت {count} عناصر',
    many: 'استُعيد {count} عنصرًا',
    other: 'استُعيد {count} عنصر',
  },
  'status.cleared': 'تم المسح',
  'status.downloaded': 'تم تنزيل {file}',
  'status.loaded': 'تم تحميل {file}',
  'status.loadFailed': 'فشل التحميل: {error}',
  'status.baselineLoaded': 'تم تحميل الأساس ({file})',
  'status.baselineEmpty': 'لم يُطبَّق الأساس: {reason}',
  'status.restoreFailed': 'فشل الاستعادة: {error}',
  'status.autosaveFailed': 'فشل الحفظ التلقائي: {error}',

  'status.undo': 'تراجع',
  'status.redo': 'إعادة',
  'status.copied': {
    zero: 'لم يُنسخ شيء',
    one: 'تم نسخ عنصر واحد',
    two: 'تم نسخ عنصرين',
    few: 'تم نسخ {count} عناصر',
    many: 'تم نسخ {count} عنصرًا',
    other: 'تم نسخ {count} عنصر',
  },
  'status.pasted': {
    zero: 'لم يُلصق شيء',
    one: 'تم لصق عنصر واحد',
    two: 'تم لصق عنصرين',
    few: 'تم لصق {count} عناصر',
    many: 'تم لصق {count} عنصرًا',
    other: 'تم لصق {count} عنصر',
  },
  'status.duplicated': {
    zero: 'لم يُنشأ أي نسخة',
    one: 'تم إنشاء نسخة واحدة',
    two: 'تم إنشاء نسختين',
    few: 'تم إنشاء {count} نسخ',
    many: 'تم إنشاء {count} نسخة',
    other: 'تم إنشاء {count} نسخة',
  },

  'language.label': 'اللغة',
};
