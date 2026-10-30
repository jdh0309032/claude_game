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
// 국가 재조회 주기 (시간). 사용자가 설정에서 직접 고른 국가는 덮어쓰지 않습니다.
export const GEO_REFRESH_HOURS = 24;

// ---------- 국가 1위 전용 '국기' 아이템
// 내 국가 랭킹 1위 여부를 서버(my_rank_v3)에서 이 주기(초)로 다시 확인합니다.
export const FLAG_CHECK_INTERVAL_SEC = 30;

// ---------- 1v1 멀티플레이 (PeerJS)
// null 이면 PeerJS 공개 브로커(0.peerjs.com)를 사용합니다.
// 자체 서버를 쓰려면: { host: 'my-peer.example.com', port: 443, path: '/', secure: true }
export const PEER_SERVER = null;

// NAT/LTE 환경에서도 P2P 가 잘 맺어지도록 Google STUN 명시
// + 직접 연결이 막힌 망을 위한 PeerJS 기본 TURN 릴레이 유지
export const PEER_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
// PeerJS 로그 레벨: 0 없음 · 1 에러 · 2 경고+에러 · 3 전체
export const PEER_DEBUG = 2;

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
  { id: 'city',    name: 'City Commuter',      price: 1500,  maxKmh: 190, accel: 1.08, handling: 1.08, color: 0x2a9df4, style: 'scooter', desc: 'Nimble in tight traffic' },
  { id: 'vintage', name: 'Vintage Classic',    price: 2500,  maxKmh: 200, accel: 1.05, handling: 1.15, color: 0x8b1e2d, style: 'classic', desc: 'Chrome and leather charm' },
  { id: 'express', name: 'Delivery Express',   price: 4000,  maxKmh: 215, accel: 1.2,  handling: 1.15, color: 0x00b14f, style: 'express', desc: 'Built for long shifts' },
  { id: 'sport',   name: 'Sport Street 250',   price: 6000,  maxKmh: 240, accel: 1.3,  handling: 1.25, color: 0xff6b00, style: 'sport',   desc: 'Razor-sharp handling' },
  { id: 'enduro',  name: 'Off-Road Enduro',    price: 8000,  maxKmh: 235, accel: 1.35, handling: 1.42, color: 0xffd60a, style: 'enduro',  desc: 'Shrugs off puddles' },
  { id: 'phantom', name: 'Phantom X',          price: 12000, maxKmh: 280, accel: 1.5,  handling: 1.45, color: 0x7b2cbf, style: 'sport',   desc: 'Legendary hyperbike' },
  { id: 'cyber',   name: 'Cyber Pulse 3000',   price: 15000, maxKmh: 310, accel: 1.65, handling: 1.55, color: 0x101820, style: 'cyber',   desc: 'Neon-lit future machine' },
];

// 배달 상자 / 라이더 의상 / 헬멧: 기본 1종(무료) + 유료 6종 (500 ~ 3,000 코인)
export const BOXES = [
  { id: 'basic',     name: 'Classic Box',    price: 0,    swatch: '#00b14f', desc: 'Standard green delivery box' },
  { id: 'styrofoam', name: 'Cooler Box',     price: 500,  swatch: '#f4f4ee', desc: 'Styrofoam box for fresh food' },
  { id: 'pizza',     name: 'Pizza Stack',    price: 800,  swatch: '#e63946', desc: 'Hot pizza warmer bag' },
  { id: 'neon',      name: 'Neon Box',       price: 1200, swatch: '#00f0ff', desc: 'Glowing neon trim at night' },
  { id: 'camo',      name: 'Camo Crate',     price: 1800, swatch: '#5b6b3a', desc: 'Military-grade cargo' },
  { id: 'treasure',  name: 'Treasure Chest', price: 2500, swatch: '#7a4a22', desc: 'Wooden chest with gold trim' },
  { id: 'goldbox',   name: 'Gold Vault',     price: 3000, swatch: '#e6b422', desc: 'Solid gold delivery vault' },
];
export const OUTFITS = [
  { id: 'jacket',     name: 'Rider Jacket',  price: 0,    swatch: '#00b14f', desc: 'Signature green jacket' },
  { id: 'raincoat',   name: 'Yellow Poncho', price: 500,  swatch: '#ffd21f', desc: 'Squall-proof rain poncho' },
  { id: 'raincoat_p', name: 'Pink Poncho',   price: 800,  swatch: '#ff6fae', desc: 'High-visibility pink poncho' },
  { id: 'hivis',      name: 'Hi-Vis Vest',   price: 1200, swatch: '#ff8c00', desc: 'Safety orange with reflectors' },
  { id: 'leather',    name: 'Black Leather', price: 1800, swatch: '#1b1b1f', desc: 'Classic biker leather' },
  { id: 'racing',     name: 'Racing Suit',   price: 2500, swatch: '#d62828', desc: 'Track-day racing leathers' },
  { id: 'tux',        name: 'Night Tux',     price: 3000, swatch: '#2b2d42', desc: 'Deliver in style' },
];
export const HELMETS = [
  { id: 'basic',  name: 'Green Half',  price: 0,    swatch: '#00b14f', desc: 'Standard half helmet' },
  { id: 'retro',  name: 'Retro',       price: 500,  swatch: '#f3efe6', desc: 'Classic red stripe' },
  { id: 'full',   name: 'Full Face',   price: 800,  swatch: '#15171a', desc: 'Blue mirrored visor' },
  { id: 'neko',   name: 'Neko Ears',   price: 1200, swatch: '#ffb3c7', desc: 'Cute cat-ear helmet' },
  { id: 'carbon', name: 'Carbon Pro',  price: 1800, swatch: '#3a3d42', desc: 'Lightweight carbon shell' },
  { id: 'chrome', name: 'Chrome Dome', price: 2500, swatch: '#c0c6cc', desc: 'Mirror-polished chrome' },
  { id: 'gold',   name: 'Gold Helmet', price: 3000, swatch: '#e6b422', desc: 'Mark of a top ranker' },
  { id: 'crown',  name: 'Streak Crown', price: -1,  swatch: '#ffd700', desc: '7-day login streak reward', special: true },
];

