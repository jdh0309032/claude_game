// Grub Rider: RevenueCat 웹훅 → 코인 지급 (Supabase Edge Function, Deno)
// 배포: supabase functions deploy revenuecat-webhook --no-verify-jwt
// 비밀값: supabase secrets set REVENUECAT_WEBHOOK_AUTH=<RevenueCat 웹훅 Authorization 헤더 값>
// (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Edge Function 에 자동 제공 — 앱 코드에는 절대 넣지 않음)
// RevenueCat 에서 app_user_id 는 Supabase 사용자 ID(uuid)로 설정해야 함 (게임이 로그인 시 Purchases.logIn(userId))
import { createClient } from 'npm:@supabase/supabase-js@2';

// 상품 ID → 지급 코인 (js/config.js 의 COIN_PACKS 와 같게 유지)
const PRODUCT_COINS: Record<string, number> = {
  grub_coins_s: 3000,
  grub_coins_m: 10000,
  grub_coins_l: 22000,
  grub_coins_xl: 65000,
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  if (!secret || req.headers.get('Authorization') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const ev = body?.event;
  if (!ev) return new Response('bad request', { status: 400 });
  // 소모성 상품 구매만 처리 (환불 등은 로그만 남김)
  if (ev.type !== 'NON_RENEWING_PURCHASE' && ev.type !== 'INITIAL_PURCHASE') {
    return new Response(JSON.stringify({ ignored: ev.type }), { status: 200 });
  }
  const coins = PRODUCT_COINS[ev.product_id];
  const userId = ev.app_user_id;
  const tx = ev.transaction_id || ev.id;
  if (!coins || !/^[0-9a-f-]{36}$/i.test(userId || '') || !tx) {
    return new Response(JSON.stringify({ error: 'unknown product or user' }), { status: 200 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await db.rpc('credit_purchase', {
    p_tx: String(tx), p_user: userId, p_product: ev.product_id, p_coins: coins,
    p_platform: String(ev.store || 'unknown'), p_raw: ev,
  });
  // 삭제된 계정(외래키 위반)은 재시도해도 소용없으므로 200 으로 종료
  if (error?.code === '23503') return new Response(JSON.stringify({ error: 'user not found' }), { status: 200 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 }); // RevenueCat 이 재시도
  return new Response(JSON.stringify({ credited: data === true }), { status: 200 });
});
