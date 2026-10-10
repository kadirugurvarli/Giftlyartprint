import type {Pt,Quad,RawImage} from "@/lib/mockup-v3/types";
import {clipPolygonToRect} from "@/lib/mockup-v3/rooms/calibration";
import type {ControlPoint,RoomDefinition} from "@/lib/mockup-v3/rooms/schema";
import type {FrameSpec} from "@/lib/mockup-v3/rooms/product";
import {addPlant} from "./scenes";
import {makeRoom} from "./e2e";

/** Ray-traced synthetic room with KNOWN geometry: image px of any wall point, in metres. */
export const ROOM_W=1600,ROOM_H=1200,ROOM_FOCAL=1440;

export type SyntheticRoom={
  room:RoomDefinition;
  image:RawImage;
  /** wall plane cm (same coordinates as the control points) -> true image px */
  truth:(xCm:number,yCm:number)=>Pt;
  plant?:{polygon:Pt[];alpha:Uint8Array};
};

const wallXm=(xCm:number)=>-1.8+xCm/100,wallYm=(yCm:number)=>-1.0+yCm/100;

/**
 * A room whose wall is only PARTLY visible (ceiling, floor and the right corner are cropped), so the
 * wall is described by nine calibrated control points instead of four wall corners.
 */
export function syntheticRoom(o:{
  origin?:"owned-photo"|"ai-generated";jitterPx?:number;pitchDeg?:number;yawDeg?:number;withPlant?:boolean;
  light?:Partial<RoomDefinition["light"]>;
}={}):SyntheticRoom{
  const R=makeRoom({imgW:ROOM_W,imgH:ROOM_H,focalPx:ROOM_FOCAL,yawDeg:o.yawDeg ?? -14,pitchDeg:o.pitchDeg,seed:2});
  const truth=(xCm:number,yCm:number)=>R.wall(wallXm(xCm),wallYm(yCm));
  let image=R.image;
  const jit=o.jitterPx ?? 0;
  let seed=11;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296-0.5;};
  const controlPoints:ControlPoint[]=[];
  for(const yCm of [0,85,170]) for(const xCm of [0,105,210]){
    const p=truth(xCm,yCm);
    controlPoints.push({image:{x:p.x+rnd()*2*jit,y:p.y+rnd()*2*jit},wallCm:{x:xCm,y:yCm},label:`grid-${xCm}-${yCm}`});
  }
  // the visible part of the true wall (the full wall rectangle runs out of the picture on the right/top/bottom)
  const wallPoly=clipPolygonToRect(R.wallQuad as Pt[],ROOM_W,ROOM_H);
  const exclude:Pt[][]=[];
  let plant:SyntheticRoom["plant"];
  if(o.withPlant){
    // a plant standing in front of the wall to the right of the frame, inside the reach of its shadow
    // right of even the widest frame (80 cm centred at 105 ends at 145 cm), close enough for the shadow of the wider ones to reach it
    const br=truth(166,128);
    const p=addPlant(image,br.x,br.y,ROOM_W*0.06,6);
    image=p.image;plant={polygon:p.maskPolygon,alpha:p.alpha};exclude.push(p.maskPolygon);
  }
  const ai=o.origin==="ai-generated";
  const room:RoomDefinition={
    schemaVersion:2,id:ai?"synthetic-ai-room":"synthetic-room-01",
    image:{key:"synthetic",width:ROOM_W,height:ROOM_H,origin:o.origin ?? "owned-photo"},
    rights:{approved:true,commercialUse:true,notes:"synthetic test render"},
    wall:{controlPoints},
    scale:ai
      ?{method:"ai-estimate",basis:"sofa seat width assumed 200 cm",confidence:"medium",relativeUncertainty:0.1}
      :{method:"measured-reference",basis:"synthetic ground-truth geometry",confidence:"measured",relativeUncertainty:0.02,verifiedBy:"test",verifiedAt:"2026-10-10"},
    camera:{focalPx:ROOM_FOCAL,source:"solved"},
    region:{id:"main",leftCm:20,topCm:10,widthCm:170,heightCm:150},
    light:{calibrated:true,shadowDirectionDeg:63,intensity:0.28,softnessCm:1.2,colourTempK:3200,...o.light},
    shadowMask:{wallPolygons:[wallPoly],excludePolygons:exclude.length?exclude:undefined}
  };
  return {room,image,truth,plant};
}

export const SPEC=(w:number,h:number,over:Partial<FrameSpec>={}):FrameSpec=>({
  outerCm:{width:w,height:h},mouldingWidthCm:2.4,frameDepthCm:3,mountWidthCm:3.5,
  mouldingColour:[66,48,34],mountColour:[238,233,222],...over
});

export const ALL_SIZES:{width:number;height:number}[]=[
  {width:30,height:40},{width:40,height:30},{width:40,height:50},{width:50,height:40},
  {width:50,height:70},{width:70,height:50},{width:60,height:80},{width:80,height:60}
];
export type {Quad};