// 랜덤 가차 상자 (상자·의상·헬멧 중 미보유 아이템 1개, 전부 보유 시 일부 환급)
export const GACHA_PRICE = 1000;
export const GACHA_REFUND = 400;

// 7일 연속 출석 보상 (7일차: 코인 + 특수 헬멧)
export const STREAK_REWARDS = [200, 300, 400, 600, 800, 1000, 1500];
export const STREAK_SPECIAL_HELMET = 'crown';

// ======================================================================
// 도로변 빌보드 포스터 (국가별 브랜드 패러디)
// ======================================================================
export const BILLBOARD_POSTERS = {
  ID: [
    { title: 'INDOMIE GO', sub: 'Mie goreng 24/7', bg: '#d62828', fg: '#ffd60a' },
    { title: 'TEH BOTOL', sub: 'Ice cold, extra sweet', bg: '#ffb703', fg: '#1d3557' },
    { title: 'GRAB FOOD', sub: 'Lapar? Order now', bg: '#00b14f', fg: '#ffffff' },
  ],
  VN: [
    { title: 'PHO KING', sub: 'Hanoi\'s finest broth', bg: '#c1121f', fg: '#fdf0d5' },
    { title: 'BANH MI BRO', sub: 'Crunchy since 1958', bg: '#ffb703', fg: '#432818' },
    { title: 'CA PHE SUA', sub: 'Strong. Sweet. Iced.', bg: '#3e2723', fg: '#ffe8d6' },
  ],
  TH: [
    { title: 'TOM YUM MAX', sub: 'Spicy level 99', bg: '#ff006e', fg: '#ffffff' },
    { title: 'SIAM COLA', sub: 'Taste of Bangkok', bg: '#3a0ca3', fg: '#f72585' },
    { title: 'TUK TUK GO', sub: 'Ride in 2 min', bg: '#06d6a0', fg: '#073b4c' },
  ],
  KR: [
    { title: 'KIMCHI COLA', sub: 'Fermented fizz', bg: '#e63946', fg: '#ffffff' },
    { title: 'SOJU LIGHT', sub: 'Only 12 kcal*', bg: '#2a9d8f', fg: '#e9f5db' },
    { title: 'K-POP LIVE', sub: 'Gangnam Arena tonight', bg: '#7209b7', fg: '#4cc9f0' },
  ],
  JP: [
    { title: 'RAMEN 24H', sub: 'Shibuya station exit 8', bg: '#ffbe0b', fg: '#d00000' },
    { title: 'NEKO PHONE', sub: 'Purrfect signal', bg: '#ff70a6', fg: '#ffffff' },
    { title: 'SUSHI EXPRESS', sub: 'Conveyor at light speed', bg: '#0077b6', fg: '#caf0f8' },
  ],
  SG: [
    { title: 'MERLION AIR', sub: 'Fly the lion city', bg: '#d90429', fg: '#ffffff' },
    { title: 'KAYA TOAST', sub: 'Breakfast of legends', bg: '#80b918', fg: '#ffffff' },
    { title: 'HAWKER HUB', sub: 'Michelin on a budget', bg: '#ff9f1c', fg: '#2b2d42' },
  ],
  US: [
    { title: 'BURGER KINGDOM', sub: 'Have it your way-ish', bg: '#f77f00', fg: '#3d0c02' },
    { title: 'STARBUZZ', sub: 'Venti everything', bg: '#1b4332', fg: '#d8f3dc' },
    { title: 'COCA LOCA', sub: 'Open crazyness', bg: '#c1121f', fg: '#ffffff' },
  ],
  FR: [
    { title: 'CROISSANT & CO', sub: 'Beurre. Toujours.', bg: '#fefae0', fg: '#bc6c25' },
    { title: 'LOUVRE VIP', sub: 'Skip the line', bg: '#14213d', fg: '#fca311' },
    { title: 'VELO PARIS', sub: 'Pedal the boulevards', bg: '#e63946', fg: '#f1faee' },
  ],
};

// ======================================================================
// 공유 & 광고
// ======================================================================
// WhatsApp 챌린지 링크의 기본 주소. 비워두면 현재 게임 주소를 사용 (예: 'https://grabrider.app/')
export const SHARE_BASE_URL = '';

// 보상형 광고 (배너 광고는 사용하지 않음)
//   provider: 'h5'   → Google H5 Games Ads (AdSense 계정 + H5 Games 승인 필요, adClient 입력)
//             'mock' → 테스트용 가짜 광고 (5초 카운트다운 후 보상)
//             'none' → 광고 버튼 숨김
export const ADS = {
  provider: 'mock',
  adClient: '',          // 예: 'ca-pub-1234567890123456'
  testMode: true,        // H5 Games Ads 테스트 모드 (data-adbreak-test="on")
  freeCoins: 300,        // 차고 무료 코인 보상
  freeCoinsCooldownSec: 180, // 3분 쿨타임 (어뷰징 방지 / eCPM 유지)
};
