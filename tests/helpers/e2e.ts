import type {Pt,Quad,RawImage} from "@/lib/mockup-v3/types";
import {renderFramedPiece,type FrameStyle,type FramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {homographyFromPoints,applyHomography,invertMat3} from "@/lib/mockup-v3/geometry/homography";
import {projectRect} from "./fixtures";
import {
  addSensorNoise,landscapeArt,lightingGradient,placeObject,plainBackground,renderRoom,ROOM_BOUNDS,tableBackground,type Room,type RoomOptions
} from "./scenes";
import {artworkPattern} from "./fixtures";
import {solidImage} from "@/lib/mockup-v3/geometry/warp";

/** An abstract "old picture" that sits in the reference frame and must be replaced. */
export function oldPicture(w:number,h:number):RawImage{
  const img=artworkPattern(w,h,77);
  // make it clearly different from any customer art: warm abstract blocks
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const o=(y*w+x)*4;
    const u=x/w,v=y/h;
    if((Math.floor(u*4)+Math.floor(v*3))%2===0){
      img.data[o]=Math.min(255,img.data[o]*0.6+110);img.data[o+1]=img.data[o+1]*0.5+30;img.data[o+2]=img.data[o+2]*0.4+20;
    }
  }
  return img;
}

export type Hung={image:RawImage;piece:FramedPiece;outerQuad:Quad;apertureQuad:Quad;room:Room;shadowOffset:Pt};

/** Hang a framed piece at metric wall position (centre Xc,Yc, outer width widthM) in a rendered room. */
export function hangPiece(room:Room,piece:FramedPiece,Xc:number,Yc:number,widthM:number,shadow=true):Hung{
  const pw=piece.image.width,ph=piece.image.height;
  const heightM=widthM*ph/pw;
  const wallPt=(px:number,py:number):Pt=>room.wall(Xc-widthM/2+(px/pw)*widthM,Yc-heightM/2+(py/ph)*heightM);
  const outerQuad:Quad=[wallPt(0,0),wallPt(pw,0),wallPt(pw,ph),wallPt(0,ph)];
  const a=piece.aperture;
  const apertureQuad:Quad=[wallPt(a.x,a.y),wallPt(a.x+a.width,a.y),wallPt(a.x+a.width,a.y+a.height),wallPt(a.x,a.y+a.height)];
  const scalePx=Math.hypot(outerQuad[1].x-outerQuad[0].x,outerQuad[1].y-outerQuad[0].y)/pw;
  const shadowOffset={x:5.5*scalePx*1.4,y:8.5*scalePx*1.4};
  const image=placeObject(room.image,piece.image,outerQuad,shadow?{shadow:{offset:shadowOffset,sigma:Math.max(3,5*scalePx*1.4),strength:0.34}}:{});
  return {image,piece,outerQuad,apertureQuad,room,shadowOffset};
}

export const DEFAULT_STYLE:FrameStyle={mouldingPx:34,mouldingColour:[70,52,38],mountPx:46,mountColour:[240,236,226]};

export function makeRoom(o:Partial<RoomOptions>={}):Room{
  return renderRoom({imgW:1200,imgH:900,yawDeg:-14,camX:-0.4,seed:2,focalPx:1080,...o});
}

/** Reference for workflow A: a room with an OLD picture in a frame (to be replaced). */
export function referenceWithFramedPicture(o:{style?:FrameStyle;yawDeg?:number;Xc?:number;Yc?:number;widthM?:number;artAspect?:number}={}){
  const aspect=o.artAspect ?? 4/3;
  const aw=480,ah=Math.round(480/aspect);
  const piece=renderFramedPiece(oldPicture(aw,ah),o.style ?? DEFAULT_STYLE);
  const room=makeRoom({yawDeg:o.yawDeg ?? -14});
  return hangPiece(room,piece,o.Xc ?? -0.1,o.Yc ?? -0.2,o.widthM ?? 0.7);
}

/** Customer's bare print photographed on a table at an angle. */
export function printPhoto(art:RawImage,o:{yawDeg?:number;pitchDeg?:number;rollDeg?:number;widthM?:number;W?:number;H?:number;seed?:number}={}){
  const W=o.W ?? 1600,H=o.H ?? 1200;
  const aspect=art.width/art.height;
  const widthM=o.widthM ?? 0.5;
  const q=projectRect({worldW:widthM,worldH:widthM/aspect,yawDeg:o.yawDeg ?? 9,pitchDeg:o.pitchDeg ?? 13,rollDeg:o.rollDeg ?? -4,distance:1.3,focalPx:1300,imgW:W,imgH:H});
  const photo=addSensorNoise(lightingGradient(placeObject(tableBackground(W,H,o.seed ?? 3),art,q,{shadow:{offset:{x:4,y:6},sigma:4,strength:0.25}}),0.12,200),1.2,o.seed ?? 3);
  return {photo,quad:q,focalPx:1300};
}

/** Customer's finished framed piece photographed against a plain wall. */
export function framedPhoto(piece:FramedPiece,o:{yawDeg?:number;pitchDeg?:number;rollDeg?:number;widthM?:number;W?:number;H?:number;wall?:[number,number,number]}={}){
  const W=o.W ?? 1600,H=o.H ?? 1200;
  const aspect=piece.image.width/piece.image.height;
  const widthM=o.widthM ?? 0.62;
  const q=projectRect({worldW:widthM,worldH:widthM/aspect,yawDeg:o.yawDeg ?? 12,pitchDeg:o.pitchDeg ?? 6,rollDeg:o.rollDeg ?? 1.5,distance:1.6,focalPx:1300,imgW:W,imgH:H});
  const bg=plainBackground(W,H,o.wall ?? [206,200,190],4);
  const photo=addSensorNoise(lightingGradient(placeObject(bg,piece.image,q,{shadow:{offset:{x:9,y:14},sigma:9,strength:0.3}}),0.1,20),1.2,4);
  return {photo,quad:q,focalPx:1300};
}

/** Metric (wall-plane) coordinates of image points on the back wall, for ground-truth checks. */
export function wallMetric(room:Room){
  const H=homographyFromPoints(
    [{x:ROOM_BOUNDS.xMin,y:ROOM_BOUNDS.yTop},{x:ROOM_BOUNDS.xMax,y:ROOM_BOUNDS.yTop},{x:ROOM_BOUNDS.xMax,y:ROOM_BOUNDS.yFloor},{x:ROOM_BOUNDS.xMin,y:ROOM_BOUNDS.yFloor}],
    room.wallQuad
  )!;
  const inv=invertMat3(H)!;
  return (p:Pt)=>applyHomography(inv,p)!;
}

export function emptyRoom(o:Partial<RoomOptions>={}){return makeRoom(o);}
void landscapeArt;void solidImage;
