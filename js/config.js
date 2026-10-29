// 배포 환경별 설정. 비워두면 로컬 모드(이 기기 브라우저 저장소)로 동작합니다.

// ---------- 온라인 계정 & 글로벌 랭킹 (Supabase)
// supabase/schema.sql 을 Supabase SQL Editor 에서 실행한 뒤 아래 두 값을 채우세요.
// (Authentication > Providers > Email 에서 "Confirm email" 을 꺼야 아이디 가입이 바로 됩니다)
export const SUPABASE_URL = 'https://oavlcqityoudwxylgllj.supabase.co';
// 공개용 키 (publishable / anon). service_role·secret 키는 절대 넣지 마세요.
export const SUPABASE_ANON_KEY = 'sb_publishable_fnhE6hTPp8Wwqj_W1gjiog_qT84mTI4';

// 아이디를 Supabase 이메일 계정으로 바꿀 때 붙이는 가상 도메인
export const ID_EMAIL_DOMAIN = 'grabrider.game';

// ---------- 1v1 멀티플레이 (PeerJS)
// null 이면 PeerJS 공개 브로커(0.peerjs.com)를 사용합니다.
// 자체 서버를 쓰려면: { host: 'my-peer.example.com', port: 443, path: '/', secure: true }
export const PEER_SERVER = null;

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
