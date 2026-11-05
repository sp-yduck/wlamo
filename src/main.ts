import { Wllama, LoggerWithoutDebug, WllamaAbortError } from '@wllama/wllama';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
// Self-hosted compat build (Asyncify, no MEMORY64) used on Safari etc.
import compatWasmUrl from '@wllama/wllama/compat/wllama.wasm?url';
import compatWorkerCode from '@wllama/wllama/compat/wllama.js?raw';
import { buildPrompt, cleanOutput, LANGUAGES, STOP_SEQUENCES, type GlossaryEntry, type HistoryPair } from './pfml';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './style.css';

const REPO = 'pfnet/plamo-3-translate-0.8b-GGUF';
const QUANTS = [
  { file: 'plamo-3-translate-0.8b-Q4_K_M.gguf', name: 'Q4_K_M', size: '0.57GB', label: 'Q4_K_M · 0.57GB · 推奨' },
  { file: 'plamo-3-translate-0.8b-Q4_0.gguf', name: 'Q4_0', size: '0.55GB', label: 'Q4_0 · 0.55GB' },
  { file: 'plamo-3-translate-0.8b-Q3_K_M.gguf', name: 'Q3_K_M', size: '0.49GB', label: 'Q3_K_M · 0.49GB' },
  { file: 'plamo-3-translate-0.8b-Q2_K.gguf', name: 'Q2_K', size: '0.41GB', label: 'Q2_K · 0.41GB · 最小' },
];
const modelUrl = (file: string) => `https://huggingface.co/${REPO}/resolve/main/${file}`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  env: $('env'), quant: $<HTMLSelectElement>('quant'), nctx: $<HTMLSelectElement>('nctx'),
  webgpu: $<HTMLInputElement>('webgpu'), load: $<HTMLButtonElement>('load'), unload: $<HTMLButtonElement>('unload'),
  progressWrap: $('progressWrap'), progressBar: $('progressBar'), status: $('status'),
  srcLang: $<HTMLSelectElement>('srcLang'), tgtLang: $<HTMLSelectElement>('tgtLang'), swap: $<HTMLButtonElement>('swap'),
  form: $('form'), panel: $('modelPanel'), title: $('modelTitle'), factSize: $('factSize'), tform: $<HTMLFormElement>('translateForm'), input: $<HTMLTextAreaElement>('input'), output: $('output'),
  inCount: $('inCount'), stats: $('stats'), clear: $<HTMLButtonElement>('clear'), copy: $<HTMLButtonElement>('copy'),
  translate: $<HTMLButtonElement>('translate'), stop: $<HTMLButtonElement>('stop'), useHistory: $<HTMLInputElement>('useHistory'),
  context: $<HTMLTextAreaElement>('context'), glossary: $('glossary'), addTerm: $<HTMLButtonElement>('addTerm'),
  maxTokens: $<HTMLInputElement>('maxTokens'), temp: $<HTMLInputElement>('temp'),
  history: $('history'), clearHistory: $<HTMLButtonElement>('clearHistory'),
};

// ---------- persisted settings ----------
const LS = 'wlamo:v1';
type Settings = { quant: string; nctx: string; webgpu: boolean; src: string; tgt: string; form: string };
const saved: Partial<Settings> = JSON.parse(localStorage.getItem(LS) ?? '{}');
function saveSettings() {
  const s: Settings = {
    quant: el.quant.value, nctx: el.nctx.value, webgpu: el.webgpu.checked,
    src: el.srcLang.value, tgt: el.tgtLang.value, form: toneValue(),
  };
  localStorage.setItem(LS, JSON.stringify(s));
}

type HistoryItem = HistoryPair & { src: string; tgt: string; at: number };
let history: HistoryItem[] = JSON.parse(localStorage.getItem(`${LS}:history`) ?? '[]');
const toneValue = () => (el.form.querySelector<HTMLInputElement>('input:checked')?.value ?? '');
const setTone = (v: string) => el.form.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.checked = i.value === v));
const saveHistory = () => localStorage.setItem(`${LS}:history`, JSON.stringify(history.slice(0, 50)));

