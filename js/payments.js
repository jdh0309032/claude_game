// 코인 결제: mock(테스트) / native(Capacitor + RevenueCat)
// native 에서는 코인을 클라이언트가 직접 올리지 않고, 서버(웹훅)가 지급한 코인을 claim_pending_coins 로 받아 감
import { PAYMENTS, COIN_PACKS } from './config.js';

const plugin = () => (typeof window !== 'undefined' && window.Capacitor?.Plugins?.Purchases) || null;
const platform = () => (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web';

export function paymentsMode() {
  if (PAYMENTS.provider === 'native') return plugin() ? 'native' : 'off'; // 웹에서는 실제 결제 불가
  return PAYMENTS.provider === 'mock' ? 'mock' : 'off';
}

let configuredFor = null;
// 로그인한 계정으로 결제 SDK 연결 (RevenueCat app_user_id = Supabase 사용자 ID)
export async function initPayments(userId) {
  if (paymentsMode() !== 'native' || !userId || configuredFor === userId) return;
  const P = plugin();
  const apiKey = platform() === 'ios' ? PAYMENTS.revenuecatApiKeyIos : PAYMENTS.revenuecatApiKeyAndroid;
  if (!apiKey) return;
  if (configuredFor) await P.logIn({ appUserID: userId });
  else await P.configure({ apiKey, appUserID: userId });
  configuredFor = userId;
}

// 상점에 보여줄 상품 (가격 문자열 포함)
export async function getPacks() {
  if (paymentsMode() === 'native') {
    try {
      const res = await plugin().getProducts({ productIdentifiers: COIN_PACKS.map((p) => p.id), type: 'inapp' });
      const byId = Object.fromEntries((res.products || []).map((p) => [p.identifier, p]));
      return COIN_PACKS.filter((p) => byId[p.id]).map((p) => ({ ...p, price: byId[p.id].priceString, product: byId[p.id] }));
    } catch (e) {
      console.warn('[pay] products failed', e);
      return [];
    }
  }
  return COIN_PACKS.map((p) => ({ ...p, price: `${p.testPrice} · TEST` }));
}

// 테스트 결제 확인 창
function mockConfirm(pack) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'ad-overlay';
    el.innerHTML = `<div class="ad-box"><small>TEST PURCHASE · NO REAL MONEY</small><b class="ad-count">${pack.coins.toLocaleString('en-US')}</b>
      <p>coins for ${pack.testPrice}. Real payments need the app build with store billing (PAYMENTS.provider = 'native').</p>
      <div class="row"><button class="btn primary" data-ok>BUY (TEST)</button><button class="btn" data-no>CANCEL</button></div></div>`;
    document.body.appendChild(el);
    el.querySelector('[data-ok]').addEventListener('click', () => { el.remove(); resolve(true); });
    el.querySelector('[data-no]').addEventListener('click', () => { el.remove(); resolve(false); });
  });
}

// 결제: { ok, test?, cancelled?, error? }
export async function buyPack(pack) {
  const mode = paymentsMode();
  if (mode === 'mock') return (await mockConfirm(pack)) ? { ok: true, test: true } : { ok: false, cancelled: true };
  if (mode !== 'native') return { ok: false, error: 'Payments are not available here' };
  try {
    await plugin().purchaseStoreProduct({ product: pack.product });
    return { ok: true };
  } catch (e) {
    if (e?.userCancelled || /cancel/i.test(String(e?.message || e))) return { ok: false, cancelled: true };
    return { ok: false, error: String(e?.message || e) };
  }
}
