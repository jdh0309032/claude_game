// 배포 환경별 설정. 비워두면 로컬 모드(이 기기 브라우저 저장소)로 동작합니다.

// ---------- 온라인 계정 & 글로벌 랭킹 (Supabase)
// supabase/schema.sql 을 Supabase SQL Editor 에서 실행한 뒤 아래 두 값을 채우세요.
// (Authentication > Providers > Email 에서 "Confirm email" 을 꺼야 아이디 가입이 바로 됩니다)
export const SUPABASE_URL = 'https://oavlcqityoudwxylgllj.supabase.co';
// 공개용 키 (publishable / anon). service_role·secret 키는 절대 넣지 마세요.
export const SUPABASE_ANON_KEY = 'sb_publishable_fnhE6hTPp8Wwqj_W1gjiog_qT84mTI4';

// 아이디를 Supabase 이메일 계정으로 바꿀 때 붙이는 가상 도메인
export const ID_EMAIL_DOMAIN = 'grabrider.game';

// ---------- 국가 자동 판별 (IP Geolocation)
// 접속 시 위에서부터 차례로 시도해 ISO 국가 코드(예: 'KR')를 얻습니다. 모두 실패하면 기기 시간대로 추정.
// 키가 필요 없는 공개 API 들이며, 요청 시 사용자의 IP 가 해당 서비스로 전달됩니다. 빈 배열이면 IP 조회를 하지 않습니다.
export const GEO_IP_ENDPOINTS = [
  { url: 'https://api.country.is/', pick: (j) => j.country },
  { url: 'https://get.geojs.io/v1/ip/country.json', pick: (j) => j.country },
  { url: 'https://ipapi.co/json/', pick: (j) => j.country_code || j.country },
];
// 로그인 계정은 처음 판별된 국가가 서버(player_data.country_code)에 고정되어 이후 바뀌지 않습니다.

// ---------- 국가 1위 전용 '국가대표 바이크'
// 내 국가 랭킹 1위 여부를 서버(my_rank_v4)에서 이 주기(초)로 다시 확인합니다.
export const FLAG_CHECK_INTERVAL_SEC = 30;

// ---------- 외부 3D 모델 (.glb / .gltf)
// 파일을 assets/models/ 에 넣고 url 을 지정하면 절차적 모델 대신 사용합니다.
// 파일이 없거나 로딩 중이면 기존 로우폴리 모델이 그대로 보입니다(fallback).
//   url      : 모델 경로
//   fit      : 'length' | 'height' | 'width' 축을 size(m)에 맞게 자동 스케일
//   size     : 맞출 크기(m). 생략하면 원본 크기
//   rotateY  : 모델 정면이 -Z 방향이 아니면 회전 보정(라디안)
//   offsetY  : 높이 보정(m)
export const MODEL_CONFIG = {
  'bike':           null, // 예: { url: 'assets/models/scooter.glb', fit: 'length', size: 1.9, rotateY: Math.PI }
  'box':            null, // 배달 상자만 교체 (절차적 바이크 위에 얹음)
  'car.sedan':      null,
  'car.taxi':       null,
  'car.police':     null,
  'car.suv':        null,
  'car.truck':      null,
  'car.bus':        null,
  'car.ramp':       null, // 경사판 견인트럭
  'prop.palm':      null, // 인스턴싱 소품: 첫 번째 메시 지오메트리를 사용
  'prop.ruko':      null,
  'prop.warung':    null,
  'prop.building':  null,
  'prop.lamp':      null,
  'obstacle.cone':  null,
  'obstacle.sign':  null,
  'obstacle.stall': null, // 갓길 노점상(Kaki Lima)
};

