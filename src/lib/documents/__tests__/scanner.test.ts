import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import { scanDocument } from '../scanner';

afterEach(()=>vi.unstubAllEnvs());
async function withProtocolStub(reply: string, run:()=>Promise<void>) {
  // Protocol stub is confined to this test; it is not an antivirus implementation.
  const server=createServer(socket=>{
    let pending=Buffer.alloc(0), header=false;
    socket.on('data',chunk=>{
      pending=Buffer.concat([pending,chunk]);
      if(!header) { if(pending.length<10) return; expect(pending.subarray(0,10).toString()).toBe('zINSTREAM\0'); pending=pending.subarray(10); header=true; }
      while(pending.length>=4) { const size=pending.readUInt32BE(0); if(pending.length<4+size) return;
        pending=pending.subarray(4+size); if(size===0) {socket.end(reply+'\0');return;} }
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address(); if(!address || typeof address==='string') throw new Error('Local test port missing');
  vi.stubEnv('CLAMAV_HOST','127.0.0.1');vi.stubEnv('CLAMAV_PORT',String(address.port));
  try { await run(); } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
}
describe('ClamAV fail-closed protocol',()=>{
  it('blocks production when scanner is not configured',async()=>{
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('CLAMAV_HOST','');
    await expect(scanDocument(Buffer.from('test'))).rejects.toMatchObject({status:503});
  });
  it('admits only an explicit CLEAN protocol result',async()=>{
    await withProtocolStub('stream: OK',async()=>expect(await scanDocument(Buffer.from('test bytes'))).toBe('CLEAN'));
  });
  it('rejects a positive detection',async()=>{
    await withProtocolStub('stream: TestSignature FOUND',async()=>{
      await expect(scanDocument(Buffer.from('test bytes'))).rejects.toMatchObject({status:415});
    });
  });
});
