import Peer, { DataConnection } from 'peerjs';

export type MultiMsg =
  | { type: 'game_start'; holeIndex: number }
  | { type: 'shot'; dx: number; dz: number; power: number }
  | { type: 'ball_pos'; x: number; y: number; z: number }
  | { type: 'turn_end'; strokes: number }
  | { type: 'hole_done'; strokes: number }
  | { type: 'next_hole'; holeIndex: number };

export class MultiplayerManager {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  public isHost = false;
  public myPeerId = '';

  public onConnected: (() => void) | null = null;
  public onDisconnected: (() => void) | null = null;
  public onMessage: ((msg: MultiMsg) => void) | null = null;
  public onError: ((err: string) => void) | null = null;

  /** Returns a 6-digit numeric invite code. */
  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.isHost = true;
      const code = String(Math.floor(100000 + Math.random() * 900000));
      this.peer = new Peer(code);
      this.peer.on('open', (id) => {
        this.myPeerId = id;
        resolve(id);
      });
      this.peer.on('connection', (conn) => {
        this.conn = conn;
        this._setupConn();
      });
      this.peer.on('disconnected', () => this.peer?.reconnect());
      this.peer.on('error', (err) => {
        this.onError?.(String(err));
        reject(err);
      });
    });
  }

  joinRoom(hostId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isHost = false;
      this.peer = new Peer();
      this.peer.on('open', () => {
        const conn = this.peer!.connect(hostId, { reliable: true });
        this.conn = conn;
        this._setupConn();
        conn.on('open', () => resolve());
        conn.on('error', (err) => {
          this.onError?.(String(err));
          reject(err);
        });
      });
      this.peer.on('disconnected', () => this.peer?.reconnect());
      this.peer.on('error', (err) => {
        this.onError?.(String(err));
        reject(err);
      });
    });
  }

  send(msg: MultiMsg): void {
    if (this.conn?.open) this.conn.send(JSON.stringify(msg));
  }

  private _setupConn(): void {
    if (!this.conn) return;
    this.conn.on('open', () => {
      this.onConnected?.();
      this._startHeartbeat();
    });
    this.conn.on('data', (raw) => {
      if (raw === '♥') return;
      try {
        const msg = JSON.parse(raw as string) as MultiMsg;
        this.onMessage?.(msg);
      } catch {}
    });
    this.conn.on('close', () => {
      this._stopHeartbeat();
      this.onDisconnected?.();
    });
    this.conn.on('error', (err) => this.onError?.(String(err)));
  }

  private _startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      if (this.conn?.open) this.conn.send('♥');
    }, 8000);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }

  get isConnected(): boolean { return this.conn?.open === true; }

  destroy(): void {
    this._stopHeartbeat();
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
    this.isHost = false;
    this.myPeerId = '';
  }
}