// ======================================================================
// 상점 가격표 & 스탯 (차고)
// ======================================================================
// style: 외형 변형 (models.js 의 BIKE_SHAPES 와 매칭)
export const BIKES = [
  { id: 'rookie',  name: 'Rookie 125',         price: 0,     maxKmh: 170, accel: 1.0,  handling: 1.0,  color: 0xf2f2f2, style: 'scooter', desc: 'Starter delivery scooter' },
  { id: 'city',    name: 'City Commuter',      price: 8000, tier: 'common',  maxKmh: 190, accel: 1.08, handling: 1.08, color: 0x2a9df4, style: 'maxi', desc: 'Nimble in tight traffic' },
  { id: 'vintage', name: 'Vintage Classic',    price: 20000, tier: 'rare',  maxKmh: 200, accel: 1.05, handling: 1.15, color: 0x8b1e2d, style: 'classic', desc: 'Chrome and leather charm' },
  { id: 'express', name: 'Delivery Express',   price: 35000, tier: 'rare',  maxKmh: 215, accel: 1.2,  handling: 1.15, color: 0x00b14f, style: 'cub', desc: 'Built for long shifts' },
  { id: 'sport',   name: 'Sport Street 250',   price: 50000, tier: 'epic',  maxKmh: 240, accel: 1.3,  handling: 1.25, color: 0xff6b00, style: 'sport',   desc: 'Razor-sharp handling' },
  { id: 'enduro',  name: 'Off-Road Enduro',    price: 75000, tier: 'epic',  maxKmh: 235, accel: 1.35, handling: 1.42, color: 0xffd60a, style: 'enduro',  desc: 'Shrugs off puddles' },
  { id: 'phantom', name: 'Phantom X',          price: 110000, tier: 'legendary', maxKmh: 280, accel: 1.5,  handling: 1.45, color: 0x7b2cbf, style: 'naked',   desc: 'Legendary hyperbike' },
  { id: 'cyber',   name: 'Cyber Pulse 3000',   price: 150000, tier: 'legendary', maxKmh: 310, accel: 1.65, handling: 1.55, color: 0x101820, style: 'cyber',   desc: 'Neon-lit future machine' },
  // 국가대표 바이크: 구매 불가. 내 국가 랭킹 실시간 1위일 때만 자동 지급·장착, 1위를 뺏기면 회수
  { id: 'national', name: 'National Team',    price: -1,    maxKmh: 320, accel: 1.7,  handling: 1.6,  color: 0xffffff, style: 'sport',   desc: 'Only for the current #1 rider of your country', special: 'national' },
];

// 상점 국기 (헬멧 스티커 + 차체 데칼 + 배달 상자 깃발). 주행 테마 8개국 10,000 / 그 외 8,000 코인
// 이미지는 assets/flags/XX.svg (실제 국기, country-flag-icons). 코드만 추가하면 상점에 나옵니다.
export const FLAG_SHOP_CODES = [
  'ID', 'VN', 'TH', 'KR', 'JP', 'SG', 'US', 'FR',
  'MY', 'PH', 'KH', 'LA', 'MM', 'BN', 'CN', 'HK', 'IN', 'BD', 'PK', 'AU', 'NZ', 'GB', 'IE', 'DE', 'IT', 'ES', 'PT', 'NL',
  'BE', 'CH', 'SE', 'NO', 'FI', 'DK', 'PL', 'UA', 'TR', 'SA', 'AE', 'EG', 'ZA', 'NG', 'CA', 'MX', 'BR', 'AR',
];
export const FLAG_PRICE_THEME = 10000; // Rare 급
export const FLAG_PRICE_OTHER = 8500;

// ---------- 관리자 모드
// 관리자 계정은 Supabase 의 player_data.is_admin = true 로 지정합니다 (004 마이그레이션 참고).
// ?debug 로 열었을 때 설정 화면에 ADMIN MODE 토글을 보여줄지 (이 기기·이번 접속에만 적용)
export const ADMIN_DEBUG_TOGGLE = true;

