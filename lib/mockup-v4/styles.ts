import type {PackManifest} from "./pack";

export type SizeOption={width:number;height:number;label:string;orientation:"portrait"|"landscape"};
const mk=(w:number,h:number):SizeOption=>({width:w,height:h,label:`${w}×${h} cm`,orientation:h>w?"portrait":"landscape"});
/** Outer frame sizes (frame included), 30x40 to 60x80 cm, portrait and landscape. */
export const SIZES:SizeOption[]=[mk(30,40),mk(40,30),mk(40,50),mk(50,40),mk(50,70),mk(70,50),mk(60,80),mk(80,60)];

export type FrameStyle={id:string;label:string;mouldingWidthCm:number;mouldingColour:[number,number,number];mountColour:[number,number,number];frameDepthCm:number;description:string};
export const FRAME_STYLES:FrameStyle[]=[
  {id:"walnut",label:"Walnut",mouldingWidthCm:2.4,mouldingColour:[66,48,34],mountColour:[238,233,222],frameDepthCm:3,description:"a dark walnut-brown wooden moulding with fine straight grain"},
  {id:"oak",label:"Natural oak",mouldingWidthCm:2.4,mouldingColour:[176,138,92],mountColour:[240,236,226],frameDepthCm:3,description:"a light natural oak wooden moulding with visible open grain"},
  {id:"black",label:"Black",mouldingWidthCm:2.2,mouldingColour:[28,28,30],mountColour:[244,242,236],frameDepthCm:3,description:"a slim satin-black wooden moulding"},
  {id:"white",label:"White",mouldingWidthCm:2.4,mouldingColour:[236,234,229],mountColour:[246,244,239],frameDepthCm:3,description:"a white painted wooden moulding with a soft satin finish"},
  {id:"gold",label:"Antique gold",mouldingWidthCm:2.6,mouldingColour:[156,124,62],mountColour:[236,230,214],frameDepthCm:3.2,description:"an antique-gold leaf moulding with a warm patina"}
];
export type MountOption={id:string;label:string;mountWidthCm:number;text:string};
export const MOUNTS:MountOption[]=[
  {id:"none",label:"No mount",mountWidthCm:0,text:"no mount"},
  {id:"narrow",label:"Narrow mount (2.5 cm)",mountWidthCm:2.5,text:"a narrow cream mount"},
  {id:"classic",label:"Classic mount (4 cm)",mountWidthCm:4,text:"a classic cream mount"},
  {id:"wide",label:"Wide mount (6 cm)",mountWidthCm:6,text:"a wide cream mount"}
];

export function frameFor(styleId:string,mountId:string):PackManifest["frame"]|null{
  const s=FRAME_STYLES.find(x=>x.id===styleId),m=MOUNTS.find(x=>x.id===mountId);
  if(!s||!m) return null;
  return {mouldingWidthCm:s.mouldingWidthCm,mountWidthCm:m.mountWidthCm,frameDepthCm:s.frameDepthCm,mouldingColour:s.mouldingColour,mountColour:s.mountColour,description:`${s.description}, ${m.text}`};
}
