import type { AnyRecord } from '../domain/types';

export interface OutboxItem {
  id: string;
  v: number;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class WorkspaceDb {
  private constructor(private db: IDBDatabase) {}

  static open(wsId: string): Promise<WorkspaceDb> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(`bukulapak-${wsId}`, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('records', { keyPath: 'id' });
        r.result.createObjectStore('outbox', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(new WorkspaceDb(r.result));
      r.onerror = () => reject(r.error);
    });
  }

  static async destroy(wsId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(`bukulapak-${wsId}`);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }

  close() {
    this.db.close();
  }

  all(): Promise<AnyRecord[]> {
    return req(this.db.transaction('records').objectStore('records').getAll());
  }

  /** Saves records and queues them for upload in one transaction. */
  async save(records: AnyRecord[], queue = true): Promise<void> {
    const tx = this.db.transaction(['records', 'outbox'], 'readwrite');
    const rs = tx.objectStore('records');
    const ob = tx.objectStore('outbox');
    for (const r of records) {
      rs.put(r);
      if (queue) ob.put({ id: r.id, v: Date.now() + Math.random() });
    }
    await done(tx);
  }

  /** Applies server records, skipping ones with unsent local edits (those win until pushed). */
  async applyRemote(records: AnyRecord[]): Promise<AnyRecord[]> {
    const tx = this.db.transaction(['records', 'outbox'], 'readwrite');
    const rs = tx.objectStore('records');
    const ob = tx.objectStore('outbox');
    const applied: AnyRecord[] = [];
    for (const r of records) {
      const pending = await req(ob.getKey(r.id));
      if (pending !== undefined) continue;
      if (r.type === 'entry' && (await req(rs.getKey(r.id))) !== undefined) continue;
      rs.put(r);
      applied.push(r);
    }
    await done(tx);
    return applied;
  }

  async outbox(limit: number): Promise<{ items: OutboxItem[]; records: AnyRecord[] }> {
    const tx = this.db.transaction(['records', 'outbox']);
    const items = (await req(tx.objectStore('outbox').getAll(undefined, limit))) as OutboxItem[];
    const records: AnyRecord[] = [];
    for (const it of items) {
      const r = (await req(tx.objectStore('records').get(it.id))) as AnyRecord | undefined;
      if (r) records.push(r);
    }
    return { items, records };
  }

  outboxCount(): Promise<number> {
    return req(this.db.transaction('outbox').objectStore('outbox').count());
  }

  /** Clears pushed items unless they were edited again while the push was in flight. */
  async ack(items: OutboxItem[]): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    const ob = tx.objectStore('outbox');
    for (const it of items) {
      const cur = (await req(ob.get(it.id))) as OutboxItem | undefined;
      if (cur && cur.v === it.v) ob.delete(it.id);
    }
    await done(tx);
  }

  async queueAll(): Promise<void> {
    const records = await this.all();
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const r of records) tx.objectStore('outbox').put({ id: r.id, v: Date.now() + Math.random() });
    await done(tx);
  }
}