// 배달 상자 / 라이더 의상 / 헬멧: 기본 1종(무료) + 유료 6종 (500 ~ 3,000 코인)
export const BOXES = [
  { id: 'basic',     name: 'Classic Box',    price: 0,    swatch: '#00b14f', desc: 'Standard green delivery box' },
  { id: 'styrofoam', name: 'Cooler Box',     price: 3000, tier: 'common',  swatch: '#f4f4ee', desc: 'Styrofoam box for fresh food' },
  { id: 'pizza',     name: 'Pizza Stack',    price: 3500, tier: 'common',  swatch: '#e63946', desc: 'Hot pizza warmer bag' },
  { id: 'neon',      name: 'Neon Box',       price: 8500, tier: 'rare', swatch: '#00f0ff', desc: 'Glowing neon trim at night' },
  { id: 'camo',      name: 'Camo Crate',     price: 4000, tier: 'common', swatch: '#5b6b3a', desc: 'Military-grade cargo' },
  { id: 'treasure',  name: 'Treasure Chest', price: 20000, tier: 'epic', swatch: '#7a4a22', desc: 'Wooden chest with gold trim' },
  { id: 'goldbox',   name: 'Gold VIP Box',   price: 8500, tier: 'rare', swatch: '#e6b422', desc: 'Solid gold VIP delivery vault' },
  { id: 'vintage',   name: 'Vintage Crate',  price: 4000, tier: 'common', swatch: '#9c6b3c', desc: 'Old wooden crate with iron corners' },
  { id: 'anime',     name: 'Kawaii Box',     price: 8500, tier: 'rare', swatch: '#ffc2e2', desc: 'Anime box with big sparkly eyes' },
  { id: 'cyber',     name: 'Cyber Grid Box', price: 8500, tier: 'rare', swatch: '#0b0f1e', desc: 'Neon grid cyber cargo' },
  // 나라 특색 배달통 (누구나 구매 가능)
  { id: 'bajaj',      name: 'Mini Bajaj',      price: 8500, tier: 'rare', swatch: '#2a6fd4', desc: 'Indonesia: blue three-wheel Bajaj', tag: 'ID' },
  { id: 'tuktukbox',  name: 'Mini Tuk-Tuk',    price: 8500, tier: 'rare', swatch: '#1d3557', desc: 'Thailand: tasselled tuk-tuk', tag: 'TH' },
  { id: 'jeepneybox', name: 'Mini Jeepney',    price: 20000, tier: 'epic', swatch: '#d9dde1', desc: 'Philippines: chrome jeepney with stripes', tag: 'PH' },
  { id: 'petronas',   name: 'Twin Towers',     price: 45000, tier: 'legendary', swatch: '#c0c6cc', desc: 'Malaysia: Petronas twin towers + skybridge', tag: 'MY' },
  { id: 'angkorbox',  name: 'Angkor Temple',   price: 20000, tier: 'epic', swatch: '#bfae8c', desc: 'Cambodia: sandstone lotus towers', tag: 'KH' },
  { id: 'shwedagon',  name: 'Golden Pagoda',   price: 45000, tier: 'legendary', swatch: '#e6b422', desc: 'Myanmar: Shwedagon golden stupa', tag: 'MM' },
  // 공용 배달통
  { id: 'pizzatower', name: 'Pizza Tower',     price: 20000, tier: 'epic', swatch: '#d9b483', desc: 'Five boxes and an open hot pizza' },
  { id: 'minifridge', name: 'Mini Fridge',     price: 8500, tier: 'rare', swatch: '#a8e6cf', desc: 'Mint retro fridge, chrome handles' },
  { id: 'fishbox',    name: 'Fish Box',        price: 3000, tier: 'common',  swatch: '#f4f4ee', desc: 'Styrofoam fish box with ice and a tail' },
  { id: 'boombox',    name: 'Boombox',         price: 8500, tier: 'rare', swatch: '#1d1f22', desc: 'Twin woofers and a glowing equalizer' },
  { id: 'giftbox',    name: 'Gift Box',        price: 8500, tier: 'rare', swatch: '#d62828', desc: 'Red present with a gold ribbon bow' },
  { id: 'gascapsule', name: 'Booster Capsule', price: 20000, tier: 'epic', swatch: '#b8c0c8', desc: 'Pressurized tank with a glowing ring' },
  { id: 'steamer',    name: 'Dim Sum Steamer', price: 20000, tier: 'epic', swatch: '#d4b06a', desc: 'Three-stack bamboo steamer, hot steam' },
  { id: 'parcel',     name: 'Taped Parcel',    price: 3000, tier: 'common',  swatch: '#c89b64', desc: 'Way too much tape. Handle with care' },
  { id: 'catbox',     name: 'Cat Box',         price: 20000, tier: 'epic', swatch: '#f3a65a', desc: 'A cat moved in. It is their box now' },
  { id: 'goldbar',    name: 'Gold Bars',       price: 45000, tier: 'legendary', swatch: '#ffd34d', desc: 'A stack of solid gold ingots' },
  { id: 'aquarium',   name: 'Aquarium',        price: 45000, tier: 'legendary', swatch: '#9fd8ff', desc: 'See-through tank with fish and plants' },
  { id: 'icecream',   name: 'Ice Cream Box',   price: 8500, tier: 'rare', swatch: '#ff8fab', desc: 'Triple-scoop cone on a cooler box' },
  // 국가대표 전용 배달통: 국가 1위일 때 국가대표 바이크와 함께 지급, 1위를 뺏기면 함께 회수
  { id: 'national',  name: 'National Box',   price: -1,   swatch: '#ffd700', desc: 'Only for the current #1 rider of your country', special: 'national' },
];
export const OUTFITS = [
  { id: 'jacket',     name: 'Rider Jacket',  price: 0,    swatch: '#00b14f', desc: 'Signature green jacket' },
  { id: 'raincoat',   name: 'Yellow Poncho', price: 3000, tier: 'common',  swatch: '#ffd21f', desc: 'Squall-proof rain poncho' },
  { id: 'raincoat_p', name: 'Pink Poncho',   price: 3000, tier: 'common',  swatch: '#ff6fae', desc: 'High-visibility pink poncho' },
  { id: 'hivis',      name: 'Hi-Vis Vest',   price: 3500, tier: 'common', swatch: '#ff8c00', desc: 'Safety orange with reflectors' },
  { id: 'leather',    name: 'Black Leather', price: 8500, tier: 'rare', swatch: '#1b1b1f', desc: 'Classic biker leather' },
  { id: 'racing',     name: 'Racing Suit',   price: 8500, tier: 'rare', swatch: '#d62828', desc: 'Track-day racing leathers' },
  { id: 'tux',        name: 'Night Tux',     price: 18000, tier: 'epic', swatch: '#2b2d42', desc: 'Deliver in style' },
];
export const HELMETS = [
  { id: 'basic',  name: 'Green Half',  price: 0,    swatch: '#00b14f', desc: 'Standard half helmet' },
  { id: 'retro',  name: 'Retro',       price: 3000, tier: 'common',  swatch: '#f3efe6', desc: 'Classic red stripe' },
  { id: 'full',   name: 'Full Face',   price: 3500, tier: 'common',  swatch: '#15171a', desc: 'Blue mirrored visor' },
  { id: 'neko',   name: 'Neko Ears',   price: 8500, tier: 'rare', swatch: '#ffb3c7', desc: 'Cute cat-ear helmet' },
  { id: 'carbon', name: 'Carbon Pro',  price: 8500, tier: 'rare', swatch: '#3a3d42', desc: 'Lightweight carbon shell' },
  { id: 'chrome', name: 'Chrome Dome', price: 20000, tier: 'epic', swatch: '#c0c6cc', desc: 'Mirror-polished chrome' },
  { id: 'gold',   name: 'Gold Helmet', price: 20000, tier: 'epic', swatch: '#e6b422', desc: 'Mark of a top ranker' },
  { id: 'crown',  name: 'Streak Crown', price: -1,  swatch: '#ffd700', desc: '7-day login streak reward', special: true },
  // 헬멧이 아닌 헤드기어
  { id: 'snapback',  name: 'Snapback Cap',   price: 3000, tier: 'common',  swatch: '#16181d', desc: 'Street snapback with green brim' },
  { id: 'straw',     name: 'Straw Hat',      price: 3500, tier: 'common', swatch: '#e9c46a', desc: 'Wide-brim summer straw hat' },
  { id: 'dino',      name: 'Dino Head',      price: 20000, tier: 'epic', swatch: '#52b788', desc: 'Rawr. Spiky dinosaur head' },
  { id: 'chibi',     name: 'Chibi Big Head', price: 20000, tier: 'epic', swatch: '#ffe0bd', desc: 'Oversized cute character mask' },
  { id: 'cyberneon', name: 'Cyber Neon',     price: 45000, tier: 'legendary', swatch: '#14141c', desc: 'Glowing visor and neon lines' },
  // 나라 특색 헤드기어 (누구나 구매 가능)
  { id: 'nonla',     name: 'Nón Lá',         price: 4000, tier: 'common', swatch: '#e8cf8a', desc: 'Vietnam: palm-leaf conical hat', tag: 'VN' },
  { id: 'batik',     name: 'Batik Helmet',   price: 8500, tier: 'rare', swatch: '#7a4a22', desc: 'Indonesia: hand-drawn batik shell', tag: 'ID' },
  { id: 'mongkol',   name: 'Mongkol',        price: 8500, tier: 'rare', swatch: '#d62828', desc: 'Thailand: Muay Thai sacred headband', tag: 'TH' },
  { id: 'merlion',   name: 'Merlion Mask',   price: 45000, tier: 'legendary', swatch: '#f4f4f0', desc: 'Singapore: lion head with a gold mane', tag: 'SG' },
  { id: 'angkorhat', name: 'Angkor Tower',   price: 20000, tier: 'epic', swatch: '#bfae8c', desc: 'Cambodia: carved stone tower helmet', tag: 'KH' },
  // 공용 헤드기어
  { id: 'durian',    name: 'Durian',         price: 8500, tier: 'rare', swatch: '#b5c94a', desc: 'King of fruits. Do not touch' },
  { id: 'duckprop',  name: 'Duck Propeller', price: 8500, tier: 'rare', swatch: '#ffd60a', desc: 'Quack with a spinning propeller' },
  { id: 'crttv',     name: 'CRT TV',         price: 20000, tier: 'epic', swatch: '#d9cfb4', desc: 'Chunky retro TV with a happy screen' },
];

