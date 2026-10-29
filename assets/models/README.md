# 외부 3D 모델 (.glb / .gltf)

이 폴더에 모델 파일을 넣고 `js/config.js` 의 `MODEL_CONFIG` 에 경로를 지정하면,
기본 로우폴리(절차적) 모델 대신 해당 모델이 사용됩니다. 파일이 없거나 로딩에 실패하면
콘솔에 경고만 남기고 기존 모델이 그대로 보입니다.

```js
// js/config.js
export const MODEL_CONFIG = {
  'bike':      { url: 'assets/models/scooter.glb', fit: 'length', size: 1.9, rotateY: Math.PI },
  'car.sedan': { url: 'assets/models/sedan.glb',   fit: 'length', size: 4.4 },
  'prop.palm': { url: 'assets/models/palm.glb',    fit: 'height', size: 6 },
  // ...
};
```

| 옵션 | 설명 |
| --- | --- |
| `url` | 모델 파일 경로 |
| `fit` / `size` | `length`(Z)·`height`(Y)·`width`(X) 중 한 축을 `size` 미터에 맞춰 자동 스케일 |
| `rotateY` | 모델 정면이 -Z 가 아닐 때 회전 보정 (라디안) |
| `offsetY` | 높이 보정 (모델은 자동으로 바닥 y=0, 중심 x/z=0 에 맞춰짐) |

## 키 목록

| 키 | 적용 대상 | 방식 |
| --- | --- | --- |
| `bike` | 바이크 + 라이더 전체 | 개별 메시 (커스텀 의상/헬멧/상자 대신 사용) |
| `box` | 뒷좌석 배달 상자만 | 개별 메시 (절차적 바이크 위에 얹음) |
| `car.sedan` `car.taxi` `car.police` `car.suv` `car.truck` `car.bus` `car.ramp` | 차량 | 개별 메시 (색상/깜빡이 미적용) |
| `obstacle.stall` | 갓길 노점상 | 개별 메시 |
| `prop.palm` `prop.ruko` `prop.warung` `prop.building` `prop.lamp` | 도로변 배경 | 인스턴싱 (모든 메시를 하나로 합쳐 사용) |
| `obstacle.cone` `obstacle.sign` | 라바콘 / 공사 표지판 | 인스턴싱 |

- 충돌 판정 크기는 모델과 무관하게 `js/models.js` 의 `CAR_DEFS` / `STALL_DEFS` 값을 사용하므로, `size` 를 그 값에 맞추세요.
- 런타임 교체도 가능합니다: `models.register('car.taxi', { url: '...', fit: 'length', size: 4.4 })`
- 모바일 성능을 위해 모델당 수천 폴리곤 이하, 텍스처 1024px 이하를 권장합니다.
