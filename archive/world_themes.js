// 보관용: 동남아 외 지역 맵 (한국·일본·미국·프랑스). 현재 게임에서는 스폰하지 않습니다.
// 다시 쓰려면 아래 테마를 js/themes.js 의 THEMES 배열에, 광고판 포스터를 js/config.js 의 BILLBOARD_POSTERS 에 넣으세요.
// 건물 스타일(neon / modern / brick / haussmann), 가로수(sakura / ginkgo / round), 노점(vending / cafe / tent),
// 랜드마크(namsan / tokyotower / empire / eiffel) 모델은 js/models.js 에 그대로 남아 있어 바로 쓸 수 있습니다.

export const WORLD_THEMES = [
  {
    code: 'KR', drive: 'R', country: 'South Korea', city: 'Seoul', welcome: 'WELCOME TO SEOUL',
    building: { neon: 0.75, modern: 0.25 }, tree: 'ginkgo', curb: 'tent', landmark: 'namsan', overhead: '',
    tint: 0xa9b8ff, tintAmt: 0.12, traffic: {},
  },
  {
    code: 'JP', drive: 'L', country: 'Japan', city: 'Tokyo', welcome: 'WELCOME TO TOKYO',
    building: { neon: 0.85, modern: 0.15 }, tree: 'sakura', curb: 'vending', landmark: 'tokyotower', overhead: '',
    tint: 0xffb3d1, tintAmt: 0.14, traffic: {},
  },
  {
    code: 'US', drive: 'R', country: 'USA', city: 'New York', welcome: 'WELCOME TO NEW YORK',
    building: { brick: 0.8, modern: 0.2 }, tree: 'round', curb: 'cafe', landmark: 'empire', overhead: '',
    tint: 0xffd6a5, tintAmt: 0.08, traffic: { taxi: 0.35 },
  },
  {
    code: 'FR', drive: 'R', country: 'France', city: 'Paris', welcome: 'BIENVENUE A PARIS',
    building: { haussmann: 1 }, tree: 'round', curb: 'cafe', landmark: 'eiffel', overhead: '',
    tint: 0xd7e3ff, tintAmt: 0.1, traffic: {},
  },
];

export const WORLD_BILLBOARD_POSTERS = {
  KR: [
    { title: 'KIMCHI FIZZ', sub: 'Fermented soda (yes, really)', bg: '#e63946', fg: '#ffffff' },
    { title: 'BANCHAN BAR', sub: 'Unlimited side dishes', bg: '#2a9d8f', fg: '#e9f5db' },
    { title: 'K-STAR LIVE', sub: 'Lightsticks up tonight', bg: '#7209b7', fg: '#4cc9f0' },
  ],
  JP: [
    { title: 'RAMEN RUSH 24H', sub: 'Slurp loudly. It\'s polite.', bg: '#ffbe0b', fg: '#d00000' },
    { title: 'NEKO PHONE', sub: 'Purrfect signal', bg: '#ff70a6', fg: '#ffffff' },
    { title: 'CONVEYOR SUSHI', sub: 'Plates at light speed', bg: '#0077b6', fg: '#caf0f8' },
  ],
  US: [
    { title: 'BURGER BARN', sub: 'Double stack, no regrets', bg: '#f77f00', fg: '#3d0c02' },
    { title: 'BEAN THERE', sub: 'Coffee, but bigger', bg: '#1b4332', fg: '#d8f3dc' },
    { title: 'FIZZY POP', sub: 'Bubbles for breakfast', bg: '#3a86ff', fg: '#ffffff' },
  ],
  FR: [
    { title: 'CROISSANT & CO', sub: 'Beurre. Toujours.', bg: '#fefae0', fg: '#bc6c25' },
    { title: 'MUSEE NIGHT PASS', sub: 'Art after dark', bg: '#14213d', fg: '#fca311' },
    { title: 'VELO VELO', sub: 'Pedal the boulevards', bg: '#e63946', fg: '#f1faee' },
  ],
};