// 컬러 팔레트: 한 번 사면 바이크·헤드기어 둘 다에 칠할 수 있음
// finish: solid(단색) / metallic(메탈릭 광택) / neon(발광)
export const PAINTS = [
  { id: 'red',       name: 'Racing Red',     hex: 0xe63946, finish: 'solid',    price: 1500, tier: 'common' },
  { id: 'blue',      name: 'Royal Blue',     hex: 0x1d4ed8, finish: 'solid',    price: 1500, tier: 'common' },
  { id: 'yellow',    name: 'Taxi Yellow',    hex: 0xffc300, finish: 'solid',    price: 1500, tier: 'common' },
  { id: 'white',     name: 'Pure White',     hex: 0xf8f9fa, finish: 'solid',    price: 1500, tier: 'common' },
  { id: 'black',     name: 'Matte Black',    hex: 0x1a1a1d, finish: 'solid',    price: 1500, tier: 'common' },
  { id: 'orange',    name: 'Sunset Orange',  hex: 0xff6b00, finish: 'solid',    price: 1500, tier: 'common' },
  { id: 'purple',    name: 'Grape Purple',   hex: 0x7b2cbf, finish: 'solid',    price: 1500, tier: 'common' },
  { id: 'mint',      name: 'Mint',           hex: 0x80ed99, finish: 'solid',    price: 1500, tier: 'common' },
  { id: 'silver',    name: 'Metallic Silver', hex: 0xc0c6cc, finish: 'metallic', price: 4000, tier: 'rare' },
  { id: 'gold',      name: 'Metallic Gold',  hex: 0xd4af37, finish: 'metallic', price: 4000, tier: 'rare' },
  { id: 'gunmetal',  name: 'Gunmetal',       hex: 0x4a4f57, finish: 'metallic', price: 4000, tier: 'rare' },
  { id: 'rosegold',  name: 'Rose Gold',      hex: 0xe8a598, finish: 'metallic', price: 4000, tier: 'rare' },
  { id: 'mblue',     name: 'Metallic Blue',  hex: 0x2a6fdb, finish: 'metallic', price: 4000, tier: 'rare' },
  { id: 'ngreen',    name: 'Neon Green',     hex: 0x39ff14, finish: 'neon',     price: 8000, tier: 'epic' },
  { id: 'npink',     name: 'Neon Pink',      hex: 0xff2fd6, finish: 'neon',     price: 8000, tier: 'epic' },
  { id: 'ncyan',     name: 'Neon Cyan',      hex: 0x00e5ff, finish: 'neon',     price: 8000, tier: 'epic' },
  { id: 'norange',   name: 'Neon Orange',    hex: 0xff7a00, finish: 'neon',     price: 8000, tier: 'epic' },
];

