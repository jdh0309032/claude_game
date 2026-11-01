// 앱(Capacitor)용 웹 파일 모으기: 게임 자체는 빌드 없는 정적 사이트라, 필요한 파일만 www/ 로 복사
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'www';
const FILES = ['index.html', 'privacy.html', 'terms.html', 'manifest.webmanifest', 'icon.svg'];
const DIRS = ['css', 'js', 'vendor', 'assets'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of FILES) if (existsSync(f)) cpSync(f, join(OUT, f));
for (const d of DIRS) if (existsSync(d)) cpSync(d, join(OUT, d), { recursive: true });
console.log(`web assets copied to ${OUT}/`);