// ---------- init UI ----------
for (const q of QUANTS) el.quant.add(new Option(q.label, q.file));
el.srcLang.add(new Option('自動検出', ''));
for (const [code, label] of LANGUAGES) {
  if (code !== 'ja(easy)') el.srcLang.add(new Option(`${label} (${code})`, code));
  el.tgtLang.add(new Option(`${label} (${code})`, code));
}
el.quant.value = saved.quant ?? QUANTS[0].file;
el.nctx.value = saved.nctx ?? '4096';
el.srcLang.value = saved.src ?? '';
el.tgtLang.value = saved.tgt ?? 'en';

// A real adapter is required; `navigator.gpu` alone may exist without usable hardware.
const hasWebGPU = await (async () => {
  try { return !!(await (navigator as any).gpu?.requestAdapter()); } catch { return false; }
})();
const isolated = self.crossOriginIsolated;
el.webgpu.checked = saved.webgpu ?? hasWebGPU;
el.webgpu.disabled = !hasWebGPU;
setTone(saved.form ?? '');
if (/Mac|iPhone|iPad/.test(navigator.platform)) $('modKey').textContent = '⌘';
const badge = (text: string, on: boolean) => `<span class="badge ${on ? '' : 'off'}">${text}</span>`;
el.env.innerHTML =
  badge(isolated ? `マルチスレッド · ${navigator.hardwareConcurrency} cores` : 'シングルスレッド', isolated) +
  badge(hasWebGPU ? 'WebGPU 対応' : 'WebGPU 非対応', hasWebGPU) +
  badge(`llama.cpp ${Wllama.getLibllamaVersion()}`, true);

const quantInfo = () => QUANTS.find((q) => q.file === el.quant.value) ?? QUANTS[0];
type PanelState = 'idle' | 'loading' | 'ready' | 'error';
function setPanel(state: PanelState) {
  el.panel.dataset.state = state;
  const q = quantInfo();
  el.title.textContent = {
    idle: '翻訳モデルをこのブラウザに読み込みます',
    loading: 'モデルを取得しています',
    ready: '',
    error: '読み込みに失敗しました',
  }[state];
  el.load.textContent = {
    idle: `モデルを読み込む（${q.size}）`,
    loading: '読み込み中…',
    ready: '再読み込み',
    error: '再試行',
  }[state];
  el.factSize.textContent = `約 ${q.size.replace('GB', ' GB')}`;
  el.output.dataset.placeholder = state === 'ready' ? '訳文がここに表示されます' : 'モデルを読み込むと、ここに訳文が表示されます';
}
el.quant.addEventListener('change', () => { if (el.panel.dataset.state !== 'ready') setPanel(el.panel.dataset.state as PanelState); });
setPanel('idle');

function updateFormVisibility() {
  el.form.hidden = el.tgtLang.value !== 'ja';  // 'ja(easy)' has no form control
}
updateFormVisibility();

for (const s of [el.quant, el.nctx, el.webgpu, el.srcLang]) s.addEventListener('change', saveSettings);
el.tgtLang.addEventListener('change', () => { updateFormVisibility(); saveSettings(); });
el.swap.addEventListener('click', () => {
  const src = el.srcLang.value;
  const tgt = el.tgtLang.value === 'ja(easy)' ? 'ja' : el.tgtLang.value;
  el.tgtLang.value = src || (tgt === 'ja' ? 'en' : 'ja');
  el.srcLang.value = tgt;
  const out = el.output.textContent ?? '';
  if (out.trim()) { el.input.value = out; el.output.textContent = ''; updateCount(); }
  updateFormVisibility();
  saveSettings();
});

const updateCount = () => (el.inCount.textContent = `${el.input.value.length} 文字`);
el.input.addEventListener('input', updateCount);
updateCount();
el.clear.addEventListener('click', () => { el.input.value = ''; updateCount(); el.input.focus(); });
el.copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(el.output.textContent ?? '');
  el.copy.textContent = 'コピーしました';
  setTimeout(() => (el.copy.textContent = 'コピー'), 1200);
});