// 랜덤 가차 상자 (상자·의상·헬멧 중 미보유 아이템 1개, 전부 보유 시 일부 환급)
// 판 수입·비용 수치. 서버 app_config('economy') 값이 있으면 실행 시 덮어씀 (앱 업데이트 없이 밸런스 조정)
// 목표: 보통 판(약 4 km) 수입 700~1,000 코인
export const ECON = {
  coinValue: 2,       // 길 위 코인 1개
  dropReward: 50,     // 드롭존 통과
  hotReward: 200,     // 핫 딜리버리 성공
  kmBonus: 50,        // 1 km 돌파마다
  continueCost: 500,  // 판 끝 이어하기
  gachaPrice: 4000,   // 미스터리 박스
  gachaRefund: 1600,  // 전부 보유 시 환급
  missionBase: 80,    // 미션 보상 = base + 레벨 * step
  missionStep: 80,
};
export const GACHA_PRICE = ECON.gachaPrice; // (호환용) 실제 사용은 ECON.gachaPrice
export const GACHA_REFUND = ECON.gachaRefund;
// 미스터리 박스 등급 확률 (%): 먼저 등급을 뽑고, 그 등급의 미보유 아이템 중 하나. 그 등급을 다 가졌으면 남은 등급끼리 비율대로
export const GACHA_ODDS = { common: 60, rare: 30, epic: 9, legendary: 1 };
// 아이템 등급: 가격대 기준 (한 판 평균 약 850 코인 → Common 3~5판 / Rare 10판 / Epic 25판 / Legendary 50판+)
export const TIERS = {
  common:    { label: 'COMMON',    color: '#8d99ae' },
  rare:      { label: 'RARE',      color: '#2a6fdb' },
  epic:      { label: 'EPIC',      color: '#8e44ec' },
  legendary: { label: 'LEGENDARY', color: '#e0a800' },
};

