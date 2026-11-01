// 앱(Capacitor)용 웹 파일 모으기: 게임 자체는 빌드 없는 정적 사이트라, 필요한 파일만 www/ 로 복사
// www/build.json: 이 웹 묶음의 빌드 번호(web)와 필요한 네이티브 수준(nativeLevel) → 라이브 업데이트 비교용
import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'www';
const FILES = ['index.html', 'privacy.html', 'terms.html', 'manifest.webmanifest', 'icon.svg'];
const DIRS = ['css', 'js', 'vendor', 'assets'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of FILES) if (existsSync(f)) cpSync(f, join(OUT, f));
for (const d of DIRS) if (existsSync(d)) cpSync(d, join(OUT, d), { recursive: true });
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const build = { web: Number(process.env.VERSION_CODE || 0), nativeLevel: pkg.nativeLevel || 1, sha: (process.env.GITHUB_SHA || 'local').slice(0, 7) };
writeFileSync(join(OUT, 'build.json'), JSON.stringify(build));
console.log(`web assets copied to ${OUT}/ (build ${build.web}, native level ${build.nativeLevel})`);