// glossary
function addTerm(source = '', target = '') {
  const row = document.createElement('div');
  row.className = 'term';
  row.innerHTML = `<input type="text" placeholder="原語 (例: 管理画面)" class="g-src" aria-label="原語"><input type="text" placeholder="訳語 (例: dashboard)" class="g-tgt" aria-label="訳語"><button type="button" title="削除" aria-label="削除">✕</button>`;
  (row.querySelector('.g-src') as HTMLInputElement).value = source;
  (row.querySelector('.g-tgt') as HTMLInputElement).value = target;
  row.querySelector('button')!.addEventListener('click', () => row.remove());
  el.glossary.append(row);
}
el.addTerm.addEventListener('click', () => addTerm());
const readGlossary = (): GlossaryEntry[] =>
  [...el.glossary.querySelectorAll('.term')].map((r) => ({
    source: (r.querySelector('.g-src') as HTMLInputElement).value,
    target: (r.querySelector('.g-tgt') as HTMLInputElement).value,
  }));

// history
const fmtDate = (t: number) => {
  const d = new Date(t); const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function renderHistory() {
  el.history.innerHTML = history
    .map((h) => `<li><span class="src">${escapeHtml(h.input)}</span><span>${escapeHtml(h.output)}</span><span class="meta">${h.src || 'auto'} → ${h.tgt} · ${fmtDate(h.at)}</span></li>`)
    .join('') || '<li class="empty">履歴はまだありません</li>';
}
renderHistory();
el.clearHistory.addEventListener('click', () => { history = []; saveHistory(); renderHistory(); });

// ---------- model ----------
let wllama: Wllama | null = null;
let abort: AbortController | null = null;

function setStatus(msg: string, error = false) {
  el.status.textContent = msg;
  el.status.classList.toggle('error', error);
}
const fmtMB = (b: number) => `${(b / 1024 / 1024).toFixed(0)}MB`;

async function loadModel() {
  el.load.disabled = true;
  el.quant.disabled = el.nctx.disabled = el.webgpu.disabled = true;
  el.progressWrap.hidden = false;
  el.progressBar.style.width = '0%';
  setPanel('loading');
  const t0 = performance.now();
  try {
    await wllama?.exit();
    wllama = new Wllama({ default: wasmUrl }, { logger: LoggerWithoutDebug, allowOffline: true });
    wllama.setCompat({ wasm: compatWasmUrl, worker: { code: compatWorkerCode } });
    setStatus('モデルを準備中…');
    await wllama.loadModelFromUrl(modelUrl(el.quant.value), {
      n_ctx: Number(el.nctx.value),
      n_gpu_layers: el.webgpu.checked ? 999 : 0,
      progressCallback: ({ loaded, total }) => {
        const pct = total ? (loaded / total) * 100 : 0;
        el.progressBar.style.width = `${pct.toFixed(1)}%`;
        setStatus(`ダウンロード中… ${fmtMB(loaded)} / ${fmtMB(total)} (${pct.toFixed(0)}%)`);
      },
    });
    // wllama may resolve even when llama.cpp failed to load the model; verify.
    if (!wllama.isModelLoaded() || !wllama.getModelMetadata()?.hparams?.nVocab) {
      throw new Error('llama.cpp がモデルを読み込めませんでした (コンソールログを確認してください)');
    }
    el.progressBar.style.width = '100%';
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setPanel('ready');
    setStatus(
      `✅ 読み込み完了 (${secs}秒) — ${quantInfo().name} / ` +
        `${wllama.isMultithread() ? `${wllama.getNumThreads()} threads` : 'single thread'}` +
        `${el.webgpu.checked ? ' / WebGPU' : ' / CPU'}`,
    );
    el.translate.disabled = false;
    el.unload.hidden = false;
  } catch (e) {
    console.error(e);
    setPanel('error');
    setStatus(`❌ ${(e as Error).message}\nWebGPU をオフにする・Q3_K_M / Q2_K やコンテキスト 2,048 を選ぶと改善する場合があります。`, true);
    wllama = null;
    el.translate.disabled = true;
  } finally {
    el.load.disabled = false;
    el.quant.disabled = el.nctx.disabled = false;
    el.webgpu.disabled = !hasWebGPU;
    setTimeout(() => (el.progressWrap.hidden = true), 400);
  }
}
el.load.addEventListener('click', loadModel);
el.unload.addEventListener('click', async () => {
  await wllama?.exit();
  wllama = null;
  el.translate.disabled = true;
  el.unload.hidden = true;
  setPanel('idle');
  setStatus('モデルを解放しました (ダウンロード済みファイルはキャッシュに残っています)。');
});

// ---------- translate ----------
async function translate() {
  if (!wllama || abort) return;
  const text = el.input.value.trim();
  if (!text) return;
  const sourceLang = el.srcLang.value || undefined;
  const targetLang = el.tgtLang.value;
  let prompt: string;
  try {
    prompt = buildPrompt({
      text,
      targetLang,
      sourceLang,
      context: el.context.value,
      glossary: readGlossary(),
      form: (toneValue() || undefined) as 'plain' | 'polite' | undefined,
      history: el.useHistory.checked
        ? history.filter((h) => h.tgt === targetLang && h.src === (sourceLang ?? '')).slice(0, 4).reverse()
        : [],
    });
  } catch (e) {
    setStatus((e as Error).message, true);
    return;
  }

  abort = new AbortController();
  el.translate.hidden = true;
  el.stop.hidden = false;
  el.output.textContent = '';
  el.output.classList.add('generating');
  el.stats.textContent = '処理中…';
  let raw = '';
  let nTokens = 0;
  let tFirst = 0;
  const t0 = performance.now();
  try {
    await wllama.createCompletion({
      prompt,
      stream: true,
      max_tokens: Number(el.maxTokens.value) || 1024,
      temperature: Number(el.temp.value) || 0,
      stop: STOP_SEQUENCES,
      abortSignal: abort.signal,
      onData: (chunk) => {
        const piece = chunk.choices[0]?.text ?? '';
        if (piece) {
          if (!tFirst) tFirst = performance.now();
          nTokens++;
          raw += piece;
          el.output.textContent = cleanOutput(raw);
          const dt = (performance.now() - tFirst) / 1000;
          el.stats.textContent = `${nTokens} tok · ${dt > 0 ? (nTokens / dt).toFixed(1) : '-'} tok/s`;
        }
      },
    });
  } catch (e) {
    if (!(e instanceof WllamaAbortError) && (e as Error).name !== 'AbortError') {
      console.error(e);
      setStatus(`翻訳中にエラーが発生しました: ${(e as Error).message}`, true);
    }
  } finally {
    const out = cleanOutput(raw);
    el.output.textContent = out;
    el.output.classList.remove('generating');
    const total = (performance.now() - t0) / 1000;
    const prefill = tFirst ? ((tFirst - t0) / 1000).toFixed(2) : '-';
    const gen = tFirst ? (performance.now() - tFirst) / 1000 : 0;
    el.stats.textContent = `${nTokens} tok · ${gen > 0 ? (nTokens / gen).toFixed(1) : '-'} tok/s · 初回 ${prefill}s · 合計 ${total.toFixed(1)}s`;
    if (out && !abort.signal.aborted) {
      history.unshift({ input: text, output: out, src: sourceLang ?? '', tgt: targetLang, at: Date.now() });
      saveHistory();
      renderHistory();
    }
    abort = null;
    el.translate.hidden = false;
    el.stop.hidden = true;
  }
}
el.tform.addEventListener('submit', (e) => { e.preventDefault(); translate(); });
el.form.addEventListener('change', saveSettings);
el.stop.addEventListener('click', () => abort?.abort());
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); translate(); }
});

// Expose for debugging / automated tests
Object.assign(window, { __wlamo: { get wllama() { return wllama; }, loadModel, translate, buildPrompt } });