// 7일 연속 출석 보상 (7일차: 코인 + 특수 헬멧)
export const STREAK_REWARDS = [300, 450, 600, 900, 1200, 1500, 2500];
export const STREAK_SPECIAL_HELMET = 'crown';

// ======================================================================
// 도로변 빌보드 포스터 (국가별 가상 브랜드 패러디)
// ======================================================================
// 실제 상표·로고·고유 배색을 흉내 내지 않는 가상 브랜드 말장난만 사용 (나라 분위기만 살림)
export const BILLBOARD_POSTERS = {
  ID: [
    { title: 'MIE GORENG MANIA', sub: 'Pedas level 10. Berani?', bg: '#d62828', fg: '#ffd60a' },
    { title: 'ES TEH SEGER', sub: 'Manis, dingin, mantap', bg: '#2d6a4f', fg: '#f1faee' },
    { title: 'GRUB FOOD', sub: 'Lapar? Kami antar!', bg: '#00b14f', fg: '#ffffff' },
  ],
  VN: [
    { title: 'PHO SHO', sub: 'Broth that slaps since forever', bg: '#c1121f', fg: '#fdf0d5' },
    { title: 'BANH MI BRO', sub: 'Crunch o\'clock', bg: '#ffb703', fg: '#432818' },
    { title: 'CA PHE DA DA', sub: 'Strong. Sweet. Iced.', bg: '#3e2723', fg: '#ffe8d6' },
  ],
  TH: [
    { title: 'TOM YUM BOOM', sub: 'Spicy level: volcano', bg: '#ff006e', fg: '#ffffff' },
    { title: 'MANGO STICKY', sub: 'Dessert first, always', bg: '#ffbe0b', fg: '#3a0ca3' },
    { title: 'TUK TUK TURBO', sub: 'Ride in 2 min', bg: '#06d6a0', fg: '#073b4c' },
  ],
  MY: [
    { title: 'TEH TARIK TOWER', sub: 'Pulled high, poured proud', bg: '#7f4f24', fg: '#ffe8d6' },
    { title: 'NASI LEMAK NATION', sub: 'Sambal sampai pagi', bg: '#2d6a4f', fg: '#ffd60a' },
    { title: 'DURIAN DREAM', sub: 'Smell it. Love it.', bg: '#ffd60a', fg: '#1b4332' },
  ],
  PH: [
    { title: 'HALO-HALO HEAVEN', sub: 'Mix it all, halo na!', bg: '#7b2cbf', fg: '#ffd60a' },
    { title: 'JEEPNEY JOY', sub: 'Bayad po! Next stop: fun', bg: '#ffd60a', fg: '#d00000' },
    { title: 'MANG ADOBO', sub: 'Sarap since forever', bg: '#d00000', fg: '#ffffff' },
  ],
  KH: [
    { title: 'AMOK AMOK', sub: 'Steamed in banana leaf', bg: '#2d6a4f', fg: '#ffd166' },
    { title: 'SUGARCANE SPLASH', sub: 'Fresh-pressed, ice cold', bg: '#9bbf4a', fg: '#1b4332' },
    { title: 'TEMPLE RUN TOURS', sub: 'Sunrise at the five towers', bg: '#032ea1', fg: '#ffffff' },
  ],
  MM: [
    { title: 'MOHINGA MORNING', sub: 'Fish noodle soup, the right way', bg: '#e09f3e', fg: '#3d1f00' },
    { title: 'LAPHET LOVE', sub: 'Tea leaf salad crunch', bg: '#386641', fg: '#f2e8cf' },
    { title: 'GOLDEN THANAKA', sub: 'Cool face, hot day', bg: '#fecb00', fg: '#34312e' },
  ],
  SG: [
    { title: 'LION CITY AIR', sub: 'Fly the little red dot', bg: '#d90429', fg: '#ffffff' },
    { title: 'KAYA KAYA TOAST', sub: 'Breakfast of legends', bg: '#80b918', fg: '#ffffff' },
    { title: 'HAWKER HEAVEN', sub: 'Chilli crab, zero queue*', bg: '#ff9f1c', fg: '#2b2d42' },
  ],
};

