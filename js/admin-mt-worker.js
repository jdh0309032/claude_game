// 관리자 페이지 번역 워커: 오픈소스 M2M100 (facebook/m2m100_418M, MIT 라이선스, 100개 언어)을
// transformers.js 로 브라우저 안에서 실행. 서버 비용·외부 번역 API 없음. 첫 사용 때 모델(약 630MB)을 받아 브라우저 캐시에 저장
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';

env.allowLocalModels = false;
env.useBrowserCache = true;
// ?mthost=https://내서버/ 를 주면 모델을 그곳에서 받음 (자체 호스팅·테스트용). 기본은 Hugging Face
const mthost = new URL(self.location.href).searchParams.get('mthost');
if (mthost) env.remoteHost = mthost;

const MODEL = 'Xenova/m2m100_418M';
let translator = null;
let loading = null;

function load() {
  if (translator) return Promise.resolve(translator);
  if (!loading) {
    loading = pipeline('translation', MODEL, {
      dtype: 'q8',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
      },
    }).then((t) => {
      translator = t;
      self.postMessage({ type: 'ready' });
      return t;
    }).catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

// 긴 글은 문장/줄 단위로 나눠 번역 (모델 입력 길이 제한 + 품질)
function chunks(text) {
  // 문장 끝(. ! ? 뒤에 공백)에서만 자름 → "10.000" 같은 숫자는 그대로
  return text.split(/\n/).map((line) => line.split(/(?<=[.!?。？！])\s+/));
}

self.onmessage = async (e) => {
  const { id, text, src, tgt } = e.data;
  try {
    const t = await load();
    if (!text || !text.trim() || src === tgt) {
      self.postMessage({ type: 'result', id, text });
      return;
    }
    const lines = [];
    for (const parts of chunks(text)) {
      const out = [];
      for (const part of parts) {
        if (!part.trim()) { out.push(part); continue; }
        const r = await t(part.trim(), { src_lang: src, tgt_lang: tgt, max_new_tokens: 256 });
        out.push(r[0].translation_text);
      }
      lines.push(out.join(' ').trim());
    }
    self.postMessage({ type: 'result', id, text: lines.join('\n') });
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String(err?.message || err) });
  }
};
