// 게임 다국어: 영어 원문을 키로 쓰는 사전 방식 (js/lang/<code>.js 의 { "English": "번역" })
// - t('NEAR MISS!') / t('COMBO x{n}', { n: 5 }) → 현재 언어 번역, 없으면 영어 그대로
// - HTML: data-i18n(텍스트), data-i18n-html(<b> 등 포함), data-i18n-ph(placeholder), data-i18n-aria(aria-label)
//   처음 적용할 때 영어 원문을 data-src 에 보관해 언어를 몇 번 바꿔도 원문 기준으로 다시 번역
// - 언어: 기본은 영어, 설정에서 고른 언어만 저장해 사용 (기기 언어로 자동 전환하지 않음). 태국어·크메르어·미얀마어는 전용 웹폰트를 필요할 때만 불러옴
export const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'ko', name: '한국어' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'th', name: 'ไทย' },
  { code: 'ms', name: 'Bahasa Melayu' },
  { code: 'tl', name: 'Filipino' },
  { code: 'km', name: 'ខ្មែរ' },
  { code: 'my', name: 'မြန်မာ' },
];
const CODES = new Set(LANGS.map((l) => l.code));
const FONTS = { ko: 'Noto+Sans+KR', th: 'Noto+Sans+Thai', km: 'Noto+Sans+Khmer', my: 'Noto+Sans+Myanmar' };

let lang = 'en';
let dict = {};
const listeners = new Set();

export const getLang = () => lang;
export const langName = (code) => LANGS.find((l) => l.code === code)?.name || code;

export function t(src, vars) {
  let s = (lang !== 'en' && dict[src]) || src;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

function loadFont(code) {
  const fam = FONTS[code];
  if (!fam || document.getElementById(`font-${code}`)) return;
  const link = document.createElement('link');
  link.id = `font-${code}`;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fam}:wght@500;700;800&display=swap`;
  document.head.appendChild(link);
}

export async function setLang(code) {
  const next = CODES.has(code) ? code : 'en';
  if (next !== 'en') {
    try {
      dict = (await import(`./lang/${next}.js`)).default || {};
    } catch (e) {
      dict = {};
    }
  } else {
    dict = {};
  }
  lang = next;
  document.documentElement.lang = next;
  document.documentElement.dataset.lang = next;
  loadFont(next);
  applyI18n(document);
  for (const f of listeners) f(next);
  return next;
}

export function onLangChange(f) { listeners.add(f); }

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    if (el.dataset.src == null) el.dataset.src = el.innerHTML.trim();
    el.innerHTML = t(el.dataset.src);
  }
  for (const el of root.querySelectorAll('[data-i18n]')) {
    if (el.dataset.src == null) el.dataset.src = el.textContent.trim();
    el.textContent = t(el.dataset.src);
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    if (el.dataset.srcPh == null) el.dataset.srcPh = el.getAttribute('placeholder') || '';
    el.setAttribute('placeholder', t(el.dataset.srcPh));
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    if (el.dataset.srcAria == null) el.dataset.srcAria = el.getAttribute('aria-label') || '';
    el.setAttribute('aria-label', t(el.dataset.srcAria));
  }
}