// ======================================================================
// 공유 & 광고
// ======================================================================
// WhatsApp 챌린지 링크의 기본 주소. 비워두면 현재 게임 주소를 사용 (예: 'https://grabrider.app/')
export const SHARE_BASE_URL = '';
// 플레이 스토어 주소 (출시 후 넣으면 하이라이트 영상 마지막 화면에 'GET IT ON GOOGLE PLAY' 와 함께 표시. 비우면 게임 링크)
export const STORE_URL = '';

// 보상형 광고 (배너 광고는 사용하지 않음)
//   provider: 'h5'   → Google H5 Games Ads (AdSense 계정 + H5 Games 승인 필요, adClient 입력)
//             'mock' → 테스트용 가짜 광고 (5초 카운트다운 후 보상)
//             'none' → 광고 버튼 숨김
export const ADS = {
  provider: 'mock',
  adClient: '',          // 예: 'ca-pub-1234567890123456'
  testMode: true,        // H5 Games Ads 테스트 모드 (data-adbreak-test="on")
  freeCoins: 200,        // 차고 무료 코인 보상 (한 판 수입의 약 1/4)
  freeCoinsCooldownSec: 1200, // 20분 쿨타임: 광고만 보는 게 직접 달리는 것보다 이득이 되지 않게
};

