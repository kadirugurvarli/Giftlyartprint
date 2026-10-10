import {describe,expect,it} from "vitest";
import {runRoomMockup} from "@/lib/mockup-v3/rooms/run";
import {fitWall} from "@/lib/mockup-v3/rooms/calibration";
import {applyHomography} from "@/lib/mockup-v3/geometry/homography";
import {buildShadowMask,shadowDirFromDeg} from "@/lib/mockup-v3/rooms/light";
import {depthFaces} from "@/lib/mockup-v3/composite/depth";
import {offsetQuad} from "@/lib/mockup-v3/geometry/quad";
import {rasterizePolygons} from "@/lib/mockup-v3/vision/mask";
import {landscapeArt} from "../helpers/scenes";
import {ALL_SIZES,SPEC,syntheticRoom} from "../helpers/rooms";
import {srgbToLab} from "@/lib/mockup-v3/qa/metrics";

/**
 * ONE synthetic integration test: a room whose wall is only partly visible, with a plant standing in front of the
 * wall inside the reach of the frame's shadow, a calibrated warm light, and flat artwork rendered into a frame in
 * real units — placed at every approved outer size through the real engine and its fidelity gates.
 */
describe("Room Library: synthetic end-to-end",()=>{
  it("places flat artwork in a rendered frame at all eight outer sizes: geometry, light, shadow, protected pixels, no stretch",async()=>{
    const s=syntheticRoom({withPlant:true});
    const fit=fitWall(s.room.wall.controlPoints)!;
    const mask=buildShadowMask(s.room)!;
    const plantAlpha=s.plant!.alpha;
    const summary:string[]=[];
    for(const z of ALL_SIZES){
      const art=landscapeArt(z.width>z.height?1200:900,z.width>z.height?900:1200,z.width+z.height);
      const out=await runRoomMockup({room:s.room,roomImage:s.image,size:z,source:{kind:"flat-artwork",artwork:art,frame:SPEC(z.width,z.height)}});
      expect(out.ok,`${z.width}x${z.height}: ${out.ok?"":out.error+" "+out.detail}`).toBe(true);
      if(!out.ok) continue;
      const {result,placement,checks}=out;
      // every room-specific check and the engine's own gates
      for(const c of checks) expect(c.pass,`${z.width}x${z.height} ${c.name}: ${c.detail}`).toBe(true);
      expect(result.defects.filter(d=>d.severity==="blocker").map(d=>d.code)).toEqual([]);
      expect(result.status==="fail").toBe(false);
      // geometry: the engine placed the piece exactly on the calibrated wall quad, and it measures the requested centimetres
      const tq=result.targetQuad!;
      tq.forEach((q,i)=>expect(Math.hypot(q.x-placement.targetQuad[i].x,q.y-placement.targetQuad[i].y)).toBeLessThan(0.75));
      const back=tq.map(q=>applyHomography(fit.Hinv,q)!);
      expect(Math.hypot(back[1].x-back[0].x,back[1].y-back[0].y)).toBeCloseTo(z.width,0);
      expect(Math.hypot(back[3].x-back[0].x,back[3].y-back[0].y)).toBeCloseTo(z.height,0);
      // never stretched: the rendered piece has exactly the outer proportions
      expect(out.frame!.outer.width/out.frame!.outer.height).toBeCloseTo(z.width/z.height,10);
      expect(Math.abs(Number(result.adjustments.pieceAspect)/(z.width/z.height)-1)).toBeLessThan(0.005);
      // light: the calibrated override was used, with the room's direction, softness and colour temperature
      expect(result.adjustments.lightSource).toBe("override");
      expect(Math.atan2(Number(result.adjustments.shadowDirY),Number(result.adjustments.shadowDirX))*180/Math.PI).toBeCloseTo(63,3);
      expect(Number(result.adjustments.dropStrength)).toBeCloseTo(0.28,6);
      expect(Number(result.adjustments.shadowSoftnessPx)).toBeCloseTo(1.2*placement.pxPerCm,6);
      expect(result.adjustments.shadowColourTempK).toBe(3200);
      expect(result.adjustments.wallShadowMask).toBe(1);
      // shadow actually fell where the light says, with a plausible darkness and a warm-light (cooler) tint
      const W=s.image.width,H=s.image.height;
      let sw=0,peak=0,dR=0,dB=0;
      const band={left:0,right:0,top:0,bottom:0};
      const cx=tq.reduce((a,q)=>a+q.x,0)/4,cy=tq.reduce((a,q)=>a+q.y,0)/4;
      const hw=(Math.max(...tq.map(q=>q.x))-Math.min(...tq.map(q=>q.x)))/2,hh=(Math.max(...tq.map(q=>q.y))-Math.min(...tq.map(q=>q.y)))/2;
      // the frame's synthesised side face is part of the frame, not of the shadow: rebuild it with the engine's own function and keep it out of the shadow statistics
      const faces=depthFaces(tq,z.width/100,z.height/100,0.03,s.room.camera.focalPx,W/2,H/2,shadowDirFromDeg(63));
      const faceMask=rasterizePolygons(faces.map(f=>f.polygon),W,H,2);
      const rim=offsetQuad(tq,1.6); // the engine overlaps the piece by 1 px so no old wall peeks out: that rim is the piece, not shadow
      let plantChanged=0,plantPixels=0,furnitureShadow=0;
      for(let i=0;i<W*H;i++){
        const x=i%W,y=(i/W)|0;
        const changed=result.image!.data[i*4]!==s.image.data[i*4]||result.image!.data[i*4+1]!==s.image.data[i*4+1]||result.image!.data[i*4+2]!==s.image.data[i*4+2];
        if(plantAlpha[i]>200){plantPixels++;if(changed&&!inside(tq,x,y)) plantChanged++;}
        if(mask.alpha[i]===0&&changed&&!inside(tq,x,y)) furnitureShadow++;
        if(!changed||inside(rim,x,y)||faceMask[i]>0) continue;
        const l0=srgbToLab(s.image.data[i*4],s.image.data[i*4+1],s.image.data[i*4+2])[0],l1=srgbToLab(result.image!.data[i*4],result.image!.data[i*4+1],result.image!.data[i*4+2])[0];
        const dk=Math.max(0,(l0-l1)/Math.max(1,l0));
        if(dk>0.004){
          sw+=dk;peak=Math.max(peak,dk);
          const dx=x-cx,dy=y-cy;
          if(dx>hw*0.5&&Math.abs(dy)<hh*0.8) band.right+=dk;
          if(dx<-hw*0.5&&Math.abs(dy)<hh*0.8) band.left+=dk;
          if(dy>hh*0.5&&Math.abs(dx)<hw*0.8) band.bottom+=dk;
          if(dy<-hh*0.5&&Math.abs(dx)<hw*0.8) band.top+=dk;
        }
        dR+=Math.max(0,s.image.data[i*4]-result.image!.data[i*4])/Math.max(1,s.image.data[i*4]);
        dB+=Math.max(0,s.image.data[i*4+2]-result.image!.data[i*4+2])/Math.max(1,s.image.data[i*4+2]);
      }
      expect(sw).toBeGreaterThan(0);
      // shadows fall down and to the right (63°, more down than right): the lower and right edges are darker than the
      // upper and left ones, and the lower edge carries more than the right one
      expect(band.bottom,`${z.width}x${z.height} bottom vs top`).toBeGreaterThan(band.top*2);
      expect(band.right,`${z.width}x${z.height} right vs left`).toBeGreaterThan(band.left*2);
      expect(band.bottom,`${z.width}x${z.height} bottom vs right`).toBeGreaterThan(band.right);
      expect(peak).toBeGreaterThan(0.03);expect(peak).toBeLessThan(0.5);
      expect(dR/dB,`${z.width}x${z.height} warm light: shadow loses more red than blue`).toBeGreaterThan(1.02);
      // protected pixels: the plant (furniture) and everything off the wall are byte-identical to the room photo
      expect(plantPixels).toBeGreaterThan(500);expect(plantChanged).toBe(0);expect(furnitureShadow).toBe(0);
      summary.push(`${z.width}x${z.height}: ${result.status}, peak ${(peak*100).toFixed(0)}%`);
    }
    expect(summary).toHaveLength(8);
  },600000);
});

function inside(q:{x:number;y:number}[],x:number,y:number){
  let c=false;
  for(let i=0,j=q.length-1;i<q.length;j=i++){
    if((q[i].y>y)!==(q[j].y>y)&&x<(q[j].x-q[i].x)*(y-q[i].y)/(q[j].y-q[i].y)+q[i].x) c=!c;
  }
  return c;
}
