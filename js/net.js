// 1v1 멀티플레이 연결 (PeerJS / WebRTC 데이터 채널)
// 방장이 Room Code 로 피어를 열고, 참가자가 그 코드로 접속합니다.
import { PEER_SERVER } from './config.js';

const PREFIX = 'grabrider-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js';
    s.onload = () => resolve(window.Peer);
    s.onerror = () => reject(new Error('PeerJS 로딩 실패'));
    document.head.appendChild(s);
  });
}

export function makeCode(len = 5) {
  let c = '';
  for (let i = 0; i < len; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return c;
}

class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'guest'
    this.code = null;
    this.handlers = {};
  }

  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  emit(ev, d) { for (const fn of this.handlers[ev] || []) fn(d); }
  get connected() { return Boolean(this.conn && this.conn.open); }

  async host() {
    const Peer = await loadPeerJS();
    this.close();
    this.role = 'host';
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      try {
        await this._open(Peer, PREFIX + code);
        this.code = code;
        break;
      } catch (e) {
        if (e.type !== 'unavailable-id' || attempt === 3) throw e;
      }
    }
    this.peer.on('connection', (conn) => {
      if (this.connected) {
        conn.on('open', () => {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 300);
        });
        return;
      }
      this._bind(conn);
    });
    return this.code;
  }

  async join(code) {
    const Peer = await loadPeerJS();
    this.close();
    this.role = 'guest';
    code = code.trim().toUpperCase();
    await this._open(Peer);
    const conn = this.peer.connect(PREFIX + code, { reliable: true });
    this.code = code;
    await new Promise((resolve, reject) => {
      const fail = (msg) => { clearTimeout(timer); reject(new Error(msg)); };
      const timer = setTimeout(() => fail('방을 찾을 수 없습니다 (시간 초과)'), 12000);
      conn.on('open', () => { clearTimeout(timer); resolve(); });
      conn.on('error', () => fail('연결에 실패했습니다'));
      this.peer.on('error', (e) => { if (e.type === 'peer-unavailable') fail('방을 찾을 수 없습니다'); });
    });
    this._bind(conn);
  }

  _open(Peer, id) {
    return new Promise((resolve, reject) => {
      // window.__PEER_SERVER: 테스트/개발용 서버 덮어쓰기
      const opts = { ...(window.__PEER_SERVER || PEER_SERVER || {}), debug: 0 };
      const p = id ? new Peer(id, opts) : new Peer(opts);
      this.peer = p;
      const onErr = (e) => reject(e);
      p.once('error', onErr);
      p.once('open', () => {
        p.off('error', onErr);
        p.on('error', (e) => this.emit('error', e));
        resolve();
      });
    });
  }

  _bind(conn) {
    this.conn = conn;
    const ready = () => this.emit('connected');
    if (conn.open) ready();
    else conn.on('open', ready);
    conn.on('data', (d) => this.emit('data', d));
    conn.on('close', () => {
      if (this.conn !== conn) return;
      this.conn = null;
      this.emit('disconnected');
    });
  }

  send(msg) {
    if (this.connected) this.conn.send(msg);
  }

  close() {
    if (this.conn) { try { this.conn.close(); } catch (e) { /* ignore */ } }
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } }
    this.conn = null;
    this.peer = null;
    this.role = null;
    this.code = null;
  }
}

export const net = new Net();