// ======================================================================
// 코인 결제 (인앱결제)
// ======================================================================
// provider: 'mock'   → 테스트용 가짜 결제 (실제 돈 안 나감, 코인은 이 기기 계정에만 바로 추가)
//           'native' → 앱(Capacitor) + RevenueCat 플러그인으로 구글/애플 결제. 코인은 서버 웹훅이 지급
//           'off'    → 상점 숨김
// 상품 ID 는 플레이 콘솔/앱스토어 커넥트/RevenueCat 에 같은 이름으로 만들고,
// supabase/functions/revenuecat-webhook/index.ts 의 PRODUCT_COINS 와 코인 수를 맞춰야 합니다.
export const PAYMENTS = {
  provider: 'mock',
  revenuecatApiKeyAndroid: '', // RevenueCat 공개 SDK 키 (goog_...)
  revenuecatApiKeyIos: '',     // RevenueCat 공개 SDK 키 (appl_...)
};
// testPrice: mock 모드에서만 보이는 예시 가격 (실제 가격은 스토어가 나라별 현지 통화로 표시)
// bonus: 기본 팩(3,000 / $0.99) 대비 같은 가격당 추가 코인 비율. 표시는 정확해야 함(소비자보호법)
export const COIN_PACKS = [
  { id: 'grub_coins_s',  coins: 3000,  bonus: 0,  testPrice: '$0.99',  tag: '' },
  { id: 'grub_coins_m',  coins: 10000, bonus: 10, testPrice: '$2.99',  tag: 'POPULAR' },
  { id: 'grub_coins_l',  coins: 22000, bonus: 21, testPrice: '$5.99',  tag: '' },
  { id: 'grub_coins_xl', coins: 65000, bonus: 43, testPrice: '$14.99', tag: 'BEST VALUE' },
];

// 공지 기본값: 서버 app_config('notices') 가 있으면 그것으로 대체. 최신이 위. id 가 바뀌면 NEWS 버튼에 새 글 점 표시
// tag: UPDATE / EVENT / NOTICE / MAINTENANCE
export const DEFAULT_NOTICES = [
  {
    id: '2026-11-01-update', date: '2026-11-01', tag: 'UPDATE', title: 'New items, tiers & fairer rewards',
    body: 'Every item now has a tier: Common, Rare, Epic and Legendary.\n26 new boxes and helmets from all over Southeast Asia - Merlion, Petronas Twin Towers, Golden Pagoda, a cat box, an aquarium and more.\nRuns pay more: coins are worth 2, drop zones +50, and every km gives +50.\nNew HEAD START boost: blast off at 1.5x speed.',
  },
];

// 앱 정보 (설정 화면 하단)
export const APP_INFO = { name: 'Grub Rider', version: '1.0.0', contactEmail: '' };

// ---------- 소모성 부스트 (출발 전 장착 → 다음 판 시작 시 1개씩 소모)
// 메뉴 BOOSTS 줄에서 코인으로 1개씩 구매, 코인 상점에서 5개 묶음(1개 무료) 구매
export const BOOSTS = [
  { id: 'shield', name: 'SHIELD', desc: 'Start with a shield that blocks one crash', price: 400, icon: 'shield' },
  { id: 'headstart', name: 'HEAD START', desc: 'Blast off at 1.5x top speed for 5 s, invincible, grabbing every coin', price: 400, icon: 'bolt' },
  { id: 'x2', name: 'x2 SCORE 30s', desc: 'Double score for the first 30 s', price: 500, icon: 'x2' },
  { id: 'giant', name: 'GIANT START', desc: 'Start huge and unstoppable', price: 600, icon: 'giant' },
  { id: 'revive', name: 'SECOND CHANCE', desc: 'Get back on the road once after a crash, free', price: 1000, icon: 'retry' },
];
export const BOOST_BUNDLE = { count: 5, payFor: 4 };
export const BOOST_START_TIME = 30; // x2 SCORE 부스트 지속 시간(초)
export const HEAD_START_TIME = 5;   // HEAD START: 최고속 1.5배 무적 질주 시간(초)
