// 화면에 맺히는 빗물 (Canvas 2D 오버레이)
// - 작은 물방울이 맺히고, 커진 방울은 중력 방향(아래)으로만 천천히 흘러내림
// - 흘러내린 자리에 잔상(작은 방울 + 물줄기)이 남고, 방울 안에는 뒤 화면이 뒤집혀 비치는 굴절 표현
const MAX_DROPS = 70;

export class ScreenRain {
  constructor(canvas, source) {
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.src = source; // WebGL 캔버스 (굴절용 스냅샷 원본)
    this.snap = document.createElement('canvas');
    this.sx = this.snap.getContext('2d');
    this.drops = [];
    this.trails = [];
    this.acc = 0;
    this.enabled = true;
    this.dirty = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.k = Math.min(window.devicePixelRatio || 1, 1.25);
    this.c.width = Math.round(window.innerWidth * this.k);
    this.c.height = Math.round(window.innerHeight * this.k);
    this.snap.width = Math.max(1, Math.round(window.innerWidth / 4));
    this.snap.height = Math.max(1, Math.round(window.innerHeight / 4));
  }

  setEnabled(on) {
    this.enabled = on;
    this.c.style.display = on ? '' : 'none';
    if (!on) this.reset();
  }

  reset() {
    this.drops.length = 0;
    this.trails.length = 0;
    this.x.clearRect(0, 0, this.c.width, this.c.height);
  }

  // 물웅덩이를 밟았을 때 화면 아래쪽에 물방울이 한꺼번에 튐
  splash(n = 14) {
    if (!this.enabled) return;
    const W = this.c.width, H = this.c.height, k = this.k;
    for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
      this.drops.push({
        x: Math.random() * W, y: H * (0.45 + Math.random() * 0.5),
        r: (2.5 + Math.random() * 6) * k, vy: 0, slide: Math.random() < 0.4,
        age: 0, life: 1.5 + Math.random() * 2, lastTrail: 0, seed: Math.random() * 10,
      });
    }
  }

  // amount: 0~1 (스콜 강도), speed: m/s (빠를수록 많이 맺힘)
  update(dt, amount, speed) {
    if (!this.enabled) return;
    const W = this.c.width, H = this.c.height, k = this.k;
    this.acc += amount * (14 + speed * 0.35) * dt;
    while (this.acc > 1) {
      this.acc -= 1;
      if (this.drops.length >= MAX_DROPS) continue;
      this.drops.push({
        x: Math.random() * W, y: Math.random() * H * 0.92,
        r: (2 + Math.random() ** 2 * 8) * k, vy: 0, slide: false,
        age: 0, life: 3 + Math.random() * 5, lastTrail: 0, seed: Math.random() * 10,
      });
    }
    const drops = this.drops;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;
      if (!d.slide && d.r > 5.5 * k && Math.random() < dt * 0.7) {
        d.slide = true;
        d.lastTrail = d.y;
      }
      if (d.slide) {
        const vmax = (26 + d.r * 5) * k;
        d.vy = Math.min(vmax, d.vy + 38 * k * dt);
        d.y += d.vy * dt;
        d.x += Math.sin(d.age * 2.3 + d.seed) * 0.12 * k; // 아주 미세한 흔들림
        // 지나가는 길의 작은 방울 흡수
        for (let j = drops.length - 1; j >= 0; j--) {
          const o = drops[j];
          if (o === d || o.slide) continue;
          if (Math.abs(o.x - d.x) < d.r && Math.abs(o.y - d.y) < d.r) {
            d.r = Math.min(12 * k, Math.sqrt(d.r * d.r + o.r * o.r * 0.6));
            drops.splice(j, 1);
            if (j < i) i--;
          }
        }
        // 잔상: 일정 간격마다 작은 방울을 남기고 본체는 조금씩 줄어듦
        if (d.y - d.lastTrail > d.r * 1.3) {
          this.trails.push({ x: d.x + (Math.random() - 0.5) * d.r * 0.3, y: d.y - d.r, r: d.r * (0.22 + Math.random() * 0.15), age: 0, life: 1.4 + Math.random() });
          d.lastTrail = d.y;
          d.r *= 0.985;
        }
        if (d.y - d.r > H || d.r < 1.2 * k) drops.splice(i, 1);
      } else if (d.age > d.life + 1.2 || (amount < 0.05 && d.age > 1.5)) {
        drops.splice(i, 1);
      }
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.age += dt;
      if (t.age > t.life) this.trails.splice(i, 1);
    }
  }

  // 반드시 renderer.render() 직후 같은 프레임에서 호출 (굴절 스냅샷)
  render() {
    if (!this.enabled) return;
    const ctx = this.x, W = this.c.width, H = this.c.height;
    if (!this.drops.length && !this.trails.length) {
      if (this.dirty) {
        ctx.clearRect(0, 0, W, H);
        this.dirty = false;
      }
      return;
    }
    this.dirty = true;
    ctx.clearRect(0, 0, W, H);
    this.sx.drawImage(this.src, 0, 0, this.snap.width, this.snap.height);
    const sk = this.snap.width / W;

    for (const t of this.trails) {
      const a = 1 - t.age / t.life;
      ctx.fillStyle = `rgba(215,230,255,${0.32 * a})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const d of this.drops) {
      const a = d.slide ? 1 : Math.min(1, d.age * 4, Math.max(0, 1 - (d.age - d.life)));
      if (a <= 0) continue;
      const ry = d.r * (d.slide ? 1.25 : 1.08);
      // 흘러내린 물줄기 (뒤쪽 잔상)
      if (d.slide) {
        const len = d.r * 7;
        const g = ctx.createLinearGradient(0, d.y - len, 0, d.y);
        g.addColorStop(0, 'rgba(220,235,255,0)');
        g.addColorStop(1, `rgba(220,235,255,${0.2 * a})`);
        ctx.fillStyle = g;
        ctx.fillRect(d.x - d.r * 0.45, d.y - len, d.r * 0.9, len);
      }
      // 굴절: 방울 안에 주변 화면을 축소·상하반전해서 비춤
      ctx.save();
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      const span = d.r * 4.5;
      ctx.translate(d.x, d.y);
      ctx.scale(1, -1);
      ctx.drawImage(this.snap, (d.x - span) * sk, (d.y - span) * sk, span * 2 * sk, span * 2 * sk, -d.r, -ry, d.r * 2, ry * 2);
      ctx.restore();
      // 테두리 그림자 + 하이라이트
      ctx.globalAlpha = a;
      ctx.lineWidth = Math.max(1, d.r * 0.16);
      ctx.strokeStyle = 'rgba(0,10,25,0.28)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(d.x - d.r * 0.32, d.y - ry * 0.42, Math.max(0.8, d.r * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}
