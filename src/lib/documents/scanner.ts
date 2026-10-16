import { createConnection } from 'node:net';
import { RequestError } from '../security/request';

/** Files remain in bounded request memory until CLEAN; infected bytes are never stored. */
export async function scanDocument(buffer: Buffer): Promise<'CLEAN' | 'UNSCANNED'> {
  const host = process.env.CLAMAV_HOST;
  if (!host) {
    if (process.env.NODE_ENV === 'production' || process.env.DOCUMENT_SCAN_MODE === 'required') {
      throw new RequestError('Загрузка недоступна: антивирус не настроен', 503);
    }
    return 'UNSCANNED';
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: Number(process.env.CLAMAV_PORT ?? 3310) });
    let response = '';
    const fail = () => { socket.destroy(); reject(new RequestError('Антивирус недоступен', 503)); };
    socket.setTimeout(30_000, fail);
    socket.on('error', fail);
    socket.on('data', chunk => { response += chunk.toString(); if (response.length > 4096) fail(); });
    socket.on('connect', async () => {
      try {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < buffer.length; offset += 65_536) {
          const chunk = buffer.subarray(offset, offset + 65_536);
          const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length);
          socket.write(length);
          if (!socket.write(chunk)) await new Promise<void>((r, rejectDrain) => {
            socket.once('drain', r); socket.once('error', rejectDrain);
          });
        }
        socket.write(Buffer.alloc(4));
      } catch { fail(); }
    });
    socket.on('end', () => {
      socket.destroy();
      if (/stream: OK\0?$/.test(response.trim())) resolve('CLEAN');
      else if (response.includes('FOUND')) reject(new RequestError('Файл заблокирован антивирусом', 415));
      else reject(new RequestError('Антивирус не подтвердил безопасность файла', 503));
    });
  });
}
