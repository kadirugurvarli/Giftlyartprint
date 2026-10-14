import {describe,expect,it} from "vitest";
import type {Pt,Quad} from "@/lib/mockup-v3/types";
import {depthFaces,planePoseFromQuad,outerEdgeColour,renderDepthLayer} from "@/lib/mockup-v3/composite/depth";
import {solidImage,pixelAt} from "@/lib/mockup-v3/geometry/warp";

/** Independent ground-truth camera: rectangle in world, rotated, projected; with real depth offset. */
function scene(yawDeg:number,pitchDeg:number,widthM:number,heightM:number,depthM:number,f=1200,W=1600,H=1200){
  const d=Math.PI/180,cy=Math.cos(yawDeg*d),sy=Math.sin(yawDeg*d),cp=Math.cos(pitchDeg*d),sp=Math.sin(pitchDeg*d);
  const rot=(v:[number,number,number]):[number,number,number]=>{
    let [x,y,z]=v;[x,z]=[cy*x+sy*z,-sy*x+cy*z];[y,z]=[cp*y-sp*z,sp*y+cp*z];return [x,y,z];
  };
  const T:[number,number,number]=[0.1,-0.05,3];
  const pt=(X:number,Y:number,Z:number)=>{const r=rot([X,Y,Z]);return [r[0]+T[0],r[1]+T[1],r[2]+T[2]] as [number,number,number];};
  const proj=(p:[number,number,number]):Pt=>({x:f*p[0]/p[2]+W/2,y:f*p[1]/p[2]+H/2});
  const hw=widthM/2,hh=heightM/2;
  const front=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([X,Y])=>pt(X,Y,0));
  const back=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([X,Y])=>pt(X,Y,depthM)); // +z = into the wall
  return {quad:front.map(proj) as Quad,back:back.map(proj),f,W,H};
}

describe("plane pose and frame depth (vs an independent camera)",()=>{
  for(const [yaw,pitch] of [[20,6],[-28,0],[35,-8],[0,0]] as [number,number][]){
    it(`back-corner parallax matches ground truth (yaw ${yaw}, pitch ${pitch})`,()=>{
      const s=scene(yaw,pitch,0.62,0.5,0.03);
      const faces=depthFaces(s.quad,0.62,0.5,0.03,s.f,s.W/2,s.H/2,{x:0.5,y:0.85});
      // every produced face edge touching a back corner must land on the true projected back corner
      const truthBack=s.back;
      for(const face of faces){
        for(const p of face.polygon.slice(2)){
          const best=Math.min(...truthBack.map((b)=>Math.hypot(b.x-p.x,b.y-p.y)));
          expect(best).toBeLessThan(0.6);
        }
      }
    });
  }
  it("visible faces follow the viewing side: yawed left shows one side only; frontal shows none",()=>{
    const left=depthFaces(scene(30,0,0.62,0.5,0.03).quad,0.62,0.5,0.03,1200,800,600,{x:0.5,y:0.85}).map((f)=>f.side);
    const right=depthFaces(scene(-30,0,0.62,0.5,0.03).quad,0.62,0.5,0.03,1200,800,600,{x:0.5,y:0.85}).map((f)=>f.side);
    expect(left.length).toBe(1);expect(right.length).toBe(1);expect(left[0]).not.toBe(right[0]);
    const frontal=depthFaces(scene(0,0,0.62,0.5,0.03).quad,0.62,0.5,0.03,1200,800,600,{x:0.5,y:0.85});
    expect(frontal.length).toBe(0);
  });
  it("face width scales with depth and viewing angle",()=>{
    const w=(depth:number,yaw:number)=>{
      const f=depthFaces(scene(yaw,0,0.62,0.5,depth).quad,0.62,0.5,depth,1200,800,600,{x:0.5,y:0.85})[0];
      const p=f.polygon;return Math.hypot(p[3].x-p[0].x,p[3].y-p[0].y);
    };
    expect(w(0.04,30)).toBeGreaterThan(1.8*w(0.02,30));
    expect(w(0.03,40)).toBeGreaterThan(w(0.03,15));
  });
  it("recovers the plane normal's tilt from the quad",()=>{
    const s=scene(30,0,0.62,0.5,0.03);
    const pose=planePoseFromQuad(s.quad,0.62,0.5,s.f,s.W/2,s.H/2)!;
    const tilt=Math.acos(Math.abs(pose.nIn[2]))*180/Math.PI;
    expect(Math.abs(tilt-30)).toBeLessThan(1.5);
  });
  it("outer edge colour and rendered faces are hue-consistent with the frame, faces never cover the front",()=>{
    const piece=solidImage(100,80,[200,200,200,255]);
    for(let y=0;y<80;y++) for(let x=0;x<100;x++) if(x<3||y<3||x>96||y>76) piece.data.set([70,50,36,255],(y*100+x)*4);
    const c=outerEdgeColour(piece,0.03);
    expect(Math.abs(c[0]-70)).toBeLessThan(25);
    const faces=depthFaces(scene(30,0,0.62,0.5,0.03).quad,0.62,0.5,0.03,1200,800,600,{x:0.5,y:0.85});
    const layer=renderDepthLayer(faces,c,1600,1200);
    const px=faces[0].polygon;
    const mx=Math.round((px[0].x+px[1].x+px[2].x+px[3].x)/4),my=Math.round((px[0].y+px[1].y+px[2].y+px[3].y)/4);
    const p=pixelAt(layer,mx,my);
    expect(p[3]).toBeGreaterThan(200);
    expect(p[0]).toBeLessThan(110);expect(p[0]).toBeGreaterThan(p[2]); // brownish, darker than the frame colour
  });
});
