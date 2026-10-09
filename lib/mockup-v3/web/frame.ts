/**
 * Binary response framing (avoids base64's 33% overhead against the 4.5 MB response limit):
 * [u32 BE header length][header JSON][mockup bytes][overlay bytes]. Offsets/lengths are in the header.
 */
export type FrameHeader={report:unknown;mockup:{length:number;type:string};overlay:{length:number;type:string}|null};

export function packFrame(header:Omit<FrameHeader,"mockup"|"overlay">,mockup:{bytes:Buffer;type:string},overlay:{bytes:Buffer;type:string}|null):Buffer{
  const h=Buffer.from(JSON.stringify({...header,mockup:{length:mockup.bytes.length,type:mockup.type},overlay:overlay?{length:overlay.bytes.length,type:overlay.type}:null}));
  const len=Buffer.alloc(4);len.writeUInt32BE(h.length);
  return Buffer.concat([len,h,mockup.bytes,overlay?.bytes ?? Buffer.alloc(0)]);
}

export function unpackFrame(buf:Uint8Array):{header:FrameHeader;mockup:Uint8Array;overlay:Uint8Array|null}{
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const hl=dv.getUint32(0);
  const header=JSON.parse(new TextDecoder().decode(buf.subarray(4,4+hl))) as FrameHeader;
  let o=4+hl;
  const mockup=buf.subarray(o,o+header.mockup.length);o+=header.mockup.length;
  const overlay=header.overlay?buf.subarray(o,o+header.overlay.length):null;
  return {header,mockup,overlay};
}
