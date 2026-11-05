/**
 * PFML3 prompt builder for PLaMo 3 Translate.
 * Mirrors the official chat_template.jinja shipped with pfnet/plamo-3-translate-*-GGUF.
 * The BOS token is added by llama.cpp automatically, so it is omitted here.
 */
export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface HistoryPair {
  input: string;
  output: string;
}

export interface TranslateRequest {
  text: string;
  targetLang: string;
  sourceLang?: string;
  context?: string;
  glossary?: GlossaryEntry[];
  form?: 'plain' | 'polite';
  history?: HistoryPair[];
}

export const STOP_SEQUENCES = ['<|plamo:tag|>', '<|plamo:bos|>'];

const RESERVED = '<|plamo:';

function check(value: string, name: string, allowEmpty = false): string {
  if (!allowEmpty && !value.trim()) throw new Error(`${name} は空にできません`);
  if (value.includes(RESERVED)) throw new Error(`${name} に予約トークン (<|plamo:...) を含めることはできません`);
  return value;
}

export function buildPrompt(req: TranslateRequest): string {
  const src = req.sourceLang ? `<|plamo:key|>lang<|plamo:val|>${req.sourceLang}` : '';
  let p = '<|plamo:tag|>dataset<|plamo:msg|>translation';

  if (req.context?.trim()) {
    p += `<|plamo:tag|>context<|plamo:msg|>${check(req.context, 'コンテキスト', true)}`;
  }
  for (const h of req.history ?? []) {
    p += `<|plamo:tag|>input${src}<|plamo:msg|>${check(h.input, '履歴(原文)')}`;
    p += `<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>${req.targetLang}<|plamo:msg|>${check(h.output, '履歴(訳文)')}`;
  }
  const glossary = (req.glossary ?? []).filter((g) => g.source.trim() && g.target.trim());
  if (glossary.length) {
    p += '<|plamo:tag|>glossary';
    for (const g of glossary) {
      p += `<|plamo:index|>${check(g.source, '用語(原語)')}<|plamo:item|>${check(g.target, '用語(訳語)')}`;
    }
  }
  p += `<|plamo:tag|>input${src}<|plamo:msg|>${check(req.text, '原文')}`;
  p += `<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>${req.targetLang}`;
  if (req.form && req.targetLang === 'ja') p += `<|plamo:key|>form<|plamo:val|>${req.form}`;
  p += '<|plamo:msg|>';
  return p;
}

/** Strip any trailing stop tokens the model may leave behind. */
export function cleanOutput(text: string): string {
  let t = text;
  for (const s of STOP_SEQUENCES) {
    const i = t.indexOf(s);
    if (i >= 0) t = t.slice(0, i);
  }
  return t.trim();
}

export const LANGUAGES: [code: string, label: string][] = [
  ['ja', '日本語'], ['ja(easy)', 'やさしい日本語'], ['en', 'English'],
  ['zh-hans', '简体中文'], ['zh-hant', '繁體中文'], ['ko', '한국어'],
  ['ar', 'العربية'], ['az', 'Azərbaycan'], ['be', 'Беларуская'], ['bg', 'Български'],
  ['bn', 'বাংলা'], ['ca', 'Català'], ['ceb', 'Cebuano'], ['de', 'Deutsch'],
  ['es', 'Español'], ['et', 'Eesti'], ['eu', 'Euskara'], ['fa', 'فارسی'],
  ['fr', 'Français'], ['gu', 'ગુજરાતી'], ['he', 'עברית'], ['hi', 'हिन्दी'],
  ['hr', 'Hrvatski'], ['hu', 'Magyar'], ['hy', 'Հայերեն'], ['id', 'Bahasa Indonesia'],
  ['it', 'Italiano'], ['jv', 'Basa Jawa'], ['ka', 'ქართული'], ['kk', 'Қазақ'],
  ['km', 'ខ្មែរ'], ['lt', 'Lietuvių'], ['lv', 'Latviešu'], ['ml', 'മലയാളം'],
  ['mr', 'मराठी'], ['ms', 'Bahasa Melayu'], ['my', 'မြန်မာ'], ['ne', 'नेपाली'],
  ['nl', 'Nederlands'], ['pa', 'ਪੰਜਾਬੀ'], ['pl', 'Polski'], ['ru', 'Русский'],
  ['si', 'සිංහල'], ['sk', 'Slovenčina'], ['sl', 'Slovenščina'], ['sr', 'Српски'],
  ['sw', 'Kiswahili'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['th', 'ไทย'],
  ['tl', 'Tagalog'], ['ur', 'اردو'], ['uz', 'Oʻzbek'], ['vi', 'Tiếng Việt'],
];
