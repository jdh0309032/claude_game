// 1v1 멀티플레이 연결 (PeerJS / WebRTC 데이터 채널)
// 방장이 Room Code 로 피어를 열고, 참가자가 그 코드로 접속합니다.
import { PEER_SERVER, PEER_ICE_SERVERS, PEER_DEBUG } from './config.js';

const PREFIX = 'grabrider-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STATE_HZ = 15;                 // 위치 전송 15 FPS (≈66ms) 제한
const MAX_BUFFERED = 64 * 1024;      // DataChannel 버퍼가 이만큼 쌓이면 상태 패킷은 건너뜀
const log = (...a) => console.info('[net]', ...a);

function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js';
    s.onload = () => resolve(window.Peer);
    s.onerror = () => reject(new Error('Failed to load PeerJS'));
    document.head.appendChild(s);
  });
}

export function makeCode(len = 5) {
  let c = '';
  for (let i = 0; i < len; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return c;
}

const ERROR_TEXT = {
  'peer-unavailable': 'Room not found',
  'unavailable-id': 'Room code already in use',
  network: 'Lost connection to the matchmaking server',
  'server-error': 'Matchmaking server error',
  'socket-error': 'Matchmaking server unreachable',
  'socket-closed': 'Matchmaking server connection closed',
  'browser-incompatible': 'This browser does not support WebRTC',
  webrtc: 'P2P connection failed (network may block WebRTC)',
};
export const describeError = (e) => ERROR_TEXT[e?.type] || e?.message || String(e);

class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'guest'
    this.code = null;
    this.seed = null; // 방장이 만든 도로 시드 (접속 시 참가자에게 전달)
    this.handlers = {};
    this.lastState = 0;
  }

  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  emit(ev, d) { for (const fn of this.handlers[ev] || []) fn(d); }
  get connected() { return Boolean(this.conn && this.conn.open); }

  async host() {
    const Peer = await loadPeerJS();
    this.close();
    this.role = 'host';
    this.seed = (Math.random() * 2 ** 32) >>> 0;
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
    log('room opened', this.code);
    this.peer.on('connection', (conn) => {
      log('incoming connection', conn.peer);
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
    log('joining room', code);
    const conn = this.peer.connect(PREFIX + code, { reliable: true });
    this.code = code;
    // 방장이 open 직후 보내는 hello(이름·시드)를 놓치지 않도록 수신 핸들러를 먼저 연결
    this._bind(conn);
    await new Promise((resolve, reject) => {
      const fail = (msg) => { clearTimeout(timer); reject(new Error(msg)); };
      const timer = setTimeout(() => fail('Room not found (timed out)'), 15000);
      conn.on('open', () => { clearTimeout(timer); resolve(); });
      conn.on('error', (e) => { log('conn error', e); fail('Connection failed'); });
      this.peer.on('error', (e) => { if (e.type === 'peer-unavailable') fail('Room not found'); });
    });
  }

  _open(Peer, id) {
    return new Promise((resolve, reject) => {
      // window.__PEER_SERVER: 테스트/개발용 서버 덮어쓰기
      const opts = {
        ...(window.__PEER_SERVER || PEER_SERVER || {}),
        config: { iceServers: PEER_ICE_SERVERS },
        debug: PEER_DEBUG,
      };
      const p = id ? new Peer(id, opts) : new Peer(opts);
      this.peer = p;
      const onErr = (e) => { log('peer error (open)', e.type, e); reject(e); };
      p.once('error', onErr);
      p.once('open', (pid) => {
        log('peer open', pid);
        p.off('error', onErr);
        p.on('error', (e) => {
          console.warn('[net] peer error', e.type, e);
          this.emit('error', e);
        });
        p.on('disconnected', () => {
          // 중개 서버와 끊겨도 이미 맺은 P2P 는 유지됨 → 재접속 시도
          log('signaling disconnected, reconnecting');
          if (!p.destroyed) p.reconnect();
        });
        resolve();
      });
    });
  }

  _bind(conn) {
    this.conn = conn;
    const ready = () => {
      log('data channel open with', conn.peer);
      const pc = conn.peerConnection;
      if (pc) {
        pc.addEventListener('iceconnectionstatechange', () => {
          log('ICE state', pc.iceConnectionState);
          if (pc.iceConnectionState === 'failed') this.emit('error', { type: 'webrtc', message: 'ICE failed' });
        });
      }
      this.emit('connected');
    };
    if (conn.open) ready();
    else conn.on('open', ready);
    conn.on('data', (d) => this.emit('data', d));
    conn.on('error', (e) => {
      console.warn('[net] connection error', e);
      this.emit('error', e);
    });
    conn.on('close', () => {
      log('connection closed');
      if (this.conn !== conn) return;
      this.conn = null;
      this.emit('disconnected');
    });
  }

  // 제어 메시지 (항상 전송)
  send(msg) {
    if (!this.connected) return;
    try { this.conn.send(msg); } catch (e) { console.warn('[net] send failed', e); }
  }

  // 위치/속도 상태: 15 FPS 로 제한 + 버퍼가 밀리면 건너뜀 (DataChannel overflow 방지)
  sendState(msg) {
    if (!this.connected) return false;
    const now = performance.now();
    if (now - this.lastState < 1000 / STATE_HZ) return false;
    const dc = this.conn.dataChannel;
    if (dc && dc.bufferedAmount > MAX_BUFFERED) return false;
    this.lastState = now;
    this.send(msg);
    return true;
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
