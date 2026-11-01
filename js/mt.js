// 기계 번역 (키·서버 없이 브라우저에서 바로): Google 번역 웹 엔드포인트 → 실패하면 MyMemory 무료 API
// - 관리자: 문의·공지 번역 / 게임: 번역이 없는 공지·답변을 플레이어 언어로 자동 번역
// - 같은 문장은 메모리에 캐시. 코드: en ko vi id th ms tl km my (두 서비스 모두 이 코드를 그대로 씀)
const cache = new Map();

async function viaGoogle(text, src, tgt) {
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${src || 'auto'}&tl=${tgt}`, {
    method: 'POST',
    body: new URLSearchParams({ q: text }),
  });
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
  const j = await res.json();
  const out = (j?.[0] || []).map((s) => s?.[0] || '').join('');
  if (!out) throw new Error('empty translation');
  return out;
}

// MyMemory: 요청당 500바이트 제한 → 줄·문장 단위로 잘라 보냄
async function viaMyMemory(text, src, tgt) {
  const parts = [];
  for (const line of text.split('\n')) {
    let cur = '';
    for (const s of line.split(/(?<=[.!?。？！])\s+/)) {
      if (cur && new TextEncoder().encode(`${cur} ${s}`).length > 450) { parts.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
    }
    parts.push(cur, '\n');
  }
  parts.pop();
  let out = '';
  for (const p of parts) {
    if (p === '\n' || !p.trim()) { out += p; continue; }
    const res = await fetch(`https://api.mymemory.translated.net/get?langpair=${src && src !== 'auto' ? src : 'Autodetect'}|${tgt}&q=${encodeURIComponent(p)}`);
    const j = await res.json();
    if (!res.ok || j.responseStatus >= 400 || !j.responseData?.translatedText) throw new Error(j.responseDetails || `translate HTTP ${res.status}`);
    out += (out && !out.endsWith('\n') ? ' ' : '') + j.responseData.translatedText;
  }
  return out;
}

export async function machineTranslate(text, src, tgt) {
  if (!text || !text.trim() || src === tgt) return text;
  const key = `${src}|${tgt}|${text}`;
  if (cache.has(key)) return cache.get(key);
  let out;
  try {
    out = await viaGoogle(text, src, tgt);
  } catch (e) {
    out = await viaMyMemory(text, src, tgt);
  }
  cache.set(key, out);
  return out;
}
