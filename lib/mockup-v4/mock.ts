import type {EditRequest,EditResult,EditorConstraints,HybridImageEditor,RawImage} from "./types";

const CONSTRAINTS:EditorConstraints={alignPx:16,maxAspect:3,maxSide:3840,maxPixels:3840*2160,minSide:64};
const clone=(i:RawImage):RawImage=>({width:i.width,height:i.height,data:new Uint8ClampedArray(i.data)});
const meta=(r:EditRequest,id:string)=>({provider:"mock",model:id,requestSize:`${r.image.width}x${r.image.height}`,estimatedCostUsd:0});

/** Well-behaved stand-in: darkens/warms only where the mask allows. Used to test the plumbing. */
export class FaithfulMockEditor implements HybridImageEditor{
  readonly id="mock-faithful";readonly constraints=CONSTRAINTS;calls=0;
  async edit(r:EditRequest):Promise<EditResult>{
    this.calls++;const o=clone(r.image);
    for(let i=0;i<r.mask.length;i++) if(r.mask[i]){o.data[i*4]=Math.min(255,o.data[i*4]*0.92+4);o.data[i*4+1]*=0.92;o.data[i*4+2]*=0.9;}
    return {image:o,meta:meta(r,this.id)};
  }
}

export type Misbehaviour="repaint-art"|"repaint-furniture"|"ghost-object"|"global-tint"|"wrong-size"|"shifted";

/**
 * Adversarial stand-ins that break the contract in the ways real generative editors do. The orchestrator must
 * either neutralise them (composite keeps the baseline) or reject them (drift beyond tolerance).
 * `region` is a crop-space rectangle used by repaint/ghost modes.
 */
export class AdversarialMockEditor implements HybridImageEditor{
  readonly id:string;readonly constraints=CONSTRAINTS;
  constructor(private readonly mode:Misbehaviour,private readonly region:{x:number;y:number;width:number;height:number}={x:0,y:0,width:0,height:0}){this.id=`mock-adversarial-${mode}`;}
  async edit(r:EditRequest):Promise<EditResult>{
    const o=clone(r.image),{width:W,height:H}=o;
    const paint=(rg:{x:number;y:number;width:number;height:number},c:[number,number,number])=>{for(let y=rg.y;y<rg.y+rg.height;y++)for(let x=rg.x;x<rg.x+rg.width;x++){const p=(y*W+x)*4;o.data[p]=c[0];o.data[p+1]=c[1];o.data[p+2]=c[2];}};
    // a plausible frame restyle inside the mask in every mode, so the misbehaviour is the only difference
    for(let i=0;i<r.mask.length;i++) if(r.mask[i]){o.data[i*4]*=0.9;o.data[i*4+1]*=0.9;o.data[i*4+2]*=0.9;}
    switch(this.mode){
      case "repaint-art":case "repaint-furniture":case "ghost-object": paint(this.region,[250,20,200]);break;
      case "global-tint": for(let i=0;i<W*H;i++){o.data[i*4]=Math.min(255,o.data[i*4]+14);o.data[i*4+2]=Math.max(0,o.data[i*4+2]-14);}break;
      case "wrong-size": return {image:{width:W-16,height:H,data:new Uint8ClampedArray((W-16)*H*4)},meta:meta(r,this.id)};
      case "shifted": {const s=clone(o);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const sx=Math.min(W-1,x+3),d=(y*W+x)*4,q=(y*W+sx)*4;o.data[d]=s.data[q];o.data[d+1]=s.data[q+1];o.data[d+2]=s.data[q+2];}break;}
    }
    return {image:o,meta:meta(r,this.id)};
  }
}
