// 앱 라이브 업데이트 (Capgo 업데이터, 자체 호스팅): 스토어를 거치지 않고 게임 웹 파일만 교체
// - main 브랜치에 푸시할 때마다 CI 가 web.zip 을 GitHub Release(web-<번호>)로 올림
// - 앱은 실행·복귀 때(최소 1분 간격) 최신 릴리스를 확인 → 새것이면 받아 두고, 메뉴 화면에 있으면 바로 적용(새로 고침)
//   주행 중이면 끝나고 메뉴로 돌아왔을 때 적용 (판을 끊지 않음). 못 하면 다음 백그라운드/재실행 때 적용
// - 새 묶음이 뜬 뒤 notifyAppReady() 를 못 부르면(오류로 멈춤) 10초 뒤 자동으로 이전 묶음으로 되돌아감
// - 릴리스가 더 높은 nativeLevel 을 요구하면 받지 않음(그땐 스토어 업데이트 필요)
// 웹(GitHub Pages)에서는 아무것도 하지 않음
const RELEASES = 'https://api.github.com/repos/jdh0309032/claude_game/releases/latest';
const CHECK_GAP_MS = 60 * 1000;
let lastCheck = 0, checking = false, pendingVersion = null, pendingBundle = null;

const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const isNative = () => Boolean(cap()?.isNativePlatform?.());

async function check() {
  const U = cap()?.Plugins?.CapacitorUpdater, App = cap()?.Plugins?.App;
  if (!U || checking || Date.now() - lastCheck < CHECK_GAP_MS) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const cur = await (await fetch('build.json', { cache: 'no-store' })).json();
    const nativeLevel = parseInt((await App?.getInfo?.())?.version, 10) || cur.nativeLevel || 1;
    const rel = await (await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })).json();
    const meta = JSON.parse((rel.body || '').match(/\{[^{}]*\}/)?.[0] || '{}');
    const web = Number(meta.web) || 0;
    if (web <= (cur.web || 0) || String(web) === pendingVersion) return;
    if ((meta.nativeLevel || 1) > nativeLevel) return; // 네이티브 업데이트가 먼저 필요
    const asset = (rel.assets || []).find((a) => a.name === 'web.zip');
    if (!asset) return;
    const bundle = await U.download({ url: asset.browser_download_url, version: String(web) });
    await U.next({ id: bundle.id }); // 안전장치: 바로 적용 못 하면 다음 백그라운드/재실행 때 적용
    pendingVersion = String(web);
    pendingBundle = bundle;
    window.dispatchEvent(new CustomEvent('grub-update-ready', { detail: { version: web } }));
  } catch (e) {
    // 오프라인·API 제한 등: 다음 기회에 다시
  } finally {
    checking = false;
  }
}

export async function initLiveUpdate() {
  if (!isNative()) return;
  const U = cap().Plugins.CapacitorUpdater;
  if (!U) return;
  try { await U.notifyAppReady(); } catch (e) { /* ignore */ }
  setTimeout(check, 4000); // 시작 직후 로딩과 겹치지 않게
  cap().Plugins.App?.addListener?.('appStateChange', (s) => { if (s.isActive) check(); });
}

// 받아 둔 업데이트가 있는지 / 지금 바로 적용 (앱이 새 웹 묶음으로 다시 로드됨)
export const hasPendingUpdate = () => Boolean(pendingBundle);
export async function applyPendingUpdate() {
  const U = cap()?.Plugins?.CapacitorUpdater;
  if (!U || !pendingBundle) return false;
  try { await U.set({ id: pendingBundle.id }); return true; } catch (e) { return false; }
}

// 설정 화면 표시용: 이 웹 묶음의 빌드 번호
export async function webBuild() {
  try { return (await (await fetch('build.json', { cache: 'no-store' })).json()).web || 0; } catch (e) { return 0; }
}
