// 보상형 광고 전용 (배너 광고 없음)
// - 'h5'  : Google H5 Games Ads (adBreak type: 'reward')
// - 'mock': 테스트용 가짜 광고 (5초 카운트다운)
// - 'none': 광고 비활성
import { ADS } from './config.js';

let h5Ready = false;

function loadH5() {
  if (h5Ready || !ADS.adClient) return;
  h5Ready = true;
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); };
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS.adClient)}`;
  s.crossOrigin = 'anonymous';
  s.dataset.adClient = ADS.adClient;
  if (ADS.testMode) s.dataset.adbreakTest = 'on';
  document.head.appendChild(s);
  window.adConfig({ preloadAdBreaks: 'on', sound: 'on' });
}

export const adsEnabled = () => ADS.provider === 'mock' || (ADS.provider === 'h5' && Boolean(ADS.adClient));

// 테스트용 가짜 광고 오버레이
function mockAd(label) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'ad-overlay';
    el.innerHTML = `<div class="ad-box"><small>TEST AD &middot; ${label}</small><b class="ad-count">5</b><p>Rewarded ad placeholder. Set ADS.provider to 'h5' with your AdSense client ID for real ads.</p><button class="btn ad-skip">CLOSE (NO REWARD)</button></div>`;
    document.body.appendChild(el);
    let n = 5;
    const count = el.querySelector('.ad-count');
    const timer = setInterval(() => {
      n -= 1;
      count.textContent = n;
      if (n <= 0) finish(true);
    }, 1000);
    const finish = (ok) => {
      clearInterval(timer);
      el.remove();
      resolve(ok);
    };
    el.querySelector('.ad-skip').addEventListener('click', () => finish(false));
  });
}

// 보상형 광고 1회: 끝까지 시청하면 true
// hooks: { pause(), resume() } — 광고 중 게임 사운드 정지 등
export function showRewarded(placement, hooks = {}) {
  if (ADS.provider === 'mock') {
    hooks.pause?.();
    return mockAd(placement).finally(() => hooks.resume?.());
  }
  if (ADS.provider !== 'h5' || !ADS.adClient) return Promise.resolve(false);
  loadH5();
  return new Promise((resolve) => {
    let rewarded = false, settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    window.adBreak({
      type: 'reward',
      name: placement,
      beforeAd: () => hooks.pause?.(),
      afterAd: () => hooks.resume?.(),
      beforeReward: (showAdFn) => showAdFn(),
      adDismissed: () => done(false),
      adViewed: () => { rewarded = true; done(true); },
      adBreakDone: () => done(rewarded), // 광고 없음(no fill) 포함
    });
  });
}
